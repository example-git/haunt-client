import { expect, it } from "vitest";
import fs from "node:fs";
import vm from "node:vm";

const script = fs.readFileSync(
  new URL(
    "../packages/browser/src/media/native-pcm-worklet.js",
    import.meta.url,
  ),
  "utf8",
);
function processor(inputRate: number, outputRate: number) {
  let Processor: any;
  vm.runInNewContext(script, {
    AudioWorkletProcessor: class {
      port = { onmessage: null };
    },
    registerProcessor: (_: string, p: any) => {
      Processor = p;
    },
    Float32Array,
    Math,
    Number,
    sampleRate: outputRate,
  });
  return new Processor({ processorOptions: { sampleRate: inputRate } });
}
function render(
  inputRate: number,
  outputRate: number,
  seconds: number,
  frequency = [997, 18000],
) {
  const node = processor(inputRate, outputRate);
  const output = [
    new Float32Array(Math.floor(outputRate * seconds)),
    new Float32Array(Math.floor(outputRate * seconds)),
  ];
  let sent = 0;
  // Feed irregular boundaries to catch filters that reset phase/history for
  // every IPC packet. Keep two capture packets ahead of the render clock.
  for (let offset = 0; offset < output[0].length; offset += 128) {
    const wanted =
      Math.ceil(((offset + 128) * inputRate) / outputRate) +
      Math.ceil(inputRate * 0.04);
    while (sent < wanted) {
      const frames = Math.min(137, wanted - sent);
      const data = new Float32Array(frames * 2);
      for (let i = 0; i < frames; i++)
        for (let ch = 0; ch < 2; ch++)
          data[i * 2 + ch] =
            0.4 *
            Math.sin((2 * Math.PI * frequency[ch] * (sent + i)) / inputRate);
      node.port.onmessage({ data });
      sent += frames;
    }
    const size = Math.min(128, output[0].length - offset);
    const block = [new Float32Array(size), new Float32Array(size)];
    node.process([], [block]);
    for (let ch = 0; ch < 2; ch++) output[ch].set(block[ch], offset);
  }
  return { node, output };
}
function snr(data: Float32Array, rate: number, frequency: number) {
  let signal = 0,
    error = 0;
  for (let i = 512; i < data.length; i++) {
    const expected = 0.4 * Math.sin((2 * Math.PI * frequency * i) / rate);
    signal += expected ** 2;
    error += (data[i] - expected) ** 2;
  }
  return 10 * Math.log10(signal / error);
}
it.each([
  [44100, 48000],
  [48000, 44100],
  [96000, 48000],
  [192000, 48000],
])(
  "preserves pitch, high-band audio, stereo and exact duration at %i → %i Hz",
  (inputRate, outputRate) => {
    const { node, output } = render(inputRate, outputRate, 2);
    expect(snr(output[0], outputRate, 997)).toBeGreaterThan(70);
    expect(snr(output[1], outputRate, 18000)).toBeGreaterThan(60);
    expect(node.read).toBe(2 * inputRate);
    expect(node.phase).toBe(0);
    expect(node.half / inputRate).toBeLessThan(0.0012);
  },
);
it.each([
  [48000, 44100, 23500],
  [96000, 48000, 30000],
  [192000, 48000, 50000],
])(
  "rejects aliases from %i → %i Hz for a %i Hz source tone",
  (inputRate, outputRate, tone) => {
    const { output } = render(inputRate, outputRate, 0.25, [tone, tone]);
    const data = output[0].subarray(512);
    const rms = Math.sqrt(
      data.reduce((sum, x) => sum + x * x, 0) / data.length,
    );
    expect(20 * Math.log10(rms / (0.4 / Math.sqrt(2)))).toBeLessThan(-65);
  },
);
it.each([44100, 48000])(
  "bypasses filtering entirely at matching %i Hz",
  (rate) => {
    const { node, output } = render(rate, rate, 0.1);
    expect(node.half).toBe(0);
    expect(snr(output[0], rate, 997)).toBeGreaterThan(140);
  },
);
it.each([44100, 48000])(
  "bridges ordinary capture-packet jitter at %i Hz without repeated silence",
  (rate) => {
    const node = processor(rate, 48000);
    const packet = new Float32Array((rate / 50) * 2).fill(0.25);
    let next = 0,
      firstSound = Infinity;
    for (let frame = 0; frame < 48000; frame += 128) {
      const time = frame / 48000;
      while (next * 0.02 + (next % 3 ? 0.004 : 0) <= time) {
        node.port.onmessage({ data: packet });
        next++;
      }
      const block = [new Float32Array(128), new Float32Array(128)];
      node.process([], [block]);
      if (block[0].some((x) => x > 0.1))
        firstSound = Math.min(firstSound, time);
      if (time > 0.1)
        expect(block[0].every((x) => Math.abs(x - 0.25) < 1e-5)).toBe(true);
    }
    expect(firstSound).toBeLessThan(0.04);
  },
);
it("bounds stalled input to 60 ms, rejects bad rates/data, and recovers after starvation", () => {
  for (const invalid of [undefined, NaN, 0, 44100.5, 200000])
    expect(() => processor(invalid as number, 48000)).toThrow("sample rate");
  const node = processor(44100, 48000);
  node.port.onmessage({ data: new Float32Array(3) });
  node.port.onmessage({ data: new Float32Array(32770) });
  expect(node.write).toBe(0);
  for (let i = 0; i < 100; i++)
    node.port.onmessage({
      data: new Float32Array(1764).fill(i === 99 ? 0.25 : -0.5),
    });
  expect((node.write - node.read) / 44100).toBeLessThanOrEqual(0.06);
  for (let i = 0; i < 100; i++)
    node.process([], [[new Float32Array(128), new Float32Array(128)]]);
  const silent = [new Float32Array(128), new Float32Array(128)];
  node.process([], [silent]);
  expect(silent[0].every((x) => x === 0)).toBe(true);
  const data = new Float32Array(1764).fill(0.25);
  data[0] = NaN;
  node.port.onmessage({ data });
  node.port.onmessage({ data });
  for (let i = 0; i < 3; i++) node.process([], [silent]);
  expect(silent[0].every(Number.isFinite)).toBe(true);
  expect(silent[0][127]).toBeCloseTo(0.25, 5);
});
