import { afterEach, expect, it, vi } from "vitest";
import { NarratorPlayback } from "../packages/browser/src/narrator/playback";
import { normalizeNarratorSettings } from "../packages/browser/src/narrator/settings";

afterEach(() => {
  vi.unstubAllGlobals();
});
function device() {
  const voices = [
    {
      localService: true,
      voiceURI: "local",
      name: "Local",
      lang: "en-US",
      default: true,
    },
  ];
  const speech = Object.assign(new EventTarget(), {
    getVoices: () => [
      ...voices,
      { ...voices[0], localService: false, voiceURI: "cloud" },
    ],
    speak: vi.fn((utterance) => queueMicrotask(() => utterance.onend?.())),
    cancel: vi.fn(),
  });
  vi.stubGlobal("speechSynthesis", speech);
  vi.stubGlobal(
    "SpeechSynthesisUtterance",
    class {
      constructor(public text: string) {}
    },
  );
  return speech;
}

it("uses only local device voices, including when TikTok generation fails", async () => {
  const speech = device();
  const generate = vi.fn(async () => {
    throw Error("session expired");
  });
  const playback = new NarratorPlayback(
    () =>
      normalizeNarratorSettings({
        enabled: true,
        provider: "tiktok-tts",
        volume: 40,
        rate: 1.2,
        deviceVoice: "cloud",
      }),
    generate,
  );
  await playback.preview("hello");
  expect(generate).toHaveBeenCalledOnce();
  const utterance = speech.speak.mock.calls[0][0];
  expect(utterance.voice.voiceURI).toBe("local");
  expect(utterance.volume).toBe(0.4);
  expect(utterance.rate).toBe(1.2);
  expect(playback.getSnapshot().message).toContain("fallback");
  await playback.preview("another message");
  expect(generate).toHaveBeenCalledOnce();
});

it("does not attempt TikTok for device-only mode or silently fall back when fallback is off", async () => {
  const speech = device();
  const generate = vi.fn(async () => {
    throw Error("not connected");
  });
  await new NarratorPlayback(() =>
    normalizeNarratorSettings({ provider: "device" }),
  ).preview("hello");
  expect(generate).not.toHaveBeenCalled();
  expect(speech.speak).toHaveBeenCalledOnce();
  await expect(
    new NarratorPlayback(
      () =>
        normalizeNarratorSettings({ provider: "tiktok-tts", fallback: false }),
      generate,
    ).preview("hello"),
  ).rejects.toThrow(/not connected/);
  expect(speech.speak).toHaveBeenCalledOnce();
});

it("cancels in-flight TikTok work without starting device speech afterwards", async () => {
  const speech = device();
  const cancel = vi.fn();
  const generate = vi.fn(
    (_provider: string, _text: string, _voice: string, signal: AbortSignal) =>
      new Promise<Uint8Array>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          cancel();
          reject(Error("aborted"));
        });
      }),
  );
  const playback = new NarratorPlayback(
    () => normalizeNarratorSettings({ enabled: true, provider: "tiktok-tts" }),
    generate,
  );
  const preview = playback.preview("hello");
  const rejection = expect(preview).rejects.toThrow();
  playback.stop();
  await rejection;
  expect(cancel).toHaveBeenCalledOnce();
  expect(speech.speak).not.toHaveBeenCalled();
});

it("keeps extension-only failures silent, including missing server configuration", async () => {
  const speech = device();
  const settings = () =>
    normalizeNarratorSettings({
      enabled: true,
      provider: "tiktok-tts",
      fallback: false,
    });
  const playback = new NarratorPlayback(settings);
  await expect(playback.preview("hello")).rejects.toThrow(/connected server/);
  expect(speech.speak).not.toHaveBeenCalled();
});

it("keeps automatic extension-only announcements silent when synthesis fails", async () => {
  const speech = device();
  const generate = vi.fn(async () => {
    throw Error("extension disabled");
  });
  const playback = new NarratorPlayback(
    () =>
      normalizeNarratorSettings({
        enabled: true,
        provider: "tiktok-tts",
        fallback: false,
      }),
    generate,
  );
  playback.enqueue("Alice joined", "en_us_001");
  await vi.waitFor(() => expect(playback.getSnapshot().error).toBe(true));
  expect(generate).toHaveBeenCalledOnce();
  expect(speech.speak).not.toHaveBeenCalled();
});

it("does not let a failed extension on one server suppress requests to another server", async () => {
  const speech = device();
  const generate = vi.fn(async () => {
    throw Error("unavailable");
  });
  const settings = () =>
    normalizeNarratorSettings({ provider: "tiktok-tts", fallback: true });
  const playback = new NarratorPlayback(settings);
  await playback.preview("hello", { key: "server-one", settings, generate });
  await playback.preview("hello", { key: "server-two", settings, generate });
  expect(generate).toHaveBeenCalledTimes(2);
  expect(speech.speak).toHaveBeenCalledTimes(2);
});
