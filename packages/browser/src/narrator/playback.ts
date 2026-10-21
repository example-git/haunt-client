import { followAudioOutput } from "../audio-output";
import { friendlyError } from "@haunt/core";
import { getPreferences } from "../preferences";
import { narrationText, type NarratorSettings } from "./settings";

type PlaybackStatus = {
  message: string;
  provider?: "device" | "extension";
  error: boolean;
};
export type SpeechGenerator = (
  provider: string,
  text: string,
  voice: string,
  signal: AbortSignal,
) => Promise<Uint8Array>;
export interface NarratorSource {
  key: string;
  settings: () => NarratorSettings;
  generate: SpeechGenerator;
}
type QueuedSpeech = {
  text: string;
  voice: string;
  at: number;
  source?: NarratorSource;
};

export function deviceVoices() {
  if (typeof speechSynthesis === "undefined") return [];
  return speechSynthesis.getVoices().filter((voice) => voice.localService);
}

async function availableVoices(signal: AbortSignal) {
  const voices = deviceVoices();
  if (voices.length || typeof speechSynthesis === "undefined") return voices;
  await new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timeout);
      speechSynthesis.removeEventListener("voiceschanged", done);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timeout = setTimeout(done, 1000);
    speechSynthesis.addEventListener("voiceschanged", done, { once: true });
    signal.addEventListener("abort", done, { once: true });
    if (signal.aborted) done();
  });
  return deviceVoices();
}

async function speakOnDevice(
  text: string,
  settings: NarratorSettings,
  signal: AbortSignal,
) {
  const voices = await availableVoices(signal);
  signal.throwIfAborted();
  if (!voices.length || typeof SpeechSynthesisUtterance === "undefined")
    throw Error(
      "No device TTS voice is available. Install a system voice or choose a server speech extension.",
    );
  const voice =
    voices.find((voice) => voice.voiceURI === settings.deviceVoice) ??
    voices.find((voice) => voice.default) ??
    voices[0];
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = voice;
  utterance.lang = voice.lang;
  utterance.volume = settings.volume / 100;
  utterance.rate = settings.rate;
  await new Promise<void>((resolve, reject) => {
    let finished = false;
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      utterance.onend = null;
      utterance.onerror = null;
      if (error) reject(error);
      else resolve();
    };
    const abort = () => {
      finish(Error("Narration stopped."));
      speechSynthesis.cancel();
    };
    const timeout = setTimeout(() => {
      finish(Error("Device speech timed out."));
      speechSynthesis.cancel();
    }, 30_000);
    utterance.onend = () => finish();
    utterance.onerror = () =>
      finish(
        Error(
          "Device speech failed. Check your system voices and audio permissions.",
        ),
      );
    signal.addEventListener("abort", abort, { once: true });
    try {
      speechSynthesis.speak(utterance);
    } catch {
      finish(Error("Device speech is unavailable."));
    }
  });
}

async function playAudio(
  blob: Blob,
  settings: NarratorSettings,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.volume = settings.volume / 100;
  audio.playbackRate = settings.rate;
  const off = followAudioOutput(audio);
  try {
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
        audio.onended = null;
        audio.onerror = null;
        if (error) reject(error);
        else resolve();
      };
      const abort = () => finish(Error("Narration stopped."));
      const timeout = setTimeout(
        () => finish(Error("Narration playback timed out.")),
        30_000,
      );
      audio.onended = () => finish();
      audio.onerror = () =>
        finish(Error("Extension audio could not be played."));
      signal.addEventListener("abort", abort, { once: true });
      void audio
        .play()
        .catch(() =>
          finish(
            Error(
              "Audio playback was blocked. Interact with Haunt and try again.",
            ),
          ),
        );
    });
  } finally {
    off();
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    URL.revokeObjectURL(url);
  }
}

export class NarratorPlayback {
  private status: PlaybackStatus = { message: "Ready", error: false };
  private listeners = new Set<() => void>();
  private queue: QueuedSpeech[] = [];
  private running = false;
  private controller?: AbortController;
  private cache = new Map<string, Blob>();
  private bytes = 0;
  private retryAt = new Map<string, number>();

