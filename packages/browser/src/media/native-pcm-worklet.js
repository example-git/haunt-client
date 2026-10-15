// Native PCM carries its real source rate. Convert it to the AudioContext clock;
// never relabel 44.1 kHz samples as 48 kHz. Equal rates take a sample-exact bypass.
// Windowed-sinc phases are built once, not on the real-time render path. The
// low-pass cutoff follows the LOWER Nyquist limit, including 96/192 kHz cards.
class NativePCM extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.inputRate = options.processorOptions?.sampleRate;
    if (
      !Number.isInteger(this.inputRate) ||
      this.inputRate < 8000 ||
      this.inputRate > 192000
    )
      throw Error("Invalid native PCM sample rate");
    this.buffer = new Float32Array(32768);
    this.read = 0;
    this.write = 0;
    this.start = 0;
    // An integer remainder keeps the conversion ratio exact over long calls.
    this.phase = 0;
    this.playing = false;
    const ratio = Math.min(1, sampleRate / this.inputRate);
    this.half = this.inputRate === sampleRate ? 0 : Math.ceil(48 / ratio);
    this.taps = this.half * 2;
    this.maxQueued = Math.min(
      16384 - this.taps,
      Math.ceil(this.inputRate * 0.06),
    );
    // Keep one capture packet of headroom before starting. Starting on the very
    // first 20 ms packet otherwise underruns at its tail while waiting for the
    // next IPC delivery and the filter's lookahead.
    this.prefill = Math.ceil(this.inputRate * 0.02) + Math.max(1, this.half);
    if (this.half) {
      let a = this.inputRate,
        b = sampleRate;
      while (b) [a, b] = [b, a % b];
      this.phases = Math.min(1024, sampleRate / a);
      this.kernel = new Float32Array((this.phases + 1) * this.taps);
      const cutoff = 0.94 * ratio;
      for (let p = 0; p <= this.phases; p++) {
        let sum = 0;
        for (let tap = 0; tap < this.taps; tap++) {
          const distance = tap - this.half + 1 - p / this.phases;
          const x = Math.PI * cutoff * distance;
          const window =
            Math.abs(distance) >= this.half
              ? 0
              : 0.42 +
                0.5 * Math.cos((Math.PI * distance) / this.half) +
                0.08 * Math.cos((2 * Math.PI * distance) / this.half);
          const value =
            cutoff * (Math.abs(x) < 1e-12 ? 1 : Math.sin(x) / x) * window;
          this.kernel[p * this.taps + tap] = value;
          sum += value;
        }
        for (let tap = 0; tap < this.taps; tap++)
          this.kernel[p * this.taps + tap] /= sum;
      }
    }
    this.port.onmessage = ({ data }) => {
      if (
        !(data instanceof Float32Array) ||
        data.length > 32768 ||
        data.length % 2
      )
        return;
      const frames = data.length / 2;
      const first = Math.max(0, frames - this.maxQueued);
      // Recover from an IPC stall with fresh audio, never a growing delay. Do
      // not mix pre-stall filter history into the new segment.
      if (this.write - this.read + frames > this.maxQueued) {
        this.read = this.start = this.write;
        this.phase = 0;
        this.playing = false;
      }
      for (let i = first; i < frames; i++) {
        const slot = (this.write++ % 16384) * 2;
        this.buffer[slot] = Number.isFinite(data[i * 2]) ? data[i * 2] : 0;
        this.buffer[slot + 1] = Number.isFinite(data[i * 2 + 1])
          ? data[i * 2 + 1]
          : 0;
      }
    };
  }
  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output?.length) return true;
    if (!this.playing) {
      if (this.write - this.read < this.prefill) return true;
      this.playing = true;
    }
    for (let i = 0; i < output[0].length; i++) {
      if (this.read + this.half >= this.write) {
        this.playing = false;
        break;
      }
      let left = 0,
        right = 0;
      if (!this.half) {
        const slot = (this.read % 16384) * 2;
        left = this.buffer[slot];
        right = this.buffer[slot + 1];
      } else {
        const phase = Math.round((this.phase * this.phases) / sampleRate);
        const base = phase * this.taps;
        for (let tap = 0; tap < this.taps; tap++) {
          const index = this.read + tap - this.half + 1;
          if (index < this.start) continue;
          const slot = (index % 16384) * 2;
          const weight = this.kernel[base + tap];
          left += this.buffer[slot] * weight;
          right += this.buffer[slot + 1] * weight;
        }
      }
      output[0][i] = left;
      if (output[1]) output[1][i] = right;
      this.phase += this.inputRate;
      const advance = Math.floor(this.phase / sampleRate);
      this.read += advance;
      this.phase -= advance * sampleRate;
    }
    return true;
  }
}
registerProcessor("haunt-native-pcm", NativePCM);
