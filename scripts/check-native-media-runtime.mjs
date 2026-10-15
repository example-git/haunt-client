import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import vm from "node:vm";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { EventEmitter, once } from "node:events";
const require = createRequire(import.meta.url);
const { wsServer: WebSocketServer } = require(
  path.join(
    path.dirname(require.resolve("playwright-core/package.json")),
    "lib/utilsBundle.js",
  ),
);

async function fixture(root) {
  const directory = path.join(root, "native/mac");
  await fs.mkdir(directory, { recursive: true });
  await fs.copyFile(
    "tests/fixtures/swiftcapture-fixture.cjs",
    path.join(directory, "SwiftCaptureWorker"),
  );
  await fs.chmod(path.join(directory, "SwiftCaptureWorker"), 0o755);
  execFileSync(
    "go",
    [
      "build",
      "-o",
      path.join(directory, "HauntMediaWorker"),
      "./client/native/media-worker",
    ],
    { cwd: ".." },
  );
  const video = execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=1280x720:rate=60",
      "-frames:v",
      "120",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      "-profile:v",
      "baseline",
      "-pix_fmt",
      "yuv420p",
      "-x264-params",
      "aud=1:keyint=60:scenecut=0:bframes=0",
      "-f",
      "h264",
      "pipe:1",
    ],
    { maxBuffer: 4 * 1024 * 1024 },
  );
  const starts = [];
  for (let i = 0; i < video.length - 4; i++)
    if (
      video[i] === 0 &&
      video[i + 1] === 0 &&
      video[i + 2] === 0 &&
      video[i + 3] === 1 &&
      (video[i + 4] & 31) === 9
    )
      starts.push(i);
  const frames = starts.map((start, i) => {
    const data = video.subarray(start, starts[i + 1] ?? video.length);
    let key = false;
    for (let n = 0; n < data.length - 3; n++)
      if (
        data[n] === 0 &&
        data[n + 1] === 0 &&
        data[n + 2] === 1 &&
        (data[n + 3] & 31) === 5
      )
        key = true;
    return { data: data.toString("base64"), key };
  });
  const nals = [];
  for (let i = 0; i < video.length - 3; i++)
    if (video[i] === 0 && video[i + 1] === 0 && video[i + 2] === 1)
      nals.push(i + 3);
  const parameterSets = nals
    .filter((i) => [7, 8].includes(video[i] & 31))
    .slice(0, 2)
    .map((i) => {
      let end = nals[nals.indexOf(i) + 1] - 3;
      while (video[end - 1] === 0) end--;
      return video.subarray(i, end).toString("base64");
    });
  assert.equal(frames.filter((f) => f.key).length, 2);
  assert.equal(frames.length, 120);
  assert.equal(parameterSets.length, 2);
  await fs.writeFile(
    path.join(directory, "frames.json"),
    JSON.stringify({ frames, parameterSets }),
  );
}

