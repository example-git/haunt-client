import { expect, it } from "vitest";
import { createRequire } from "node:module";
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
      { uniqueID: "busy", name: "Capture card", connected: true, inUse: true },
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
  expect(catalog.cameras).toEqual([{ id: "busy", label: "Capture card" }]);
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
