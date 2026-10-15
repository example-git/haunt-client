import { afterEach, expect, it, vi } from "vitest";
import { VideoPlayback } from "../packages/browser/src/media/video-playback";
afterEach(() => vi.unstubAllGlobals());
const tick = () => new Promise((r) => setTimeout(r, 0));
const config = { codec: "avc1.42e02a", codedWidth: 1920, codedHeight: 1080 };
function setup({ hardware = true, slow = false, generator = true } = {}) {
  const frames: any[] = [],
    delivered: number[] = [],
    decoders: any[] = [];
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  class Track {
    readyState = "live";
    writable = new WritableStream({
      write: (frame) => {
        delivered.push(frame.timestamp);
        if (slow) return held;
      },
    });
    stop() {
      this.readyState = "ended";
    }
  }
  class Decoder {
    state = "unconfigured";
    decodeQueueSize = 0;
    configurations: VideoDecoderConfig[] = [];
    static isConfigSupported = vi.fn(async (c: VideoDecoderConfig) => ({
      supported: hardware || c.hardwareAcceleration !== "prefer-hardware",
    }));
    constructor(public init: VideoDecoderInit) {
      decoders.push(this);
    }
    configure(c: VideoDecoderConfig) {
      this.configurations.push(c);
      this.state = "configured";
    }
    decode(c: EncodedVideoChunk) {
      const frame = {
        timestamp: c.timestamp,
        closed: false,
        close() {
          this.closed = true;
        },
      };
      frames.push(frame);
      this.init.output(frame as unknown as VideoFrame);
    }
    close() {
      this.state = "closed";
    }
  }
  vi.stubGlobal("MediaStreamTrackGenerator", generator ? Track : undefined);
  vi.stubGlobal(
    "MediaStream",
    class {
      constructor(private tracks: Track[]) {}
      getVideoTracks() {
        return this.tracks;
      }
      getTracks() {
        return this.tracks;
      }
    },
  );
  vi.stubGlobal("VideoDecoder", Decoder);
  const drawImage = vi.fn();
  const requestFrame = vi.fn();
  vi.stubGlobal("document", {
    createElement: () => ({
      getContext: () => ({ drawImage }),
      captureStream: () => {
        const track = Object.assign(new Track(), { requestFrame });
        return new MediaStream([track as unknown as MediaStreamTrack]);
      },
    }),
  });
  const request = vi.fn(),
    fail = vi.fn();
  const playback = new VideoPlayback(request, fail);
  return {
    playback,
    frames,
    delivered,
    decoders,
    release,
    request,
    fail,
    Decoder,
    drawImage,
    requestFrame,
  };
}
const chunk = (n: number, key = false) =>
  ({
    type: key ? "key" : "delta",
    timestamp: Math.round((n * 1e6) / 60),
    byteLength: 100,
  }) as EncodedVideoChunk;

it("prefers the hardware decoder and presents every 60 fps frame without a canvas/cap", async () => {
  const { playback, delivered, decoders, frames } = setup();
  await playback.configure(config);
  for (let i = 0; i < 60; i++) {
    playback.decode(chunk(i, i === 0));
    await tick();
  }
  expect(delivered).toHaveLength(60);
  expect(playback.diagnostics.output).toBe("video-frame");
  expect(
    decoders.every((d) =>
      d.configurations.every(
        (c: VideoDecoderConfig) =>
          c.hardwareAcceleration === "prefer-hardware" && c.optimizeForLatency,
      ),
    ),
  ).toBe(true);
  playback.close();
  expect(frames.every((f) => f.closed)).toBe(true);
  expect(playback.track.readyState).toBe("ended");
});
it("keeps uncapped canvas playback in browsers without generated video tracks", async () => {
  const { playback, requestFrame, drawImage, frames } = setup({
    generator: false,
  });
  await playback.configure(config);
  for (let i = 0; i < 60; i++) playback.decode(chunk(i, i === 0));
  expect(playback.diagnostics.output).toBe("canvas");
  expect(requestFrame).toHaveBeenCalledTimes(60);
  expect(drawImage).toHaveBeenCalledTimes(60);
  expect(frames.every((frame) => frame.closed)).toBe(true);
  playback.close();
});
it("tolerates small decode backlogs and resumes an interrupted GOP only at a keyframe", async () => {
  const { playback, decoders, delivered, request } = setup();
  await playback.configure(config);
  playback.decode(chunk(0, true));
  decoders.at(-1).decodeQueueSize = 6;
  expect(playback.decode(chunk(1))).toBe(true);
  playback.discontinuity();
  expect(playback.decode(chunk(2))).toBe(false);
  expect(playback.decode(chunk(3, true))).toBe(true);
  await tick();
  expect(request).toHaveBeenCalled();
  // The bounded presentation sink may supersede frame 1 with the newer IDR.
  expect(delivered.at(-1)).toBe(chunk(3).timestamp);
  decoders.at(-1).decodeQueueSize = 16;
  expect(playback.decode(chunk(4))).toBe(false);
  expect(playback.decode(chunk(5, true))).toBe(true);
  playback.close();
});
it("keeps playback available when hardware is unsupported or fails after starting", async () => {
  const a = setup({ hardware: false });
  await a.playback.configure(config);
  expect(a.playback.diagnostics.preference).toBe("no-preference");
  a.playback.close();
  const b = setup();
  await b.playback.configure(config);
  const first = b.decoders.at(-1);
  first.state = "closed";
  first.init.error(new DOMException("Driver stopped", "EncodingError"));
  expect(b.playback.decode(chunk(1))).toBe(false);
  expect(b.playback.decode(chunk(2, true))).toBe(true);
  await tick();
  expect(b.playback.diagnostics.hardwareFallbacks).toBe(1);
  expect(b.playback.diagnostics.preference).toBe("no-preference");
  expect(b.delivered).toEqual([chunk(2).timestamp]);
  b.playback.close();
});
it("bounds decoded frames during a slow sink and releases the newest frame on close", async () => {
  const { playback, frames, release } = setup({ slow: true });
  await playback.configure(config);
  for (let i = 0; i < 120; i++) playback.decode(chunk(i, i === 0));
  expect(frames.filter((f) => !f.closed)).toHaveLength(2);
  playback.close();
  release();
  await tick();
  expect(frames.every((f) => f.closed)).toBe(true);
});
it("preserves startup keyframes while checking acceleration and cancels pending configuration", async () => {
  const { playback, Decoder, delivered } = setup();
  let release!: () => void;
  const wait = new Promise<void>((r) => {
    release = r;
  });
  Decoder.isConfigSupported.mockImplementation(async () => {
    await wait;
    return { supported: true };
  });
  const ready = playback.configure(config);
  playback.decode(chunk(0, true));
  playback.decode(chunk(1));
  release();
  await ready;
  await tick();
  expect(delivered).toEqual([chunk(0).timestamp, chunk(1).timestamp]);
  playback.close();
  const b = setup();
  const pending = b.playback.configure(config);
  b.playback.close();
  await pending;
  expect(b.decoders).toHaveLength(0);
});
