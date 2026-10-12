// 20 ms interleaved frames at the actual graph rate. Preserve source stereo;
// This node has no audio output: captured audio goes only to the encoder over
// its message port, never to the speaker graph.
class HauntCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.channels = options.processorOptions?.channels === 2 ? 2 : 1;
    this.frameSize = Math.round(sampleRate * 0.02);
    this.buffer = new Float32Array(this.frameSize * this.channels);
    this.offset = 0;
    this.frames = 0;
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      for (let channel = 0; channel < this.channels; channel++)
        this.buffer[this.offset++] =
          channels[Math.min(channel, channels.length - 1)][i];
      if (this.offset === this.buffer.length) {
        this.port.postMessage(
          {
            samples: this.buffer,
            timestamp: Math.round((this.frames / sampleRate) * 1e6),
          },
          [this.buffer.buffer],
        );
        this.frames += this.offset / this.channels;
        this.offset = 0;
        this.buffer = new Float32Array(this.frameSize * this.channels);
      }
    }
    return true;
  }
}
registerProcessor("haunt-capture", HauntCapture);