async function attachNativeShell(page, root) {
  // Exercise the production Electron handlers and real FD/RTC children on Linux,
  // substituting only Electron's UI/permission APIs and the macOS capture binary.
  const handlers = new Map(),
    listeners = new Map();
  const app = new EventEmitter();
  app.isPackaged = true;
  const parent = new EventEmitter();
  parent.isDestroyed = () => false;
  const contents = new EventEmitter();
  parent.webContents = contents;
  contents.mainFrame = { url: "https://app.chatxo.local" };
  const failures = [];
  const counts = {};
  const socketServer = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
    maxPayload: 16384,
  });
  await once(socketServer, "listening");
  let socket;
  socketServer.on("connection", (client) => {
    if (socket) {
      client.close();
      return;
    }
    socket = client;
    client.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      const event = { sender: contents, senderFrame: contents.mainFrame };
      if (message.type === "ack")
        listeners.get("native:ack")(event, message.id, message.kind);
      if (message.type === "audio")
        listeners.get("native:audio")(
          event,
          message.id,
          message.purpose,
          Buffer.from(message.data, "base64"),
          message.timestamp,
        );
    });
  });
  contents.send = (_channel, event) => {
    if (event.kind === "error") failures.push(event.message);
    counts[event.kind] = (counts[event.kind] || 0) + 1;
    const data = event.data
      ? Buffer.from(
          event.data.buffer,
          event.data.byteOffset,
          event.data.byteLength,
        )
      : Buffer.alloc(0);
    // Match Electron's binary IPC payloads. Base64 + per-byte JS conversion
    // made the simulated shell itself a bottleneck with multiple HD60 feeds.
    const header = Buffer.from(JSON.stringify({ ...event, data: undefined }));
    const length = Buffer.alloc(4);
    length.writeUInt32BE(header.length);
    socket?.send(Buffer.concat([length, header, data]));
  };
  const electron = {
    app,
    ipcMain: {
      handle: (name, fn) => handlers.set(name, fn),
      on: (name, fn) => listeners.set(name, fn),
    },
    systemPreferences: {
      getMediaAccessStatus: () => "granted",
      askForMediaAccess: async () => true,
    },
  };
  const entry = path.resolve("apps/desktop/native-media.cjs");
  const localRequire = createRequire(entry);
  const Base = localRequire("./native-publisher.cjs").NativePublisher;
  const captureModule = localRequire("./swiftcapture.cjs");
  const activeCaptures = new Map();
  class CheckedCapture extends captureModule.Capture {
    constructor(binary, options) {
      const previous = activeCaptures.get(options.purpose);
      assert(
        !previous ||
          previous.child.exitCode !== null ||
          previous.child.signalCode !== null,
        "Replacement capture must wait for its own previous worker to release the device",
      );
      super(binary, options);
      activeCaptures.set(options.purpose, this);
    }
  }
  class DebugPublisher extends Base {
    message(m) {
      counts.publisherState = m.state ?? counts.publisherState;
      super.message(m);
    }
    packet(...args) {
      counts["rtc-" + args[0]] = (counts["rtc-" + args[0]] || 0) + 1;
      counts.ready = this.ready;
      super.packet(...args);
    }
  }
  const box = {
    module: { exports: {} },
    exports: {},
    require: (name) =>
      name === "electron"
        ? electron
        : name === "./capture-picker.cjs"
          ? {
              chooseCapture: async (_parent, _audio, options) => {
                assert(options.native);
                assert.equal(
                  options.sources[1].id,
                  "window:123:0",
                  "Native catalog supplies the window picker",
                );
                return { video: options.sources[1], audio: "loopback" };
              },
            }
          : name === "./native-publisher.cjs"
            ? { ...localRequire(name), NativePublisher: DebugPublisher }
            : name === "./swiftcapture.cjs"
              ? { ...captureModule, Capture: CheckedCapture }
              : localRequire(name),
    __dirname: path.dirname(entry),
    process: { platform: "darwin", arch: "arm64", resourcesPath: root },
    setTimeout,
    clearTimeout,
    Uint8Array,
  };
  vm.runInNewContext(await fs.readFile(entry, "utf8"), box);
  box.module.exports.installNativeMedia(parent, (event) => {
    if (event.sender !== contents || event.senderFrame !== contents.mainFrame)
      throw Error("Untrusted sender");
  });
  await assert.rejects(
    () => handlers.get("native:devices")({ sender: {}, senderFrame: {} }),
    /Untrusted/,
  );
  const event = { sender: contents, senderFrame: contents.mainFrame };
  await page.exposeFunction("nativeInvoke", async (name, args) => {
    try {
      return await handlers.get(name)(event, ...args);
    } catch (e) {
      console.error("invoke error", name, e.message);
      throw e;
    }
  });
  await page.evaluate(async (port) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    socket.binaryType = "arraybuffer";
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = reject;
    });
    const callbacks = new Set();
    const text = new TextDecoder();
    socket.onmessage = ({ data }) => {
      const headerLength = new DataView(data).getUint32(0);
      const event = JSON.parse(
        text.decode(new Uint8Array(data, 4, headerLength)),
      );
      if (data.byteLength > 4 + headerLength) {
        const bytes = new Uint8Array(data, 4 + headerLength);
        event.data =
          event.kind === "audio"
            ? new Float32Array(bytes.slice().buffer)
            : bytes;
      }
      try {
        for (const callback of callbacks) callback(event);
      } finally {
        if (event.kind === "video" || event.kind === "audio")
          socket.send(
            JSON.stringify({ type: "ack", id: event.id, kind: event.kind }),
          );
      }
    };
    window.nativeVideoEncodes = 0;
    window.nativeRTCVideoTracks = 0;
    const Peer = RTCPeerConnection;
    window.RTCPeerConnection = class extends Peer {
      addTrack(track, ...streams) {
        if (track.kind === "video") window.nativeRTCVideoTracks++;
        return super.addTrack(track, ...streams);
      }
    };
    const Encoder = VideoEncoder;
    window.VideoEncoder = class extends Encoder {
      encode(...args) {
        window.nativeVideoEncodes++;
        return super.encode(...args);
      }
    };
    window.hauntDesktop = {
      nativeCaptureAvailable: true,
      platform: "darwin",
      nativeDevices: (permission) =>
        window.nativeInvoke("native:devices", [permission]),
      nativeStart: (value) => window.nativeInvoke("native:start", [value]),
      nativeStop: (id) => window.nativeInvoke("native:stop", [id]),
      onNativeEvent: (callback) => {
        callbacks.add(callback);
        return () => callbacks.delete(callback);
      },
      nativeOffer: (value) => window.nativeInvoke("native:offer", [value]),
      nativeAnswer: (id, sdp) =>
        window.nativeInvoke("native:answer", [id, sdp]),
      nativeAudio: (id, purpose, data, timestamp) =>
        socket.send(
          JSON.stringify({
            type: "audio",
            id,
            purpose,
            timestamp,
            data: btoa(String.fromCharCode(...data)),
          }),
        ),
      nativeClosePublisher: (id) =>
        window.nativeInvoke("native:close-publisher", [id]),
      windowState: async () => ({
        target: "main",
        maximized: false,
        fullscreen: false,
      }),
      windowControl: async () => {},
      onWindowState: () => () => {},
      onCallWindowClosed: () => () => {},
      setBadge: async () => {},
      onNotificationClick: () => () => {},
    };
  }, socketServer.address().port);
  return {
    failures,
    checkRestart: async () => {
      const first = randomUUID(),
        second = randomUUID();
      await handlers.get("native:start")(event, {
        id: first,
        purpose: "camera",
      });
      const stopped = handlers.get("native:stop")(event, first);
      await handlers.get("native:start")(event, {
        id: second,
        purpose: "camera",
      });
      await stopped;
      await handlers.get("native:stop")(event, second);
      console.log("Native worker replacement waits for device release.");
    },
    close: () => {
      parent.emit("closed");
      socket?.terminate();
      socketServer.close();
    },
    counts,
  };
}

