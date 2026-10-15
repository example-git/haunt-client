const { app, ipcMain, systemPreferences } = require("electron");
const path = require("node:path");
const { Capture, listSources } = require("./swiftcapture.cjs");
const { NativePublisher, purposes } = require("./native-publisher.cjs");
const { chooseCapture } = require("./capture-picker.cjs");

function installNativeMedia(parent, validateSender) {
  // Sandboxed preloads do not expose all of Node's process properties. Resolve
  // architecture in the main process, before the first renderer is loaded.
  ipcMain.on("native:available", (event) => {
    try {
      validateSender(event);
      event.returnValue =
        process.platform === "darwin" && process.arch === "arm64";
    } catch {
      event.returnValue = false;
    }
  });
  if (process.platform !== "darwin" || process.arch !== "arm64") return;
  const root = app.isPackaged
    ? path.join(process.resourcesPath, "native/mac")
    : path.join(__dirname, "../../static/native/mac");
  const worker = path.join(root, "SwiftCaptureWorker");
  const publisherBinary = path.join(root, "HauntMediaWorker");
  const captures = new Map(),
    publishers = new Map(),
    pending = new Set();
  const stopping = new Map();
  const stopCapture = (entry) => {
    entry.capture.stop();
    const done = entry.capture.finished.finally(() => {
      if (stopping.get(entry.purpose) === done) stopping.delete(entry.purpose);
    });
    stopping.set(entry.purpose, done);
    return done;
  };
  let generation = 0;
  let catalogPending;
  let catalog,
    catalogAt = 0;
  const idOK = (id) => typeof id === "string" && /^[a-f0-9-]{36}$/.test(id);
  const send = (message) => {
    if (!parent.isDestroyed()) parent.webContents.send("native:event", message);
  };
  const sources = async (fresh = false) => {
    if (!fresh && catalog && Date.now() - catalogAt <= 5000) return catalog;
    if (!catalogPending)
      catalogPending = listSources(worker)
        .then((value) => {
          catalog = value;
          catalogAt = Date.now();
          return value;
        })
        .finally(() => {
          catalogPending = undefined;
        });
    return catalogPending;
  };
  const permission = async (kind) => {
    if (
      systemPreferences.getMediaAccessStatus(kind) !== "granted" &&
      !(await systemPreferences.askForMediaAccess(kind))
    )
      throw Error(`Enable ${kind} access for Haunt in macOS System Settings.`);
  };
  const device = (list, id, label) => {
    if (!id) return undefined;
    const exact = list.find((d) => `swift:${d.id}` === id);
    if (exact) return exact.id;
    // Migrate existing Chromium device preferences by an unambiguous label.
    const named = list.filter((d) => d.label === label);
    if (named.length === 1) return named[0].id;
    throw Error("Select this device again in Settings → Devices.");
  };
  const clean = () => {
    generation++;
    for (const c of captures.values()) stopCapture(c);
    for (const p of publishers.values()) p.close();
    captures.clear();
    publishers.clear();
  };
  ipcMain.handle("native:devices", async (event, requestPermission) => {
    validateSender(event);
    if (requestPermission === true) await permission("camera");
    return sources(requestPermission === true);
  });
  ipcMain.handle("native:start", async (event, request) => {
    validateSender(event);
    if (
      !idOK(request?.id) ||
      !["camera", "screen"].includes(request.purpose) ||
      captures.has(request.id) ||
      pending.has(request.purpose) ||
      [...captures.values()].some((c) => c.purpose === request.purpose)
    )
      throw Error("Invalid or duplicate capture request");
    for (const name of ["device", "deviceLabel", "audioDevice", "audioLabel"])
      if (
        request[name] !== undefined &&
        (typeof request[name] !== "string" || request[name].length > 1024)
      )
        throw Error("Invalid capture device");
    const epoch = generation;
    const active = () => epoch === generation && !parent.isDestroyed();
    pending.add(request.purpose);
    try {
      await stopping.get(request.purpose);
      if (!active()) return null;
      const options = { purpose: request.purpose };
      if (request.purpose === "screen") {
        const list = await sources(true);
        const chosen = await chooseCapture(parent, request.audio === true, {
          native: true,
          sources: list.screens,
        });
        if (!chosen.video || !active()) return null;
        options.source = chosen.video.id;
        options.audio = !!chosen.audio;
        const size = chosen.video;
        const scale = Math.min(1920 / size.width, 1080 / size.height);
        if (Number.isFinite(scale) && size.width && size.height) {
          options.width = Math.max(
            128,
            Math.round((size.width * scale) / 2) * 2,
          );
          options.height = Math.max(
            128,
            Math.round((size.height * scale) / 2) * 2,
          );
        }
      } else {
        await permission("camera");
        if (request.audioDevice) await permission("microphone");
        const list = await sources(true);
        options.device = device(
          list.cameras,
          request.device,
          request.deviceLabel,
        );
        options.audioDevice = device(
          list.audio,
          request.audioDevice,
          request.audioLabel,
        );
      }
      if (!active()) return null;
      const capture = new Capture(worker, options);
      const entry = {
        capture,
        purpose: request.purpose,
        inflight: { video: [], audio: [] },
        queuedBytes: 0,
        needKey: true,
      };
      captures.set(request.id, entry);
      capture.on("failure", (error) => {
        captures.delete(request.id);
        stopCapture(entry);
        send({ id: request.id, kind: "error", message: error.message });
      });
      for (const kind of ["video-config", "audio-config"])
        capture.on(kind, (config) => send({ id: request.id, kind, config }));
      for (const kind of ["video", "audio"])
        capture.on(kind, (packet) => {
          // Bound the preview/PCM IPC queue. Native WebRTC video bypasses this
          // preview path and continues even when the UI is busy or minimized.
          const queue = entry.inflight[kind];
          const bytes = packet.data.byteLength;
          // Separate credits prevent PCM bursts from discarding a video GOP.
          // Allow brief scheduling stalls, while retaining hard count/byte caps.
          if (
            queue.length >= (kind === "video" ? 16 : 24) ||
            entry.queuedBytes + bytes > 8 * 1024 * 1024
          ) {
            if (kind === "video") entry.needKey = true;
            return;
          }
          if (kind === "video" && entry.needKey) {
            if (!packet.key) return;
            entry.needKey = false;
          }
          queue.push(bytes);
          entry.queuedBytes += bytes;
          send({
            id: request.id,
            kind,
            data: packet.data,
            timestamp: packet.timestamp,
            key: packet.key,
          });
        });
      try {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(
            () =>
              done(
                Error(
                  "SwiftCapture did not produce video. Check macOS capture permissions.",
                ),
              ),
            20000,
          );
          const success = () => done();
          const failure = (error) => done(error);
          const done = (error) => {
            clearTimeout(timer);
            capture.removeListener("video-config", success);
            capture.removeListener("failure", failure);
            error ? reject(error) : resolve();
          };
          capture.once("video-config", success);
          capture.once("failure", failure);
          capture.once("stopped", () => done(Error("Capture cancelled")));
        });
        if (!active()) {
          await stopCapture(entry);
          return null;
        }
        return {
          id: request.id,
          video: capture.video,
          audio: !!(options.audio || options.audioDevice),
        };
      } catch (error) {
        await stopCapture(entry);
        captures.delete(request.id);
        throw error;
      }
    } finally {
      pending.delete(request.purpose);
    }
  });
  ipcMain.on("native:ack", (event, id, kind) => {
    try {
      validateSender(event);
      const c = captures.get(id);
      if (c && (kind === "video" || kind === "audio"))
        c.queuedBytes -= c.inflight[kind].shift() ?? 0;
    } catch {}
  });
  ipcMain.handle("native:stop", async (event, id) => {
    validateSender(event);
    const entry = captures.get(id);
    captures.delete(id);
    if (entry) await stopCapture(entry);
  });
  ipcMain.handle("native:offer", async (event, request) => {
    validateSender(event);
    if (
      !idOK(request?.id) ||
      publishers.has(request.id) ||
      publishers.size >= 2 ||
      !Array.isArray(request.tracks) ||
      request.tracks.length < 1 ||
      request.tracks.length > 5
    )
      throw Error("Invalid native publisher request");
    const seen = new Set();
    const tracks = request.tracks.map((track) => {
      if (!purposes.includes(track.purpose) || seen.has(track.purpose))
        throw Error("Invalid native track");
      seen.add(track.purpose);
      if (["camera", "screen"].includes(track.purpose)) {
        const c = captures.get(track.capture);
        if (!c || c.purpose !== track.purpose)
          throw Error("Unknown native capture");
        return { purpose: track.purpose, fmtp: c.capture.video.fmtp };
      }
      if (track.capture !== undefined)
        throw Error("Invalid audio capture binding");
      return { purpose: track.purpose };
    });
    if (
      !Array.isArray(request.ice) ||
      request.ice.length > 8 ||
      JSON.stringify(request.ice).length > 32768
    )
      throw Error("Invalid ICE configuration");
    const publisher = new NativePublisher(publisherBinary);
    publisher.purposes = seen;
    publishers.set(request.id, publisher);
    publisher.on("failure", (error) => {
      publishers.delete(request.id);
      send({ id: request.id, kind: "error", message: error.message });
    });
    for (const t of request.tracks)
      if (t.capture) publisher.bind(t.purpose, captures.get(t.capture).capture);
    try {
      return await publisher.command({
        type: "offer",
        tracks,
        ice: request.ice,
        relay: request.relay === true,
      });
    } catch (error) {
      publisher.close();
      publishers.delete(request.id);
      throw error;
    }
  });
  ipcMain.handle("native:answer", async (event, id, sdp) => {
    validateSender(event);
    if (
      sdp?.type !== "answer" ||
      typeof sdp.sdp !== "string" ||
      sdp.sdp.length > 100000
    )
      throw Error("Invalid SDP answer");
    const publisher = publishers.get(id);
    if (!publisher) throw Error("Native publisher ended");
    if (publisher.answering || publisher.ready)
      throw Error("Native publisher already answered");
    publisher.answering = true;
    await publisher.command({ type: "answer", sdp });
    publisher.ready = true;
  });
  ipcMain.on("native:audio", (event, id, purpose, data, timestamp) => {
    try {
      validateSender(event);
      if (
        !["audio", "camera_audio", "screen_audio"].includes(purpose) ||
        !(data instanceof Uint8Array) ||
        data.byteLength > 4096 ||
        !Number.isSafeInteger(timestamp) ||
        timestamp < 0
      )
        return;
      const publisher = publishers.get(id);
      if (publisher?.purposes.has(purpose))
        publisher.packet(purpose, data, timestamp);
    } catch {}
  });
  ipcMain.handle("native:close-publisher", (event, id) => {
    validateSender(event);
    publishers.get(id)?.close();
    publishers.delete(id);
  });
  parent.webContents.on("render-process-gone", clean);
  parent.webContents.on(
    "did-start-navigation",
    (_event, _url, inPlace, mainFrame) => {
      if (mainFrame && !inPlace) clean();
    },
  );
  parent.once("closed", clean);
  app.on("before-quit", clean);
}
module.exports = { installNativeMedia };
