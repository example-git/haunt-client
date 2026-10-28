import { afterEach, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import vm from "node:vm";
import fs from "node:fs";
const require = createRequire(import.meta.url);
afterEach(() => vi.useRealTimers());
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
function nativeShell(cadence = 59.94, runtime = {}) {
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
          : name.startsWith("./")
            ? require(`../apps/desktop/${name.slice(2)}`)
            : require(name),
      Buffer,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      Date,
    },
  );
  class ObservedCapture extends wrapper.exports.Capture {
    constructor(...args: any[]) {
      super(args[0], args[1], runtime);
      captures.push(this);
    }
  }
  const contents = Object.assign(new EventEmitter(), { send: vi.fn() });
  const catalog = {
    cameras: [
      {
        id: "camera",
        label: "Camera",
        formats: [
          { width: 1920, height: 1080, minFPS: cadence, maxFPS: cadence },
        ],
      },
    ],
    audio: [] as { id: string; label: string }[],
  };
  const listSources = vi.fn(async () => structuredClone(catalog));
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
    setInterval,
    clearInterval,
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
          listSources,
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
    captureOnly: () =>
      new ObservedCapture("fixture", {
        purpose: "screen",
        source: "screen:0:0",
        width: 1920,
        height: 1080,
        fps: 60,
      }),
    contents,
    catalog,
    listSources,
    devices: () => handlers.get("native:devices")!({}, true),
    dispose: () => parent.emit("closed"),
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
    expect(shell.listSources).toHaveBeenCalledOnce();
    shell.dispose();
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
    shell.dispose();
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
  shell.dispose();
});
it("shares the native catalog and only publishes changed periodic snapshots", async () => {
  vi.useFakeTimers();
  const shell = nativeShell();
  const [first, second] = await Promise.all([shell.devices(), shell.devices()]);
  expect(second).toBe(first);
  expect(shell.listSources).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(30000);
  expect(shell.listSources).toHaveBeenCalledTimes(2);
  expect(await shell.devices()).toBe(first);
  expect(shell.contents.send).not.toHaveBeenCalled();
  shell.catalog.audio.push({ id: "input", label: "Input" });
  await vi.advanceTimersByTimeAsync(30000);
  expect((await shell.devices()).audio).toEqual(shell.catalog.audio);
  expect(shell.contents.send).toHaveBeenCalledOnce();
  expect(shell.contents.send).toHaveBeenCalledWith(
    "native:event",
    expect.objectContaining({ kind: "devices", devices: shell.catalog }),
  );
  shell.listSources.mockRejectedValueOnce(
    new Error("Fixture discovery failure"),
  );
  await vi.advanceTimersByTimeAsync(30000);
  expect((await shell.devices()).audio).toEqual(shell.catalog.audio);
  expect(shell.contents.send).toHaveBeenCalledOnce();
  shell.dispose();
  await vi.advanceTimersByTimeAsync(60000);
  expect(shell.listSources).toHaveBeenCalledTimes(4);
});
it("rejects unsupported native camera requests before starting a worker", async () => {
  const shell = nativeShell();
  await expect(shell.start({ fps: 59.94 })).rejects.toThrow("whole-number");
  await expect(shell.start({ width: 640, height: 480 })).rejects.toThrow(
    "unavailable",
  );
  await expect(shell.start({ fps: 30 })).rejects.toThrow("unavailable");
  expect(shell.spawn).not.toHaveBeenCalled();
  shell.dispose();
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

it.each([
  [0, null, "code 0"],
  [1, null, "code 1"],
  [null, "SIGSEGV", "signal SIGSEGV"],
  [null, "SIGKILL", "signal SIGKILL"],
])(
  "reports unexpected worker termination (%s, %s) through native IPC",
  async (code, signal, expected) => {
    const shell = nativeShell();
    const started = shell.start();
    await vi.waitFor(() => expect(shell.children).toHaveLength(1));
    shell.ready();
    await started;
    const child = shell.children[0];
    child.stderr.write(
      "NVIDIA probe: unavailable driver\nCapture encoder: x264enc\n",
    );
    child.exitCode = code;
    child.signalCode = signal;
    child.emit("exit", code, signal);
    child.emit("close", code, signal);
    const errors = shell.contents.send.mock.calls
      .map((call: any[]) => call[1])
      .filter((event: any) => event.kind === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain(expected);
    expect(errors[0].message).toContain("Capture encoder: x264enc");
    const {
      captureDiagnostics,
    } = require("../apps/desktop/capture-diagnostics.cjs");
    expect((await captureDiagnostics.snapshot()).log).toContain(
      "unavailable driver",
    );
    shell.dispose();
  },
);

it.each(["control", "video"])(
  "reports an unexpectedly closed %s pipe",
  async (kind) => {
    const shell = nativeShell();
    const started = shell.start();
    await vi.waitFor(() => expect(shell.children).toHaveLength(1));
    shell.ready();
    await started;
    if (kind === "control")
      shell.children[0].stdin.emit("error", new Error("EPIPE"));
    else shell.children[0].stdio[3].end();
    await vi.waitFor(() =>
      expect(shell.contents.send).toHaveBeenCalledWith(
        "native:event",
        expect.objectContaining({
          kind: "error",
          message: expect.stringContaining(`Capture ${kind} pipe`),
        }),
      ),
    );
    shell.dispose();
  },
);

it.each(["video", "audio"])(
  "detects a worker that stops delivering %s",
  async (kind) => {
    vi.useFakeTimers();
    const shell = nativeShell(60, { stallTimeout: 30000 });
    const started = shell.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(shell.children).toHaveLength(1);
    shell.ready();
    await started;
    if (kind === "audio") shell.captures[0].options.audio = true;
    await vi.advanceTimersByTimeAsync(16000);
    if (kind === "audio")
      shell.children[0].stdio[3].write(
        packet(2, Buffer.from([0, 0, 1, 0x65, 7])),
      );
    await vi.advanceTimersByTimeAsync(15000);
    expect(shell.contents.send).toHaveBeenCalledWith(
      "native:event",
      expect.objectContaining({
        kind: "error",
        message: expect.stringContaining(
          `stopped delivering ${kind} for 30 seconds`,
        ),
      }),
    );
    shell.dispose();
  },
);

it("retains bounded capture diagnostics across restart and reports storage failures", async () => {
  const {
    CaptureDiagnostics,
  } = require("../apps/desktop/capture-diagnostics.cjs");
  const os = require("node:os"),
    path = require("node:path");
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "haunt-capture-diagnostics-"),
  );
  try {
    const log = new CaptureDiagnostics();
    log.configure(directory);
    for (let i = 0; i < 100; i++)
      log.record("share", "worker", "x".repeat(5000));
    log.record("share", "failure", "NVENC failed; x264 selected");
    const saved = await log.snapshot();
    expect(saved.writeError).toBeUndefined();
    expect(saved.log.length).toBeLessThanOrEqual(256 * 1024);
    const reopened = new CaptureDiagnostics();
    reopened.configure(directory);
    expect((await reopened.snapshot()).log).toContain(
      "NVENC failed; x264 selected",
    );
    const broken = new CaptureDiagnostics();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    broken.configure(saved.file);
    broken.record("share", "failure", "still retained in memory");
    const result = await broken.snapshot();
    expect(result.writeError).toBeTruthy();
    expect(result.log).toContain("still retained in memory");
    expect(errorLog).toHaveBeenCalled();
    errorLog.mockRestore();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

it("retains the fatal worker cause when cleanup emits later messages", async () => {
  const shell = nativeShell();
  const started = shell.start();
  const rejected = expect(started).rejects.toThrow("NVENC rejected the frame");
  await vi.waitFor(() => expect(shell.children).toHaveLength(1));
  const child = shell.children[0];
  child.stderr.write(
    "Capture failure: NVENC rejected the frame\nUnrelated teardown warning\n",
  );
  child.exitCode = 1;
  child.emit("close", 1, null);
  await rejected;
  shell.dispose();
});

it("times out an encoder stuck before its first configuration while allowing portal selection to wait", async () => {
  vi.useFakeTimers();
  const shell = nativeShell(60, { stallTimeout: 30000 });
  const capture = shell.captureOnly();
  const child = shell.children[0];
  let failure: Error | undefined;
  capture.on("failure", (error: Error) => {
    failure = error;
  });
  child.stderr.write("Screen capture portal: Start\n");
  await vi.advanceTimersByTimeAsync(60000);
  expect(capture.closed).toBe(false);
  expect(failure).toBeUndefined();
  child.stderr.write("Checking encoder nvcudah264enc with cudaconvert\n");
  await vi.advanceTimersByTimeAsync(31000);
  expect(failure?.message).toContain("first video frame");
  shell.dispose();
});