// Check both rendered PCM rates after the real Opus relay/decoder. The host's
// physical output format is not under test; these are real browser resamplers.
async function checkAudioPitch(locator, label) {
  for (const rate of [44100, 48000]) {
    const measured = await locator.evaluate(async (element, sampleRate) => {
      const context = new AudioContext({
        sampleRate,
        latencyHint: "interactive",
      });
      const source = context.createMediaStreamSource(element.srcObject);
      const splitter = context.createChannelSplitter(2);
      const analysers = [context.createAnalyser(), context.createAnalyser()];
      source.connect(splitter);
      for (let ch = 0; ch < 2; ch++) {
        analysers[ch].fftSize = 8192;
        analysers[ch].smoothingTimeConstant = 0;
        splitter.connect(analysers[ch], ch);
      }
      await context.resume();
      const measurements = [];
      try {
        for (let n = 0; n < 20; n++) {
          await new Promise((r) => setTimeout(r, 50));
          const channels = analysers.map((analyser) => {
            const bins = new Float32Array(analyser.frequencyBinCount);
            analyser.getFloatFrequencyData(bins);
            let bin = 0;
            for (let i = 1; i < bins.length; i++)
              if (bins[i] > bins[bin]) bin = i;
            return {
              frequency: (bin * sampleRate) / analyser.fftSize,
              db: bins[bin],
            };
          });
          if (channels.every((c) => c.db > -35)) measurements.push(channels);
        }
      } finally {
        source.disconnect();
        splitter.disconnect();
        await context.close();
      }
      return measurements;
    }, rate);
    assert(
      measured.length > 5,
      `${label}: missing sustained stereo audio at ${rate} Hz`,
    );
    // RTC's jitter buffer can time-stretch during startup. Check sustained
    // pitch across the window; a mislabeled sample rate shifts every frame.
    const stable = measured.filter(
      (channels) =>
        Math.abs(channels[0].frequency - 440) < 12 &&
        Math.abs(channels[1].frequency - 880) < 12,
    );
    assert(
      stable.length >= measured.length * 0.75,
      `${label}: unstable or incorrect pitch at ${rate}: ${JSON.stringify(measured)}`,
    );
    console.log(
      `PASS ${label} → Opus → ${rate} Hz: stereo 440/880 Hz preserved`,
    );
  }
}

