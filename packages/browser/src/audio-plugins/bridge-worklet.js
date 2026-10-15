// Trusted, model-independent audio-thread bridge. Untrusted Wasm executes in a
// terminable Worker. At most two frames are outstanding and two are buffered.
class PluginBridge extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.size = options.processorOptions.frameSamples;
    if (!Number.isInteger(this.size) || this.size < 120 || this.size > 960)
      throw Error("Invalid frame size");
    this.input = new Float32Array(this.size);
    this.cursor = 0;
    this.queue = [];
    this.pool = [];
    this.playing = null;
    this.playCursor = 0;
    this.pending = 0;
    this.enabled = false;
    this.muted = false;
    this.epoch = 0;
    this.started = false;
    this.port.onmessage = ({ data }) => {
      if (data.type === "connect") {
        this.worker = data.port;
        this.worker.onmessage = ({ data: d }) => {
          if (d.type !== "frame") return;
          this.pending = Math.max(0, this.pending - 1);
          if (
            !(d.buffer instanceof ArrayBuffer) ||
            d.buffer.byteLength !== this.size * 4
          )
            return;
          const frame = new Float32Array(d.buffer);
          if (
            d.epoch !== this.epoch ||
            !this.enabled ||
            this.muted ||
            this.queue.length >= 2
          ) {
            if (this.pool.length < 4) this.pool.push(frame);
            return;
          }
          this.queue.push(frame);
        };
        this.worker.start();
      } else if (data.type === "state") {
        this.enabled = !!data.enabled;
        this.muted = !!data.muted;
        this.cursor = 0;
        this.queue = [];
        this.playing = null;
        this.started = false;
        this.epoch++;
        this.worker?.postMessage({ type: "state", epoch: this.epoch });
      } else if (data.type === "options") this.worker?.postMessage(data);
      else if (data.type === "close") {
        this.closed = true;
        this.worker?.close();
        this.port.close();
      }
    };
  }
  process(inputs, outputs) {
    if (this.closed) return false;
    const source = inputs[0]?.[0],
      out = outputs[0]?.[0];
    if (!out) return true;
    if (!source || this.muted) {
      out.fill(0);
      return true;
    }
    if (!this.enabled) {
      out.set(source);
      return true;
    }
    for (let i = 0; i < out.length; i++) {
      const sample = Number.isFinite(source[i])
        ? Math.max(-1, Math.min(1, source[i]))
        : 0;
      if (!this.started && this.queue.length >= 2) this.started = true;
      if (this.started && !this.playing && this.queue.length) {
        this.playing = this.queue.shift();
        this.playCursor = 0;
      }
      out[i] = this.playing
        ? this.playing[this.playCursor++]
        : this.started
          ? 0
          : sample;
      if (this.playing && this.playCursor === this.size) {
        if (this.pool.length < 4) this.pool.push(this.playing);
        this.playing = null;
      }
      this.input[this.cursor++] = sample;
      if (this.cursor === this.size) {
        this.cursor = 0;
        if (this.worker && this.pending < 2) {
          const buffer = this.input.buffer;
          this.worker.postMessage(
            { type: "frame", buffer, epoch: this.epoch },
            [buffer],
          );
          this.pending++;
          this.input = this.pool.pop() ?? new Float32Array(this.size);
        }
      }
    }
    return true;
  }
}
registerProcessor("haunt-audio-plugin-v1", PluginBridge);