  constructor(
    private settings = () => getPreferences().narrator,
    private generate?: SpeechGenerator,
  ) {}

  getSnapshot = () => this.status;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(
    message: string,
    error = false,
    provider?: PlaybackStatus["provider"],
  ) {
    this.status = { message, error, provider };
    this.listeners.forEach((listener) => listener());
  }
  clearCache() {
    this.cache.clear();
    this.bytes = 0;
    this.retryAt.clear();
  }
  stop() {
    this.queue = [];
    if (this.controller && !this.controller.signal.aborted) {
      this.controller.abort();
      this.update("Speech stopped");
    }
  }
  enqueue(text: string, voice: string, source?: NarratorSource) {
    if (!(source?.settings() ?? this.settings()).enabled || !text.trim())
      return;
    this.queue.push({ text, voice, at: Date.now(), source });
    if (this.queue.length > 8) this.queue.shift();
    void this.drain();
  }
  async preview(text: string, source?: NarratorSource) {
    this.stop();
    if (this.running)
      throw Error("Stopping the previous narration. Try preview again.");
    this.running = true;
    this.controller = new AbortController();
    try {
      const prompt = narrationText(text);
      if (!prompt) throw Error("Enter some preview text.");
      await this.speak(
        prompt,
        (source?.settings() ?? this.settings()).voice,
        this.controller.signal,
        source,
      );
    } finally {
      this.controller = undefined;
      this.running = false;
      void this.drain();
    }
  }
  private async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const item = this.queue.shift()!;
        if (
          !(item.source?.settings() ?? this.settings()).enabled ||
          Date.now() - item.at > 10_000
        )
          continue;
        const controller = new AbortController();
        this.controller = controller;
        try {
          await this.speak(
            item.text,
            item.voice,
            controller.signal,
            item.source,
          );
        } catch (error) {
          if (!controller.signal.aborted)
            this.update(friendlyError(error), true);
        }
      }
    } finally {
      this.controller = undefined;
      this.running = false;
    }
  }
  private async speak(
    text: string,
    voice: string,
    signal: AbortSignal,
    source?: NarratorSource,
  ) {
    signal.throwIfAborted();
    const settings = source?.settings() ?? this.settings();
    const generate = source?.generate ?? this.generate;
    const providerKey = JSON.stringify([
      source?.key ?? "default",
      settings.provider,
    ]);
    let fallbackReason = "";
    if (settings.provider !== "device") {
      try {
        if (!generate)
          throw Error("Select a connected server to use its speech extension.");
        if (Date.now() < (this.retryAt.get(providerKey) ?? 0))
          throw Error(
            "This server's speech extension is temporarily unavailable.",
          );
        const key = JSON.stringify([providerKey, voice, text]);
        let blob = this.cache.get(key);
        if (blob) {
          this.cache.delete(key);
          this.cache.set(key, blob);
        } else {
          this.update("Generating server speech…");
          const bytes = await generate(settings.provider, text, voice, signal);
          signal.throwIfAborted();
          if (!bytes.byteLength || bytes.byteLength > 8 * 1024 * 1024)
            throw Error("Invalid speech extension audio.");
          blob = new Blob([new Uint8Array(bytes)], { type: "audio/mpeg" });
          this.cache.set(key, blob);
          this.bytes += blob.size;
          while (this.cache.size > 64 || this.bytes > 16 * 1024 * 1024) {
            const oldest = this.cache.keys().next().value!;
            this.bytes -= this.cache.get(oldest)!.size;
            this.cache.delete(oldest);
          }
        }
        signal.throwIfAborted();
        await playAudio(blob, settings, signal);
        this.update("Server extension speech played", false, "extension");
        return;
      } catch (error) {
        signal.throwIfAborted();
        this.retryAt.set(providerKey, Date.now() + 30_000);
        fallbackReason = friendlyError(error);
        if (!settings.fallback) throw error;
      }
    }
    this.update("Speaking with a device voice…", false, "device");
    await speakOnDevice(text, settings, signal);
    this.update(
      fallbackReason
        ? `Device TTS fallback: ${fallbackReason}`
        : "Device speech played",
      false,
      "device",
    );
  }
}

export const narratorPlayback = new NarratorPlayback();