export async function checkNativeMedia(browser, fixtures) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "haunt-native-test-"));
  await fixture(root);
  try {
    for (const [mode, server] of [
      ["rtc", fixtures.rtc],
      ["ws", fixtures.ws],
    ].filter(
      ([mode]) =>
        !process.env.HAUNT_NATIVE_TEST_TRANSPORT ||
        mode === process.env.HAUNT_NATIVE_TEST_TRANSPORT,
    )) {
      const contexts = await Promise.all([
        browser.newContext({ permissions: ["microphone", "camera"] }),
        browser.newContext({ permissions: ["microphone", "camera"] }),
      ]);
      let host;
      const errors = [];
      try {
        const [sender, receiver] = await Promise.all(
          contexts.map((c) => c.newPage()),
        );
        for (const page of [sender, receiver]) {
          page.setDefaultTimeout(25000);
          page.on("pageerror", (e) => errors.push(e.message));
          await page.addInitScript(() => {
            window.videoSupportProbes = [];
            window.videoDecoderConfigs = [];
            const Decoder = VideoDecoder;
            window.VideoDecoder = class extends Decoder {
              static isConfigSupported(config) {
                window.videoSupportProbes.push(config);
                return Decoder.isConfigSupported(config);
              }
              configure(config) {
                window.videoDecoderConfigs.push(config);
                return super.configure(config);
              }
            };
          });
        }
        for (const [page, user] of [
          [sender, "alice"],
          [receiver, "bob"],
        ]) {
          await page.goto("http://127.0.0.1:5173");
          await page
            .getByRole("button", { name: "Add server", exact: true })
            .click();
          await page.getByLabel("Server address").fill(server.url);
          await page.getByLabel("Username", { exact: true }).fill(user);
          await page
            .getByLabel("Password", { exact: true })
            .fill(fixtures.password);
          await page
            .getByRole("button", { name: "Sign in", exact: true })
            .click();
          await expect(page.getByRole("dialog")).toHaveCount(0);
        }
        // Playwright enables DevTools Network recording by default, which copies
        // every binary media WebSocket packet into its automation connection.
        // This high-rate check asserts media/UI state, not network events. Stop
        // that recording on Playwright's existing sessions (a new CDP session
        // would leave its recorder running). Fail visibly if the pinned driver's
        // internal hook changes. Actual media sockets and HTTP stay untouched.
        for (const page of [sender, receiver]) {
          const sessions =
            page._connection.toImpl(page).delegate._networkManager._sessions;
          assert(
            sessions?.size,
            "Playwright Chromium network sessions unavailable",
          );
          await Promise.all(
            [...sessions.keys()].map((session) =>
              session.send("Network.disable"),
            ),
          );
        }
        host = await attachNativeShell(sender, root);
        await host.checkRestart();
        await sender.evaluate(() => {
          window.nativeChromiumCameraRequests = 0;
          const get = navigator.mediaDevices.getUserMedia.bind(
            navigator.mediaDevices,
          );
          navigator.mediaDevices.getUserMedia = (constraints) => {
            if (constraints.video) {
              window.nativeChromiumCameraRequests++;
              throw new DOMException(
                "Camera is in use by another application",
                "NotReadableError",
              );
            }
            return get(constraints);
          };
        });
        await sender
          .getByRole("button", { name: "Account settings", exact: true })
          .click();
        await sender
          .getByRole("button", { name: "Devices", exact: true })
          .click();
        await sender
          .getByLabel("Default webcam", { exact: true })
          .selectOption("swift:fixture-camera");
        await sender
          .getByRole("button", { name: "Allow camera access", exact: true })
          .click();
        await sender
          .getByLabel("Camera audio source", { exact: true })
          .selectOption("swift:fixture-audio");
        await sender
          .getByRole("button", { name: "Close", exact: true })
          .click();
        for (const page of [sender, receiver])
          await page
            .locator(`[data-channel-id="${server.voice}"] button.channel`)
            .click();
        await expect(sender.locator(".call-dock")).toBeVisible();
        await sender
          .locator(".call-dock")
          .getByRole("button", { name: "Turn on camera", exact: true })
          .click();
        await expect
          .poll(
            () =>
              receiver
                .locator(".call-panel video")
                .evaluateAll(
                  (videos) =>
                    videos.filter(
                      (v) =>
                        v.videoWidth === 1280 &&
                        v.videoHeight === 720 &&
                        v.readyState >= 2,
                    ).length,
                ),
            { timeout: 20000 },
          )
          .toBeGreaterThan(0)
          .catch(async (error) => {
            console.error(
              "Native diagnostics:",
              errors,
              host.failures,
              host.counts,
              await sender.locator(".error").allTextContents(),
              await sender.locator("video").evaluateAll((v) =>
                v.map((x) => ({
                  w: x.videoWidth,
                  h: x.videoHeight,
                  state: x.readyState,
                })),
              ),
              await receiver.locator("video").evaluateAll((v) =>
                v.map((x) => ({
                  w: x.videoWidth,
                  h: x.videoHeight,
                  state: x.readyState,
                })),
              ),
            );
            throw error;
          });
        const sourceAudio = receiver.locator(
          '.call-panel audio[aria-label$=" · camera_audio"]',
        );
        await expect(sourceAudio).toHaveCount(1);
        await checkAudioPitch(sourceAudio, `${mode} 44.1 kHz camera`);
        await sender
          .locator(".call-dock")
          .getByRole("button", { name: "Share screen", exact: true })
          .click();
        await expect
          .poll(
            () =>
              receiver
                .locator(".call-panel video")
                .evaluateAll(
                  (videos) =>
                    videos.filter(
                      (v) =>
                        v.videoWidth === 1280 &&
                        v.videoHeight === 720 &&
                        v.readyState >= 2,
                    ).length,
                ),
            { timeout: 20000 },
          )
          .toBeGreaterThanOrEqual(2);
        await expect(
          receiver.locator('.call-panel audio[aria-label$=" · screen_audio"]'),
        ).toHaveCount(1);
        await checkAudioPitch(
          receiver.locator('.call-panel audio[aria-label$=" · screen_audio"]'),
          `${mode} 48 kHz screen`,
        );
        // Measure presented frames in both clients with simultaneous 720p60
        // camera + screen feeds. This catches the former ~20–30 fps preview cap.
        const frameRates = await Promise.all(
          [sender, receiver].map((page) =>
            page.locator(".call-panel video").evaluateAll(async (videos) => {
              return Promise.all(
                videos.map(
                  (video) =>
                    new Promise((resolve) => {
                      let first, last, start, handle;
                      const timeout = setTimeout(() => {
                        video.cancelVideoFrameCallback(handle);
                        resolve(0);
                      }, 6000);
                      const frame = (now, meta) => {
                        if (first === undefined) {
                          first = meta.presentedFrames;
                          start = now;
                        }
                        last = meta.presentedFrames;
                        if (now - start >= 3000) {
                          clearTimeout(timeout);
                          resolve(((last - first) * 1000) / (now - start));
                        } else handle = video.requestVideoFrameCallback(frame);
                      };
                      handle = video.requestVideoFrameCallback(frame);
                    }),
                ),
              );
            }),
          ),
        );
        console.log(
          `Native ${mode} 720p60 presented fps:`,
          JSON.stringify(frameRates),
        );
        for (const rates of frameRates) {
          assert.equal(rates.length, 2);
          // This shared Linux host measures presentation, not Apple hardware
          // decode throughput. Catch a 30 fps cap without requiring every feed
          // to sustain 60 fps under concurrent host load.
          assert(
            rates.every((fps) => fps > 35),
            "Both local and remote feeds must exceed the former 30 fps limit",
          );
        }
        await sender.bringToFront();
        const captureDiagnostics = await sender.evaluate(() => ({
          chromiumCameraRequests: window.nativeChromiumCameraRequests,
          videoEncodes: window.nativeVideoEncodes,
          rtcVideoTracks: window.nativeRTCVideoTracks,
          hardwareRequested: window.videoSupportProbes.some(
            (c) => c.hardwareAcceleration === "prefer-hardware",
          ),
        }));
        assert.deepEqual(
          captureDiagnostics,
          {
            chromiumCameraRequests: 0,
            videoEncodes: 0,
            rtcVideoTracks: 0,
            hardwareRequested: true,
          },
          "Native capture avoids Chromium camera opens and a second encode, and prefers hardware decoding",
        );
        if (mode === "ws")
          assert(
            await receiver.evaluate(() =>
              window.videoSupportProbes.some(
                (c) => c.hardwareAcceleration === "prefer-hardware",
              ),
            ),
          );
        const clickControl = async (name) => {
          await sender.bringToFront();
          await sender
            .locator(".call-dock")
            .getByRole("button", { name, exact: true })
            .click();
        };
        console.log(`Native ${mode}: stopping camera`);
        await clickControl("Turn off camera");
        await expect(
          receiver.locator('.call-panel audio[aria-label$=" · camera_audio"]'),
        ).toHaveCount(0);
        console.log(`Native ${mode}: stopping screen`);
        await clickControl("Stop sharing screen");
        await expect(
          receiver.locator('.call-panel audio[aria-label$=" · screen_audio"]'),
        ).toHaveCount(0);
        console.log(`Native ${mode}: leaving`);
        await clickControl("Leave call");
        await expect(sender.locator(".call-dock")).toHaveCount(0);
        assert.deepEqual(errors, []);
        assert.deepEqual(host.failures, []);
        console.log(
          `Native ${mode}: camera + screen H.264, source audio, unmodified video, stop/reconfigure passed.`,
        );
      } catch (error) {
        console.error(`Native ${mode} failure:`, error);
        console.error("Native errors:", errors, host?.failures, host?.counts);
        for (const context of contexts)
          for (const page of context.pages()) {
            console.error(
              "Native UI:",
              await Promise.race([
                page
                  .evaluate(() => ({
                    dock: document.querySelector(".call-dock")?.textContent,
                    alerts: [
                      ...document.querySelectorAll('[role="alert"]'),
                    ].map((e) => e.textContent),
                    buttons: [
                      ...document.querySelectorAll(".call-dock button"),
                    ].map((b) => ({
                      name: b.getAttribute("aria-label"),
                      disabled: b.disabled,
                    })),
                  }))
                  .catch(() => "closed"),
                new Promise((resolve) =>
                  setTimeout(() => resolve("unresponsive"), 5000),
                ),
              ]),
            );
          }
        throw error;
      } finally {
        host?.close();
        for (const context of contexts) await context.close();
      }
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
