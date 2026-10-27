const { app, ipcMain, systemPreferences } = require("electron");
const path = require("node:path");
const { Capture, listSources } = require("./swiftcapture.cjs");
const { NativePublisher, purposes } = require("./native-publisher.cjs");
const { chooseCapture } = require("./capture-picker.cjs");
const linux = require("./linux-capture.cjs");

function installNativeMedia(parent, validateSender) {
  const linuxNative = process.platform === "linux";
  const macNative = process.platform === "darwin" && process.arch === "arm64";
  // Sandboxed preloads do not expose all of Node's process properties. Resolve
  // architecture in the main process, before the first renderer is loaded.
  ipcMain.on("native:available", (event) => {
    try {
      validateSender(event);
      event.returnValue = macNative;
    } catch {
      event.returnValue = false;
    }
  });
  ipcMain.on("native:screen-available", (event) => {
    try {
      validateSender(event);
      event.returnValue = linuxNative || macNative;
    } catch {
      event.returnValue = false;
    }
  });
  if (!macNative && !linuxNative) return;
  const root = app.isPackaged
    ? path.join(
        process.resourcesPath,
        linuxNative ? "native/linux" : "native/mac",
      )
    : path.join(
        __dirname,
        linuxNative ? "../../release/native/linux" : "../../static/native/mac",
      );
  const worker = path.join(
    root,
    linuxNative ? "HauntCaptureWorker" : "SwiftCaptureWorker",
  );
  const CaptureWorker = linuxNative ? linux.LinuxCapture : Capture;
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
  let catalog, catalogTimer;
  let disposed = false;
  const idOK = (id) => typeof id === "string" && /^[a-f0-9-]{36}$/.test(id);
  const send = (message) => {
    if (!parent.isDestroyed()) parent.webContents.send("native:event", message);
  };
  const refreshSources = () => {
    if (!catalogPending)
      catalogPending = (linuxNative ? linux.listSources : listSources)(worker)
        .then((value) => {
          const devicesChanged =
            !!catalog &&
            JSON.stringify([catalog.cameras, catalog.audio]) !==
              JSON.stringify([value.cameras, value.audio]);
          if (JSON.stringify(catalog) !== JSON.stringify(value))
            catalog = value;
          if (devicesChanged && !disposed)
            send({
              id: "",
              kind: "devices",
              devices: { cameras: catalog.cameras, audio: catalog.audio },
            });
          return catalog;
        })
        .finally(() => {
          catalogPending = undefined;
        });
    return catalogPending;
  };
  const sources = async () => {
    if (!catalogTimer && !disposed) {
      catalogTimer = setInterval(() => {
        void refreshSources().catch(() => {});
      }, 30000);
      catalogTimer.unref();
    }
    return catalog ?? refreshSources();
  };
  const permission = async (kind) => {
    if (systemPreferences.getMediaAccessStatus(kind) === "granted")
      return false;
    if (!(await systemPreferences.askForMediaAccess(kind)))
      throw Error(`Enable ${kind} access for Haunt in macOS System Settings.`);
    return true;
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
    if (requestPermission === true && (await permission("camera")))
      await refreshSources();
    return sources();
  });
  const startCapture = async (event, request, replacement) => {
    validateSender(event);
    if (
      !idOK(request?.id) ||
      !["camera", "screen"].includes(request.purpose) ||
      (captures.has(request.id) && !replacement) ||
      pending.has(request.purpose) ||
      [...captures.values()].some(
        (c) => c.purpose === request.purpose && c !== replacement,
      )
    )
      throw Error("Invalid or duplicate capture request");
    if (linuxNative && request.purpose !== "screen")
      throw Error("Use browser capture for Linux cameras.");
    for (const name of ["device", "deviceLabel", "audioDevice", "audioLabel"])
      if (
        request[name] !== undefined &&
        (typeof request[name] !== "string" || request[name].length > 1024)
      )
        throw Error("Invalid capture device");
    if (
      ![request.width, request.height, request.fps].every(
        (v) => Number.isFinite(v) && v > 0,
      ) ||
      !Number.isInteger(request.width) ||
      !Number.isInteger(request.height) ||
      request.width > 8192 ||
      request.height > 8192 ||
      request.fps > 1000
    )
      throw Error("Select an available capture resolution and frame rate.");
    if (request.purpose === "camera" && !Number.isInteger(request.fps))
      throw Error("Choose a whole-number camera frame rate.");
    const epoch = generation;
    const active = () => epoch === generation && !parent.isDestroyed();
    pending.add(request.purpose);
    try {
      await stopping.get(request.purpose);
      if (!active()) return null;
      const options = {
        purpose: request.purpose,
        width: request.width,
        height: request.height,
        fps: request.fps,
      };
      if (request.purpose === "screen") {
        if (![15, 30, 60].includes(request.fps))
          throw Error("Screen capture supports 15, 30 or 60 FPS.");
        const list = linuxNative ? await refreshSources() : await sources();
        const chosen = replacement
          ? { video: replacement.source, audio: replacement.options.audio }
          : await chooseCapture(parent, request.audio === true, {
              native: true,
              sources: list.screens,
              ...(linuxNative ? { linuxNative: list } : {}),
            });
        if (!chosen.video || !active()) return null;
        options.source = chosen.video.id;
        options.audio = !!chosen.audio;
        if (linuxNative) {
          options.audioSource = chosen.linuxAudio?.id;
          options.audio = !!options.audioSource;
        }
        const size = chosen.video;
        options.sourceSize = size;
        const scale = Math.min(
          1,
          request.width / size.width,
          request.height / size.height,
        );
        if (Number.isFinite(scale) && size.width && size.height) {
          options.width = Math.max(2, Math.floor((size.width * scale) / 2) * 2);
          options.height = Math.max(
            2,
            Math.floor((size.height * scale) / 2) * 2,
          );
        }
      } else {
        let granted = await permission("camera");
        if (request.audioDevice)
          granted = (await permission("microphone")) || granted;
        if (granted) await refreshSources();
        const list = await sources();
        options.device = device(
          list.cameras,
          replacement ? `swift:${replacement.options.device}` : request.device,
          request.deviceLabel,
        );
        const camera =
          list.cameras.find((c) => c.id === options.device) ??
          (!options.device ? list.cameras[0] : undefined);
        if (
          !camera?.formats.some(
            (f) =>
              f.width === request.width &&
              f.height === request.height &&
              Math.round(f.minFPS) <= request.fps &&
              Math.round(f.maxFPS) >= request.fps,
          )
        )
          throw Error(
            "The selected camera mode is unavailable on this device.",
          );
        options.device = camera.id;
        options.audioDevice = device(
          list.audio,
          request.audioDevice,
          request.audioLabel,
        );
      }
      if (!active()) return null;
      if (replacement) {
        await stopCapture(replacement);
        captures.delete(request.id);
      }
      const capture = new CaptureWorker(worker, options);
      const entry = {
        capture,
        purpose: request.purpose,
        options,
        source: options.sourceSize,
        request,
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
                  linuxNative
                    ? "Linux capture did not produce video. Check the screen sharing portal."
                    : "SwiftCapture did not produce video. Check macOS capture permissions.",
                ),
              ),
            linuxNative ? 150000 : 20000,
          );
          const success = () => done();
          const failure = (error) => done(error);
          const stopped = () => done(Error("Capture cancelled"));
          const done = (error) => {
            clearTimeout(timer);
            capture.removeListener("video-config", success);
            capture.removeListener("failure", failure);
            capture.removeListener("stopped", stopped);
            error ? reject(error) : resolve();
          };
          capture.once("video-config", success);
          capture.prependOnceListener("failure", failure);
          capture.once("stopped", stopped);
        });
        if (!active()) {
          await stopCapture(entry);
          return null;
        }
        if (
          (linuxNative
            ? capture.video.width > options.width
            : capture.video.width !== options.width) ||
          (linuxNative
            ? capture.video.height > options.height
            : capture.video.height !== options.height) ||
          Math.abs(capture.video.fps - options.fps) > 0.1
        )
          throw Error(
            "The capture backend did not provide the selected resolution and frame rate.",
          );
        if (replacement)
          for (const publisher of publishers.values()) {
            for (const binding of publisher.captureBindings ?? [])
              if (binding.capture === request.id)
                publisher.bind(binding.purpose, capture);
          }
        return {
          id: request.id,
          video: capture.video,
          audio: !!(options.audio || options.audioDevice),
        };
      } catch (error) {
        await stopCapture(entry);
        captures.delete(request.id);
        if (linuxNative && error.message === "Capture cancelled") return null;
        if (replacement)
          send({ id: request.id, kind: "error", message: error.message });
        throw error;
      }
    } finally {
      pending.delete(request.purpose);
    }
  };
  ipcMain.handle("native:start", (event, request) =>
    startCapture(event, request),
  );
  ipcMain.handle("native:configure", async (event, id, mode) => {
    validateSender(event);
    const entry = captures.get(id);
    if (!entry) throw Error("Capture source is no longer available.");
    if (linuxNative) {
      if (
        !Number.isInteger(mode?.width) ||
        !Number.isInteger(mode?.height) ||
        mode.width < 2 ||
        mode.height < 2 ||
        mode.width > 8192 ||
        mode.height > 8192 ||
        ![15, 30, 60].includes(mode?.fps)
      )
        throw Error("Invalid screen capture mode.");
      if (pending.has(entry.purpose))
        throw Error("Capture mode change is already in progress.");
      pending.add(entry.purpose);
      try {
        const video = await entry.capture.configure(mode);
        entry.request = { ...entry.request, ...mode };
        return { id, video, audio: entry.options.audio };
      } finally {
        pending.delete(entry.purpose);
      }
    }
    return startCapture(
      event,
      {
        ...entry.request,
        width: mode?.width,
        height: mode?.height,
        fps: mode?.fps,
      },
      entry,
    );
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
        const browserCamera =
          linuxNative &&
          track.purpose === "camera" &&
          track.capture === undefined &&
          track.codec === "avc1.42e033";
        if (!browserCamera && (!c || c.purpose !== track.purpose))
          throw Error("Unknown native capture");
        if (
          track.layers !== undefined &&
          (!Array.isArray(track.layers) ||
            track.layers.length > 3 ||
            track.layers.some((layer) => !["h", "m", "l"].includes(layer.id)) ||
            new Set(track.layers.map((layer) => layer.id)).size !==
              track.layers.length)
        )
          throw Error("Invalid native video layers");
        return {
          purpose: track.purpose,
          fmtp: browserCamera
            ? "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e033"
            : c.capture.video.fmtp,
          layers: track.layers?.map((layer) => layer.id),
        };
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
    publisher.captureBindings = request.tracks.filter((track) => track.capture);
    publisher.browserBindings = request.tracks.filter(
      (track) => track.codec && !track.capture,
    );
    publisher.on("keyframe", (message) =>
      send({
        id: request.id,
        kind: "keyframe",
        purpose: message.purpose,
        layer: message.layer,
      }),
    );
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
  ipcMain.handle(
    "native:video",
    (event, id, purpose, layer, data, timestamp, key) => {
      validateSender(event);
      const publisher = publishers.get(id);
      if (
        !publisher ||
        !["camera", "screen"].includes(purpose) ||
        !["h", "m", "l"].includes(layer) ||
        !(data instanceof Uint8Array) ||
        data.byteLength > 1024 * 1024 ||
        !Number.isSafeInteger(timestamp) ||
        timestamp < 0 ||
        typeof key !== "boolean" ||
        !(
          publisher.captureBindings?.some(
            (track) =>
              layer !== "h" &&
              track.purpose === purpose &&
              track.layers?.some((item) => item.id === layer),
          ) ||
          publisher.browserBindings?.some(
            (track) =>
              track.purpose === purpose &&
              (track.layers?.some((item) => item.id === layer) ||
                layer === "h"),
          )
        )
      )
        throw Error("Invalid lower-layer video packet");
      publisher.packet(purpose, data, timestamp, key, layer);
    },
  );
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
  const dispose = () => {
    disposed = true;
    clearInterval(catalogTimer);
    clean();
  };
  parent.once("closed", dispose);
  app.on("before-quit", dispose);
}
module.exports = { installNativeMedia };
