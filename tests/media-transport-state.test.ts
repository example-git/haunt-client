import { afterEach, describe, expect, it, vi } from "vitest";
import { EncodedTransport } from "../packages/browser/src/media/encoded";
import type { TransportContext } from "../packages/browser/src/media/types";

afterEach(() => vi.unstubAllGlobals());
const open = {
  muted: false,
  deafened: false,
  camera_off: false,
  screen_off: false,
};

describe("encoded transport control gates", () => {
  it("drops queued publications at send time and clears pending configuration audio", () => {
    vi.stubGlobal("WebSocket", { OPEN: 1 });
    const transport = new EncodedTransport({} as TransportContext);
    const socket = { readyState: 1, bufferedAmount: 0, send: vi.fn() };
    const publisher = { revision: 1, sequence: 0, pending: [{}], key: false };
    const chunk = {
      byteLength: 1,
      copyTo: (bytes: Uint8Array) => bytes.set([42]),
      timestamp: 0,
      type: "key",
    };
    const internals = transport as any;
    internals.socket = socket;
    internals.publishers.set("audio", publisher);
    transport.state(open);
    internals.send(chunk, "audio", publisher);
    expect(socket.send).toHaveBeenCalledTimes(1);
    transport.state({ ...open, deafened: true });
    expect(publisher.pending).toEqual([]);
    internals.send(chunk, "audio", publisher);
    expect(socket.send).toHaveBeenCalledTimes(1);
    internals.send(chunk, "screen_audio", publisher);
    expect(socket.send).toHaveBeenCalledTimes(2);
    transport.state({ ...open, camera_off: true, screen_off: true });
    for (const purpose of ["camera", "screen", "camera_audio", "screen_audio"])
      internals.send(chunk, purpose, publisher);
    expect(socket.send).toHaveBeenCalledTimes(2);
    transport.state(open);
    internals.send(chunk, "audio", publisher);
    expect(socket.send).toHaveBeenCalledTimes(3);
  });

  it("cancels scheduled playback and decoder backlog synchronously on deafen", () => {
    let output!: (data: any) => void;
    const reset = vi.fn();
    vi.stubGlobal(
      "AudioDecoder",
      class {
        state = "configured";
        reset = reset;
        configure() {}
        constructor(callbacks: any) {
          output = callbacks.output;
        }
      },
    );
    const track = { enabled: true };
    const sources: any[] = [];
    const transport = new EncodedTransport({
      remote: vi.fn(),
    } as unknown as TransportContext);
    const internals = transport as any;
    internals.audio = {
      currentTime: 1,
      createMediaStreamDestination: () => ({
        stream: { getAudioTracks: () => [track] },
      }),
      createBuffer: () => ({
        duration: 0.02,
        getChannelData: () => new Float32Array(960),
      }),
      createBufferSource: () => {
        const source = {
          connect: vi.fn(),
          disconnect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
        };
        sources.push(source);
        return source;
      },
    };
    internals.receive("peer", {
      purpose: "audio",
      revision: 1,
      codec: "opus",
      sample_rate: 48000,
      channels: 1,
    });
    const frame = {
      numberOfChannels: 1,
      numberOfFrames: 960,
      sampleRate: 48000,
      copyTo: vi.fn(),
      close: vi.fn(),
    };
    output(frame);
    expect(sources[0].start).toHaveBeenCalled();
    transport.state({ ...open, muted: true, deafened: true });
    expect(sources[0].stop).toHaveBeenCalledOnce();
    expect(reset).toHaveBeenCalledOnce();
    expect(track.enabled).toBe(false);
    output(frame);
    expect(sources).toHaveLength(1);
    transport.state({ ...open, muted: true, deafened: true });
    expect(reset).toHaveBeenCalledOnce();
    transport.state(open);
    expect(track.enabled).toBe(true);
    output(frame);
    expect(sources).toHaveLength(2);
  });
});
