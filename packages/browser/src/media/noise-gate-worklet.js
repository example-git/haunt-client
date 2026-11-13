class NoiseGate extends AudioWorkletProcessor {
  constructor({ processorOptions: options = {} } = {}) {
    super();
    this.enabled = !!options.enabled;
    this.threshold = options.threshold ?? -45;
    this.metering = !!options.metering;
    this.muted = !!options.muted;
    this.delay = new Float32Array(Math.ceil(sampleRate * 0.005));
    this.attack = 1 / (sampleRate * 0.003);
    this.release = 1 / (sampleRate * 0.12);
    this.smoothing = 1 - Math.exp(-1 / (sampleRate * 0.001));
    this.reset();
    this.port.onmessage = ({ data }) => {
      if (data.type === "settings") {
        if (this.enabled !== data.enabled) this.reset();
        this.enabled = !!data.enabled;
        this.threshold = data.threshold;
      } else if (data.type === "muted") {
        this.muted = !!data.muted;
        this.reset();
      } else if (data.type === "close") {
        this.closed = true;
        this.port.close();
      }
    };
  }
  reset() {
    this.delay.fill(0);
    this.cursor = 0;
    this.energy = 0;
    this.outputEnergy = 0;
    this.gain = 0;
    this.hold = 0;
    this.open = false;
    this.frames = 0;
  }
  process(inputs, outputs) {
    if (this.closed) return false;
    const source = inputs[0]?.[0],
      out = outputs[0]?.[0];
    if (!out) return true;
    const opening = 10 ** (this.threshold / 10);
    const closing = 10 ** ((this.threshold - 6) / 10);
    for (let i = 0; i < out.length; i++) {
      const input = source?.[i] ?? 0;
      const sample = !this.muted && Number.isFinite(input) ? input : 0;
      this.energy += this.smoothing * (sample * sample - this.energy);
      if (this.enabled && !this.muted) {
        if (this.energy >= (this.open ? closing : opening)) {
          this.open = true;
          this.hold = Math.ceil(sampleRate * 0.15);
        } else if (this.hold > 0) this.hold--;
        else this.open = false;
        this.gain = this.open
          ? Math.min(1, this.gain + this.attack)
          : Math.max(0, this.gain - this.release);
        out[i] = this.delay[this.cursor] * this.gain;
        this.delay[this.cursor] = sample;
        this.cursor = (this.cursor + 1) % this.delay.length;
      } else out[i] = sample;
      this.outputEnergy +=
        this.smoothing * (out[i] * out[i] - this.outputEnergy);
    }
    this.frames += out.length;
    if (this.metering && this.frames >= sampleRate / 20) {
      this.frames = 0;
      this.port.postMessage({
        input: Math.sqrt(Math.max(0, this.energy)),
        output: Math.sqrt(Math.max(0, this.outputEnergy)),
        state: this.muted
          ? "muted"
          : !this.enabled
            ? "off"
            : this.open
              ? "open"
              : this.gain > 0
                ? "closing"
                : "closed",
      });
    }
    return true;
  }
}
registerProcessor("haunt-noise-gate", NoiseGate);
