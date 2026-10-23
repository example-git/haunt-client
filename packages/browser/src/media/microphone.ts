import workletURL from "../audio-plugins/bridge-worklet.js?url";
import type { PluginSelection } from "../audio-plugins/contract";
export type NoiseStatus = "off" | "loading" | "active" | "fallback";
export type NoiseScores = Record<string, number>;
// One stable 48 kHz output track across plugin switches. Device input rates
// are resampled by Web Audio before reaching the plugin's mono PCM boundary.
export class MicrophoneCapture {
  track: MediaStreamTrack;
  private context?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private dry?: GainNode;
  private wet?: GainNode;
  private outputGain?: GainNode;
  private automaticGain = true;
  private browserSuppression = false;
  private node?: AudioWorkletNode;
  private destination?: MediaStreamAudioDestinationNode;
  private closed = false;
  private muted = false;
  private wanted?: boolean;
  private generation = 0;
  private nodeReady = false;
  private options?: PluginSelection;
  private worker?: Worker;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private optionsKey = "";
  private suppressionTask?: Promise<void>;
  private workletModule?: Promise<void>;
  private cancelReady?: () => void;
  private constraints: Promise<unknown> = Promise.resolve();
  private offAbort?: () => void;
  private constructor(
    private raw: MediaStream,
    private status: (value: NoiseStatus) => void,
    private scores?: (value: NoiseScores | undefined) => void,
  ) {
    this.track = raw.getAudioTracks()[0];
    if (!this.track) throw Error("The selected microphone has no audio track.");
  }
  static async open(
    raw: MediaStream,
    enabled: boolean,
    status: (value: NoiseStatus) => void,
    signal?: AbortSignal,
    gain = { level: 100, automatic: true },
    options?: PluginSelection,
    scores?: (value: NoiseScores | undefined) => void,
  ) {
    const mic = new MicrophoneCapture(raw, status, scores);
    mic.automaticGain = gain.automatic;
    const abort = () => mic.close();
    signal?.addEventListener("abort", abort, { once: true });
    mic.offAbort = () => signal?.removeEventListener("abort", abort);
    if (signal?.aborted) {
      mic.close();
      return mic;
    }
    try {
      mic.context = new AudioContext({
        sampleRate: 48000,
        latencyHint: "interactive",
      });
      const ctx = mic.context;
      // MediaStreamAudioSourceNode resamples the track's actual device rate to
      // this graph's 48 kHz rate before the plugin sees it; an ideal capture constraint
      // is not proof of the rate the microphone actually returned.
      mic.source = ctx.createMediaStreamSource(raw);
      mic.destination = ctx.createMediaStreamDestination();
      mic.destination.channelCount = 1;
      mic.dry = ctx.createGain();
      mic.wet = ctx.createGain();
      mic.wet.gain.value = 0;
      mic.outputGain = ctx.createGain();
      mic.source.connect(mic.dry).connect(mic.outputGain);
      mic.wet.connect(mic.outputGain);
      mic.outputGain.connect(mic.destination);
      await ctx.resume();
      mic.track = mic.destination.stream.getAudioTracks()[0];
    } catch {
      mic.destination?.stream.getTracks().forEach((track) => track.stop());
      await mic.context?.close().catch(() => {});
      mic.context = undefined;
    }
    await mic.setSuppression(enabled, options);
    await mic.setGain(gain.level, gain.automatic);
    return mic;
  }
  private state() {
    this.node?.port.postMessage({
      type: "state",
      enabled: this.wanted,
      muted: this.muted,
    });
  }
  private route(processed: boolean) {
    if (!this.context || !this.dry || !this.wet) return;
    const now = this.context.currentTime;
    // Cancel older ramps before a rapid toggle, so it cannot restore a stale route.
    for (const [gain, value] of [
      [this.dry.gain, processed ? 0 : 1],
      [this.wet.gain, processed ? 1 : 0],
    ] as const) {
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(gain.value, now);
      gain.linearRampToValueAtTime(value, now + 0.01);
    }
  }
  private async fallback(generation: number) {
    if (this.closed || generation !== this.generation) return;
    this.scores?.(undefined);
    this.route(false);
    this.node?.port.postMessage({
      type: "state",
      enabled: false,
      muted: this.muted,
    });
    this.status(this.wanted ? "fallback" : "off");
    await this.applySuppression(false, generation).catch(() => {});
  }
  private applySuppression(enabled: boolean, generation: number) {
    if (this.closed || generation !== this.generation) return Promise.resolve();
    this.browserSuppression = enabled;
    return this.applyInputSettings();
  }
  private applyInputSettings() {
    return (this.constraints = this.constraints
      .catch(() => {})
      .then(() => {
        if (!this.closed)
          return this.raw.getAudioTracks()[0].applyConstraints({
            echoCancellation: false,
            noiseSuppression: this.browserSuppression,
            autoGainControl: this.automaticGain,
          });
      }));
  }
  /** Gain follows denoising and keeps the published track stable. */
  async setGain(level: number, automatic: boolean) {
    if (this.closed) return;
    const changed = automatic !== this.automaticGain;
    this.automaticGain = automatic;
    const value = automatic
      ? 1
      : Math.max(0, Math.min(200, Number.isFinite(level) ? level : 100)) / 100;
    if (this.context && this.outputGain) {
      const gain = this.outputGain.gain,
        now = this.context.currentTime;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(gain.value, now);
      gain.linearRampToValueAtTime(value, now + 0.01);
    }
    if (changed) await this.applyInputSettings().catch(() => {});
  }
  private disposeNode() {
    clearInterval(this.heartbeatTimer);
    this.worker?.terminate();
    this.worker = undefined;
    this.cancelReady?.();
    this.cancelReady = undefined;
    if (this.node) {
      try {
        this.source?.disconnect(this.node);
      } catch {}
      this.node.port.postMessage({ type: "close" });
      this.node.disconnect();
      this.node = undefined;
    }
    this.nodeReady = false;
  }
  private sendOptions() {
    this.node?.port.postMessage({
      type: "options",
      values: this.options?.values ?? {},
      diagnostics: !!this.scores,
    });
  }
  private async prepare(generation: number) {
    const ctx = this.context!,
      selected = this.options;
    if (!ctx.audioWorklet || ctx.sampleRate !== 48000 || !selected)
      throw Error("Noise processing unavailable");
    const [bytes] = await Promise.all([
      selected.load(),
      (this.workletModule ??= ctx.audioWorklet
        .addModule(workletURL)
        .catch((error) => {
          this.workletModule = undefined;
          throw error;
        })),
    ]);
    if (this.closed || generation !== this.generation) return;
    const worker = new Worker(
      new URL("../audio-plugins/processor-worker.ts", import.meta.url),
      { type: "module" },
    );
    this.worker = worker;
    const node = new AudioWorkletNode(ctx, "haunt-audio-plugin-v1", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: "explicit",
      processorOptions: {
        frameSamples: selected.plugin.manifest.abi.frame_samples,
      },
    });
    const channel = new MessageChannel();
    node.port.postMessage({ type: "connect", port: channel.port1 }, [
      channel.port1,
    ]);
    this.node = node;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        worker.terminate();
        reject(Error("Noise suppression timed out"));
      }, 5000);
      this.cancelReady = () => {
        clearTimeout(timer);
        reject(Error("Microphone processor replaced"));
      };
      const failed = () => {
        clearTimeout(timer);
        reject(Error("Noise suppression failed"));
        if (this.node === node) {
          this.nodeReady = false;
          worker.terminate();
          clearInterval(this.heartbeatTimer);
          void this.fallback(this.generation);
        }
      };
      let heartbeat = Date.now();
      worker.onmessage = ({ data }) => {
        heartbeat = Date.now();
        if (this.node !== node) return;
        if (data.type === "ready") {
          clearTimeout(timer);
          // Initialization has its own five-second deadline. Start the shorter
          // processing watchdog only once compilation/creation has completed.
          this.heartbeatTimer = setInterval(() => {
            if (Date.now() - heartbeat > 1500) failed();
          }, 500);
          resolve();
        } else if (data.type === "error") failed();
        else if (data.type === "scores" && this.wanted && !this.muted)
          this.scores?.(data.values);
      };
      worker.onerror = failed;
      node.addEventListener("processorerror", failed);
      worker.postMessage(
        {
          type: "init",
          plugin: selected.plugin,
          variant: selected.variant,
          values: selected.values,
          diagnostics: !!this.scores,
          bytes,
          port: channel.port2,
        },
        [channel.port2],
      );
    });
    if (this.closed || generation !== this.generation) return;
    this.cancelReady = undefined;
    this.nodeReady = true;
    this.source!.connect(node).connect(this.wet!);
  }
  setSuppression(enabled: boolean, options?: PluginSelection): Promise<void> {
    const key = options
      ? `${options.plugin.digest}:${options.variant}:${JSON.stringify(options.values)}`
      : "";
    if (
      this.closed ||
      ((enabled && !!options) === this.wanted &&
        key === this.optionsKey &&
        (!this.wanted || this.nodeReady || !!this.suppressionTask))
    )
      return this.suppressionTask ?? Promise.resolve();
    const task = this.configureSuppression(enabled, options);
    this.suppressionTask = task;
    void task.finally(() => {
      if (this.suppressionTask === task) this.suppressionTask = undefined;
    });
    return task;
  }
  private async configureSuppression(
    enabled: boolean,
    options?: PluginSelection,
  ) {
    enabled = enabled && !!options;
    const key = options
      ? `${options.plugin.digest}:${options.variant}:${JSON.stringify(options.values)}`
      : "";
    const modelChanged =
      options?.plugin.digest !== this.options?.plugin.digest ||
      options?.variant !== this.options?.variant;
    if (
      this.closed ||
      (enabled === this.wanted &&
        key === this.optionsKey &&
        (!enabled || this.nodeReady))
    )
      return;
    this.optionsKey = key;
    const liveOptionsOnly =
      enabled && enabled === this.wanted && !modelChanged && this.nodeReady;
    this.options = options;
    if (liveOptionsOnly) {
      this.sendOptions();
      return;
    }
    this.wanted = enabled;
    const generation = ++this.generation;
    this.scores?.(undefined);
    if (modelChanged || !this.nodeReady) this.disposeNode();
    this.state();
    // A new model runs only after it is ready. Capture stays audible while loading.
    if (!enabled || !this.nodeReady) this.route(false);
    this.status(enabled ? "loading" : "off");
    try {
      await this.applySuppression(false, generation);
      if (this.closed || generation !== this.generation || !enabled) return;
      if (!this.context) throw Error("Audio processing unavailable");
      if (!this.nodeReady) await this.prepare(generation);
      if (this.closed || generation !== this.generation) return;
      this.sendOptions();
      this.state();
      this.route(true);
      this.status("active");
    } catch {
      if (generation === this.generation) this.disposeNode();
      await this.fallback(generation);
    }
  }
  setMuted(muted: boolean) {
    this.track.enabled = !muted;
    this.raw.getAudioTracks()[0].enabled = !muted;
    if (muted === this.muted) return;
    this.muted = muted;
    this.state();
    if (muted) this.scores?.(undefined);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.offAbort?.();
    ++this.generation;
    this.disposeNode();
    this.scores?.(undefined);
    this.source?.disconnect();
    this.dry?.disconnect();
    this.wet?.disconnect();
    this.outputGain?.disconnect();
    this.track.stop();
    this.destination?.stream.getTracks().forEach((track) => track.stop());
    this.raw.getTracks().forEach((track) => track.stop());
    void this.context?.close().catch(() => {});
  }
}
