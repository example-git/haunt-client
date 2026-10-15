import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SpeakingActivity,
  normalizedAudioLevel,
  audioActivityKey,
} from "../packages/browser/src/media/speaking";

const sources: {
  disconnect: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
}[] = [];
const analysers: {
  amplitude: number;
  fftSize: number;
  disconnect: ReturnType<typeof vi.fn>;
  getFloatTimeDomainData: (samples: Float32Array) => void;
}[] = [];
let context: { state: string; close: ReturnType<typeof vi.fn> };
function stream() {
  const track = { enabled: true, muted: false, readyState: "live" };
  return { getAudioTracks: () => [track] } as unknown as MediaStream;
}
beforeEach(() => {
  vi.useFakeTimers();
  sources.length = 0;
  analysers.length = 0;
  vi.stubGlobal(
    "AudioContext",
    class {
      state = "running";
      close = vi.fn(async () => {
        this.state = "closed";
      });
      resume = vi.fn(async () => {});
      constructor() {
        context = this;
      }
      createMediaStreamSource() {
        const source = { disconnect: vi.fn(), connect: vi.fn() };
        sources.push(source);
        return source;
      }
      createChannelSplitter() {
        return { connect: vi.fn(), disconnect: vi.fn() };
      }
      createAnalyser() {
        const analyser = {
          amplitude: 0,
          fftSize: 0,
          disconnect: vi.fn(),
          getFloatTimeDomainData(samples: Float32Array) {
            samples.fill(this.amplitude);
          },
        };
        analysers.push(analyser);
        return analyser;
      }
    },
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("local microphone activity", () => {
  it("ignores silence, holds brief speech gaps, and only notifies the changing participant", () => {
    const activity = new SpeakingActivity();
    const alice = vi.fn(),
      bob = vi.fn();
    activity.subscribe("alice", alice);
    activity.subscribe("bob", bob);
    activity.observe("alice", stream(), () => 1);
    activity.observe("bob", stream(), () => 1);
    vi.advanceTimersByTime(500);
    expect(alice).not.toHaveBeenCalled();
    analysers[0].amplitude = 0.01;
    vi.advanceTimersByTime(500);
    expect(activity.isSpeaking("alice")).toBe(true);
    expect(alice).toHaveBeenCalledTimes(1);
    expect(bob).not.toHaveBeenCalled();
    analysers[0].amplitude = 0;
    vi.advanceTimersByTime(150);
    expect(activity.isSpeaking("alice")).toBe(true);
    vi.advanceTimersByTime(100);
    expect(activity.isSpeaking("alice")).toBe(false);
    expect(alice).toHaveBeenCalledTimes(2);
    activity.close();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("meters a fixed logarithmic scale after listener gain, with no more than ten level updates per second", () => {
    const activity = new SpeakingActivity();
    let gain = 1;
    const meter = vi.fn();
    activity.subscribeLevel("alice", meter);
    activity.observe("alice", stream(), () => gain);
    analysers[0].amplitude = 0.1;
    vi.advanceTimersByTime(150);
    expect(activity.level("alice")).toBe(67);
    gain = 0.1;
    vi.advanceTimersByTime(100);
    expect(activity.level("alice")).toBe(33);
    meter.mockClear();
    for (let i = 0; i < 20; i++) {
      analysers[0].amplitude = i / 20;
      vi.advanceTimersByTime(50);
    }
    expect(meter.mock.calls.length).toBeLessThanOrEqual(10);
    gain = 0;
    activity.sample();
    expect(activity.level("alice")).toBe(0);
    expect(activity.isSpeaking("alice")).toBe(false);
    activity.close();
  });
  it("clears immediately on mute, inaudible playback, stopped tracks and suspended contexts; reconnect and teardown release nodes", () => {
    const activity = new SpeakingActivity();
    const first = stream();
    let audible = true;
    const old = activity.observe("alice", first, () => (audible ? 1 : 0));
    analysers[0].amplitude = 0.1;
    vi.advanceTimersByTime(100);
    expect(activity.isSpeaking("alice")).toBe(true);
    first.getAudioTracks()[0].enabled = false;
    activity.sample();
    expect(activity.isSpeaking("alice")).toBe(false);
    first.getAudioTracks()[0].enabled = true;
    activity.sample();
    expect(activity.isSpeaking("alice")).toBe(true);
    audible = false;
    activity.sample();
    expect(activity.level("alice")).toBe(0);
    audible = true;
    context.state = "suspended";
    activity.sample();
    expect(activity.isSpeaking("alice")).toBe(false);
    context.state = "running";
    const next = stream();
    const remove = activity.observe("alice", next, () => 1);
    old(); // A stale stream's cleanup must not remove its replacement.
    analysers[1].amplitude = 0.1;
    vi.advanceTimersByTime(100);
    expect(activity.isSpeaking("alice")).toBe(true);
    Object.assign(next.getAudioTracks()[0], { readyState: "ended" });
    activity.sample();
    expect(activity.isSpeaking("alice")).toBe(false);
    remove();
    activity.close();
    expect(context.close).toHaveBeenCalledOnce();
    expect(sources.every((s) => s.disconnect.mock.calls.length)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("fails quietly if Web Audio is unavailable", () => {
    vi.stubGlobal("AudioContext", undefined);
    const activity = new SpeakingActivity();
    activity.observe("alice", stream(), () => 1)();
    expect(activity.isSpeaking("alice")).toBe(false);
    activity.close();
  });
  it("keeps microphone and stereo source meters independent on one call clock", () => {
    const activity = new SpeakingActivity();
    const microphone = audioActivityKey("alice", "audio");
    const camera = audioActivityKey("alice", "camera_audio");
    const screen = audioActivityKey("alice", "screen_audio");
    let cameraGain = 1;
    activity.observe(microphone, stream(), () => 1);
    const stopCamera = activity.observe(
      camera,
      stream(),
      () => cameraGain,
      true,
    );
    activity.observe(screen, stream(), () => 1, true);
    // Opposite phase would cancel in a mono analyser, despite audible stereo.
    analysers[1].amplitude = 0.1;
    analysers[2].amplitude = -0.1;
    // A right-only source must register too.
    analysers[4].amplitude = 0.01;
    vi.advanceTimersByTime(150);
    expect(activity.level(camera)).toBe(67);
    expect(activity.level(screen)).toBe(33);
    expect(activity.level(microphone)).toBe(0);
    expect(activity.isSpeaking("alice")).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
    cameraGain = 0;
    activity.sample();
    expect(activity.level(camera)).toBe(0);
    expect(activity.level(screen)).toBe(33);
    stopCamera();
    expect(analysers[1].disconnect).toHaveBeenCalled();
    expect(analysers[2].disconnect).toHaveBeenCalled();
    activity.close();
    expect(vi.getTimerCount()).toBe(0);
  });
});
it("clamps inaudible/non-finite and clipped meter inputs", () => {
  expect([0, 0.0001, NaN, Infinity, -1].map(normalizedAudioLevel)).toEqual([
    0, 0, 0, 0, 0,
  ]);
  expect(normalizedAudioLevel(1)).toBe(100);
  expect(normalizedAudioLevel(2)).toBe(100);
});
