import { expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import vm from "node:vm";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const {
  PacketReader,
  stereoPCM,
  audioConfig,
  videoConfig,
  argumentsFor,
  sourceCatalog,
} = require("../apps/desktop/swiftcapture.cjs");
it("uses SwiftCapture catalogs for screens, windows and busy connected cameras", () => {
  const frame = { width: 1920, height: 1080 };
  const catalog = sourceCatalog({
    webcams: [
      {
        uniqueID: "busy",
        name: "Capture card",
        connected: true,
        inUse: true,
        formats: [
          { width: 1920, height: 1080, minFPS: 15, maxFPS: 120 },
          { width: 1280, height: 720, minFPS: 30, maxFPS: 240 },
        ],
      },
      { uniqueID: "gone", connected: false },
    ],
    video: {
      displays: [{ electronSourceId: "screen:1:0", name: "Display", frame }],
      applications: [
        {
          name: "App",
          windows: [
            {
              electronSourceId: "window:12:0",
              title: "Sharing",
              frame,
              isOnScreen: true,
            },
            { electronSourceId: "window:12:0", title: "Duplicate", frame },
            { electronSourceId: "window:13:0", frame, isOnScreen: false },
            { electronSourceId: "malformed", frame },
          ],
        },
      ],
    },
  });
  expect(catalog.cameras).toEqual([
    {
      id: "busy",
      label: "Capture card",
      formats: [
        { width: 1920, height: 1080, minFPS: 15, maxFPS: 120 },
        { width: 1280, height: 720, minFPS: 30, maxFPS: 240 },
      ],
    },
  ]);
  expect(catalog.screens).toEqual([
    { id: "screen:1:0", name: "Display", width: 1920, height: 1080 },
    { id: "window:12:0", name: "App — Sharing", width: 1920, height: 1080 },
  ]);
});
it("acknowledges each native IPC packet once with multiple listeners", () => {
  const events = new Map<string, Function>();
  const sent: unknown[] = [];
  let bridge: any;
  const ipcRenderer = {
    on: (name: string, fn: Function) => events.set(name, fn),
    send: (...args: unknown[]) => sent.push(args),
    sendSync: () => true,
  };
  vm.runInNewContext(
    fs.readFileSync(
      new URL("../apps/desktop/preload.cjs", import.meta.url),
      "utf8",
    ),
    {
      process: { platform: "darwin" },
      require: () => ({
        ipcRenderer,
        contextBridge: {
          exposeInMainWorld: (_: string, value: any) => {
            bridge = value;
          },
        },
      }),
    },
  );
  let callbacks = 0;
  const one = bridge.onNativeEvent(() => callbacks++),
    two = bridge.onNativeEvent(() => callbacks++);
  events.get("native:event")!({}, { id: "first", kind: "video" });
  expect(callbacks).toBe(2);
  expect(sent).toEqual([["native:ack", "first", "video"]]);
  one();
  two();
  events.get("native:event")!({}, { id: "second", kind: "audio" });
  expect(sent).toEqual([
    ["native:ack", "first", "video"],
    ["native:ack", "second", "audio"],
  ]);
  expect(bridge.nativeCaptureAvailable).toBe(true);
});
function packet(type: number, data: Buffer) {
  const b = Buffer.alloc(24 + data.length);
  b.write("SCAP");
  b[4] = 1;
  b[5] = type;
  b.writeUInt16BE(1, 6);
  b.writeBigUInt64BE(1234567890n, 8);
  b.writeUInt32BE(data.length, 16);
  data.copy(b, 24);
  return b;
}
function nativeShell(cadence = 59.94) {
  const handlers = new Map<string, Function>();
  const children: any[] = [];
  const captures: any[] = [];
  const spawn = vi.fn(() => {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stderr: new PassThrough(),
      stdio: [null, null, null, new PassThrough(), new PassThrough()],
      exitCode: null,
      signalCode: null as string | null,
      kill(signal: string) {
        if (this.signalCode) return;
        this.signalCode = signal;
        queueMicrotask(() => child.emit("close", null, signal));
      },
    });
    children.push(child);
    return child;
  });
  const wrapper = { exports: {} as any };
  vm.runInNewContext(
    fs.readFileSync(
      new URL("../apps/desktop/swiftcapture.cjs", import.meta.url),
      "utf8",
    ),
    {
      module: wrapper,
      require: (name: string) =>
        name === "node:child_process"
          ? { ...require(name), spawn }
          : require(name),
      Buffer,
      setTimeout,
      clearTimeout,
    },
  );
  class ObservedCapture extends wrapper.exports.Capture {
    constructor(...args: any[]) {
      super(...args);
      captures.push(this);
    }
  }
  const contents = Object.assign(new EventEmitter(), { send: vi.fn() });
  const parent = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    webContents: contents,
  });
  const module = { exports: {} as any };
  const entry = new URL("../apps/desktop/native-media.cjs", import.meta.url);
  const localRequire = createRequire(entry);
  vm.runInNewContext(fs.readFileSync(entry, "utf8"), {
    module,
    __dirname: new URL("../apps/desktop/", import.meta.url).pathname,
    process: { platform: "darwin", arch: "arm64" },
    setTimeout,
    clearTimeout,
    Uint8Array,
    require: (name: string) => {
      if (name === "electron")
        return {
          app: Object.assign(new EventEmitter(), { isPackaged: false }),
          ipcMain: {
            handle: (name: string, fn: Function) => handlers.set(name, fn),
            on: vi.fn(),
          },
          systemPreferences: { getMediaAccessStatus: () => "granted" },
        };
      if (name === "./swiftcapture.cjs")
        return {
          Capture: ObservedCapture,
          listSources: async () => ({
            cameras: [
              {
                id: "camera",
                label: "Camera",
                formats: [
                  {
                    width: 1920,
                    height: 1080,
                    minFPS: cadence,
                    maxFPS: cadence,
                  },
                ],
              },
            ],
            audio: [],
          }),
        };
      if (name === "./capture-picker.cjs") return {};
      return localRequire(name);
    },
  });
  module.exports.installNativeMedia(parent, () => {});
  const request = {
    id: "00000000-0000-0000-0000-000000000001",
    purpose: "camera",
    device: "swift:camera",
    width: 1920,
    height: 1080,
    fps: 60,
  };
  return {
    spawn,
    children,
    captures,
    contents,
    start: (patch = {}) =>
      handlers.get("native:start")!({}, { ...request, ...patch }),
    stop: () => handlers.get("native:stop")!({}, request.id),
    configure: (mode: object) =>
      handlers.get("native:configure")!({}, request.id, mode),
    ready(index = children.length - 1) {
      children[index].stdio[3].write(
        packet(
          1,
          Buffer.from(
            JSON.stringify({
              codec: "h264",
              format: "annexb",
              width: 1920,
              height: 1080,
              fps: 60,
              parameterSets: ["Z0LgKg=="],
            }),
          ),
        ),
      );
    },
  };
}
it.each([59.94, 60.001])(
  "starts and restarts native capture from a %s FPS catalog",
  async (cadence) => {
    const shell = nativeShell(cadence);
    for (let i = 0; i < 2; i++) {
      const started = shell.start();
      await vi.waitFor(() => expect(shell.children).toHaveLength(i + 1));
      const args = (
        shell.spawn.mock.calls[i] as unknown as [string, string[]]
      )[1];
      expect(
        args.slice(
          args.indexOf("--webcam-fps"),
          args.indexOf("--webcam-fps") + 2,
        ),
      ).toEqual(["--webcam-fps", "60"]);
      shell.ready();
      await expect(started).resolves.toMatchObject({
        video: { width: 1920, height: 1080, fps: 60 },
      });
      expect(shell.captures[i].listenerCount("stopped")).toBe(0);
      shell.children[i].stdio[3].write(
        packet(2, Buffer.from([0, 0, 1, 0x65, 7])),
      );
      expect(shell.contents.send).toHaveBeenCalledWith(
        "native:event",
        expect.objectContaining({ kind: "video" }),
      );
      await expect(
        shell.configure({ width: 640, height: 480, fps: 60 }),
      ).rejects.toThrow("unavailable");
      expect(shell.captures[i].closed).toBe(false);
      await shell.stop();
    }
  },
);
it.each(["process", "packet"])(
  "preserves a %s startup failure and allows retry",
  async (kind) => {
    const shell = nativeShell();
    const cause = new Error("Fixture failure");
    const started = shell.start();
    const rejected = expect(started).rejects.toThrow(cause.message);
    await vi.waitFor(() => expect(shell.children).toHaveLength(1));
    if (kind === "process") shell.children[0].emit("error", cause);
    else
      shell.children[0].stdio[3].write(packet(4, Buffer.from(cause.message)));
    await rejected;
    if (kind === "process") await expect(started).rejects.toBe(cause);
    expect(shell.contents.send).toHaveBeenCalledWith(
      "native:event",
      expect.objectContaining({ kind: "error", message: cause.message }),
    );
    expect(shell.captures[0].listenerCount("stopped")).toBe(0);
    const retried = shell.start();
    await vi.waitFor(() => expect(shell.children).toHaveLength(2));
    shell.ready();
    await expect(retried).resolves.toMatchObject({ video: { fps: 60 } });
    await shell.stop();
  },
);
it("settles a cancelled startup and releases the camera for retry", async () => {
  const shell = nativeShell();
  const started = shell.start();
  const rejected = expect(started).rejects.toThrow();
  await vi.waitFor(() => expect(shell.children).toHaveLength(1));
  await shell.stop();
  await rejected;
  const retried = shell.start();
  await vi.waitFor(() => expect(shell.children).toHaveLength(2));
  shell.ready();
  await expect(retried).resolves.toMatchObject({ video: { fps: 60 } });
  await shell.stop();
});
it("rejects unsupported native camera requests before starting a worker", async () => {
  const shell = nativeShell();
  await expect(shell.start({ fps: 59.94 })).rejects.toThrow("whole-number");
  await expect(shell.start({ width: 640, height: 480 })).rejects.toThrow(
    "unavailable",
  );
  await expect(shell.start({ fps: 30 })).rejects.toThrow("unavailable");
  expect(shell.spawn).not.toHaveBeenCalled();
});
it("reads split and coalesced SCAP packets and bounds allocations before reading the body", () => {
  const packets: any[] = [];
  const reader = new PacketReader((p: any) => packets.push(p));
  const config = packet(1, Buffer.from('{"codec":"h264"}'));
  const sample = packet(2, Buffer.from([0, 0, 1, 0x65, 7]));
  const bytes = Buffer.concat([config, sample, packet(3, Buffer.alloc(0))]);
  for (const byte of bytes) reader.push(Buffer.from([byte]));
  expect(packets.map((p) => p.type)).toEqual([1, 2, 3]);
  expect(packets[1]).toMatchObject({
    key: true,
    timestamp: 1234567,
    data: Buffer.from([0, 0, 1, 0x65, 7]),
  });
  const header = packet(2, Buffer.alloc(0));
  header.writeUInt32BE(8 * 1024 * 1024, 16);
  expect(() => new PacketReader(() => {}).push(header)).toThrow("limit");
  expect(() => new PacketReader(() => {}).push(Buffer.alloc(24))).toThrow(
    "header",
  );
});
it("preserves capture-card stereo, converts signed/planar PCM, clamps non-finite samples", () => {
  const raw = Buffer.alloc(24);
  [0.25, -0.75, 0.9, NaN, Infinity, 0.8].forEach((s, i) =>
    raw.writeFloatLE(s, i * 4),
  );
  const config = {
    codec: "lpcm",
    sampleRate: 48000,
    channels: 3,
    bitsPerChannel: 32,
    formatFlags: 1,
    isInterleaved: true,
  };
  expect(Array.from(stereoPCM(raw, audioConfig(config)))).toEqual([
    0.25, -0.75, 0, 0,
  ]);
  expect(
    Array.from(
      stereoPCM(Buffer.from([0, 64, 0, 192]), {
        ...config,
        channels: 1,
        bitsPerChannel: 16,
        formatFlags: 4,
      }),
    ),
  ).toEqual([0.5, 0.5, -0.5, -0.5]);
  const planar = Buffer.alloc(16);
  [0.25, 0.5, -0.25, -0.5].forEach((s, i) => planar.writeFloatLE(s, i * 4));
  expect(
    Array.from(
      stereoPCM(planar, { ...config, channels: 2, isInterleaved: false }),
    ),
  ).toEqual([0.25, -0.25, 0.5, -0.5]);
  expect(() => audioConfig({ ...config, codec: "aac" })).toThrow("PCM");
  for (const sampleRate of [44100, 48000])
    expect(audioConfig({ ...config, sampleRate }).sampleRate).toBe(sampleRate);
  for (const patch of [
    { sampleRate: undefined },
    { isInterleaved: undefined },
    { formatFlags: undefined },
  ])
    expect(() => audioConfig({ ...config, ...patch })).toThrow("PCM");
});
it("uses the actual SPS codec and maps native screen/window/device IDs without shell interpolation", () => {
  expect(
    videoConfig({
      codec: "h264",
      format: "annexb",
      width: 1920,
      height: 1080,
      fps: 60,
      parameterSets: [Buffer.from([0x67, 0x42, 0xe0, 0x2a]).toString("base64")],
    }).codec,
  ).toBe("avc1.42e02a");
  const args = argumentsFor({
    purpose: "camera",
    device: "a;$(bad)",
    audioDevice: "card",
  });
  expect(args).toContain("a;$(bad)");
  expect(args).toContain("--webcam-video-fd");
  expect(args).toContain("--input-audio-fd");
  expect(
    argumentsFor({ purpose: "screen", source: "window:123:0", audio: true }),
  ).toContain("--system-audio-fd");
  expect(() =>
    argumentsFor({ purpose: "screen", source: "some shell command" }),
  ).toThrow("source");
});
