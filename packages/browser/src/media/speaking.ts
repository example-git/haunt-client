import type { AudioSource } from "../volumes";

export const audioActivityKey = (participant: string, purpose: AudioSource) =>
  purpose === "audio" ? participant : `${participant}:${purpose}`;

// One analyser per audio source, one clock per call. This never captures another
// device, plays sound, or sends activity over the gateway. Subscribers are scoped
// to a participant and notified only when their speaking state changes.
type Input = {
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  right?: AnalyserNode;
  splitter?: ChannelSplitterNode;
  samples: Float32Array<ArrayBuffer>;
  track: MediaStreamTrack;
  gain: () => number;
  lastVoice: number;
};
export class SpeakingActivity {
  private context?: AudioContext;
  private timer?: ReturnType<typeof setInterval>;
  private inputs = new Map<string, Input>();
  private active = new Set<string>();
  private listeners = new Map<string, Set<() => void>>();
  private closed = false;
  private levels = new Map<string, number>();
  private inputLevels = new Map<string, number>();
  inputLevel = (id: string) => this.inputLevels.get(id);
  private levelListeners = new Map<string, Set<() => void>>();
  private lastMeter = -Infinity;
  level = (id: string) => this.levels.get(id) ?? 0;
  available(id: string) {
    const input = this.inputs.get(id);
    return (
      !!input &&
      this.context?.state === "running" &&
      input.track.enabled &&
      !input.track.muted &&
      input.track.readyState === "live" &&
      input.gain() > 0
    );
  }
  subscribeLevel(id: string, listener: () => void) {
    const listeners = this.levelListeners.get(id) ?? new Set();
    listeners.add(listener);
    this.levelListeners.set(id, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.levelListeners.delete(id);
    };
  }
  private setLevel(id: string, level: number) {
    if (this.level(id) === level) return;
    if (level) this.levels.set(id, level);
    else this.levels.delete(id);
    this.levelListeners.get(id)?.forEach((listener) => listener());
  }
  isSpeaking = (id: string) => this.active.has(id);
  subscribe(id: string, listener: () => void) {
    const listeners = this.listeners.get(id) ?? new Set();
    listeners.add(listener);
    this.listeners.set(id, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(id);
    };
  }
  private set(id: string, active: boolean) {
    if (active === this.active.has(id)) return;
    if (active) this.active.add(id);
    else this.active.delete(id);
    this.listeners.get(id)?.forEach((listener) => listener());
  }
  observe(id: string, stream: MediaStream, gain: () => number, stereo = false) {
    const track = stream.getAudioTracks()[0];
    if (this.closed || !track) return () => {};
    // Autoplay restrictions or unavailable Web Audio must not prevent a call.
    let input: Input;
    try {
      this.context ??= new AudioContext({ latencyHint: "interactive" });
      void this.context.resume().catch(() => {});
      const source = this.context.createMediaStreamSource(stream);
      const analyser = this.context.createAnalyser();
      analyser.fftSize = 1024;
      const splitter = stereo
        ? this.context.createChannelSplitter(2)
        : undefined;
      const right = stereo ? this.context.createAnalyser() : undefined;
      if (splitter && right) {
        right.fftSize = 1024;
        source.connect(splitter);
        splitter.connect(analyser, 0);
        splitter.connect(right, 1);
      } else source.connect(analyser);
      // Deliberately no connection to the speakers. Analyse stereo channels
      // separately so opposite-phase audio does not falsely meter as silence.
      input = {
        source,
        analyser,
        right,
        splitter,
        track,
        samples: new Float32Array(1024),
        gain,
        lastVoice: -Infinity,
      };
    } catch {
      return () => {};
    }
    const previous = this.inputs.get(id);
    previous?.source.disconnect();
    previous?.analyser.disconnect();
    previous?.right?.disconnect();
    previous?.splitter?.disconnect();
    this.inputs.set(id, input);
    this.inputLevels.delete(id);
    this.set(id, false);
    this.setLevel(id, 0);
    this.timer ??= setInterval(this.sample, 50);
    return () => {
      input.source.disconnect();
      input.analyser.disconnect();
      input.right?.disconnect();
      input.splitter?.disconnect();
      if (this.inputs.get(id) !== input) return;
      this.inputs.delete(id);
      this.inputLevels.delete(id);
      this.set(id, false);
      this.setLevel(id, 0);
      if (!this.inputs.size) {
        clearInterval(this.timer);
        this.timer = undefined;
      }
    };
  }
  // Also run after mute/volume/playback changes so silence is reflected promptly.
  sample = () => {
    const now = performance.now();
    const meter = now - this.lastMeter >= 100;
    if (meter) this.lastMeter = now;
    for (const [id, input] of this.inputs) {
      const gain = input.gain();
      if (
        this.context?.state !== "running" ||
        !input.track.enabled ||
        input.track.muted ||
        input.track.readyState === "ended"
      ) {
        input.lastVoice = -Infinity;
        this.inputLevels.delete(id);
        this.set(id, false);
        this.setLevel(id, 0);
        continue;
      }
      input.analyser.getFloatTimeDomainData(input.samples);
      let energy = 0;
      for (const value of input.samples) energy += value * value;
      if (input.right) {
        input.right.getFloatTimeDomainData(input.samples);
        let rightEnergy = 0;
        for (const value of input.samples) rightEnergy += value * value;
        energy = Math.max(energy, rightEnergy);
      }
      const sourceRMS = Math.sqrt(energy / input.samples.length);
      if (meter) this.inputLevels.set(id, normalizedAudioLevel(sourceRMS));
      if (!(gain > 0)) {
        input.lastVoice = -Infinity;
        this.set(id, false);
        this.setLevel(id, 0);
        continue;
      }
      const rms = sourceRMS * gain;
      if (meter) this.setLevel(id, normalizedAudioLevel(rms));
      // -46 dB to start, -50 dB to sustain, then 220 ms release. This is an
      // audible-level indicator, not speech recognition; sustained noise can light it.
      if (rms >= (this.active.has(id) ? 0.003 : 0.005)) input.lastVoice = now;
      this.set(id, now - input.lastVoice < 220);
    }
  };
  close() {
    this.closed = true;
    clearInterval(this.timer);
    this.timer = undefined;
    for (const input of this.inputs.values()) {
      input.source.disconnect();
      input.analyser.disconnect();
      input.right?.disconnect();
      input.splitter?.disconnect();
    }
    this.inputs.clear();
    this.inputLevels.clear();
    for (const id of this.active) this.set(id, false);
    for (const id of this.levels.keys()) this.setLevel(id, 0);
    void this.context?.close().catch(() => {});
    this.context = undefined;
  }
}

// Fixed dBFS scale: silence below -60 dB, full scale at 0 dB. Unlike per-user
// auto-normalization this preserves the effect of the listener's volume slider.
export function normalizedAudioLevel(rms: number) {
  if (!(rms > 0) || !Number.isFinite(rms)) return 0;
  return Math.round(
    Math.max(0, Math.min(1, (20 * Math.log10(rms) + 60) / 60)) * 100,
  );
}
