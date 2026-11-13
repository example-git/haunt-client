import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

function gate(enabled = true) {
  let Processor: any;
  const messages: any[] = [];
  runInNewContext(
    readFileSync(
      new URL(
        "../packages/browser/src/media/noise-gate-worklet.js",
        import.meta.url,
      ),
      "utf8",
    ),
    {
      sampleRate: 48000,
      AudioWorkletProcessor: class {
        port = {
          postMessage: (value: unknown) => messages.push(value),
          close() {},
        };
      },
      registerProcessor: (_name: string, type: any) => {
        Processor = type;
      },
    },
  );
  const processor = new Processor({
    processorOptions: { enabled, threshold: -45, metering: true },
  });
  const send = (data: unknown) => processor.port.onmessage({ data });
  const render = (amplitude: number, seconds: number) => {
    const result: number[] = [];
    for (let offset = 0; offset < 48000 * seconds; offset += 128) {
      const input = new Float32Array(128).fill(amplitude),
        output = new Float32Array(128);
      processor.process([[input]], [[output]]);
      result.push(...output);
    }
    return result;
  };
  return { send, render, messages };
}
describe("microphone noise gate", () => {
  it("passes audio unchanged when off and suppresses below-threshold residual noise when on", () => {
    const g = gate(false);
    expect(
      g.render(0.001, 0.1).every((sample) => sample === Math.fround(0.001)),
    ).toBe(true);
    g.send({ type: "settings", enabled: true, threshold: -45 });
    expect(g.render(0.001, 0.5).every((sample) => sample === 0)).toBe(true);
    expect(g.messages.at(-1)).toMatchObject({ state: "closed", output: 0 });
    expect(g.messages.at(-1).input).toBeGreaterThan(0);
  });
  it("preserves the start of a loud word after lookahead and holds quiet word endings", () => {
    const g = gate();
    g.render(0, 0.1);
    const speech = g.render(0.1, 0.05);
    expect(speech.slice(0, 240).every((sample) => sample === 0)).toBe(true);
    expect(speech[240]).toBeCloseTo(0.1, 5);
    const ending = g.render(0.001, 0.1);
    expect(ending.at(-1)).toBeCloseTo(0.001, 6);
    expect(g.render(0.001, 0.3).at(-1)).toBe(0);
  });
  it("sustains between thresholds and releases smoothly after the hold", () => {
    const g = gate();
    g.render(0.01, 0.05);
    expect(g.render(0.004, 0.4).at(-1)).toBeCloseTo(0.004, 6);
    const closing = g.render(0.002, 0.45);
    expect(closing.some((sample) => sample > 0 && sample < 0.001)).toBe(true);
    expect(closing.at(-1)).toBe(0);
  });
  it("flushes lookahead on mute and applies threshold changes without restarting", () => {
    const g = gate();
    g.render(0.1, 0.1);
    g.send({ type: "muted", muted: true });
    expect(g.render(0.1, 0.1).every((sample) => sample === 0)).toBe(true);
    g.send({ type: "muted", muted: false });
    expect(g.render(0, 0.1).every((sample) => sample === 0)).toBe(true);
    g.send({ type: "settings", enabled: true, threshold: 0 });
    expect(g.render(0.1, 0.5).every((sample) => sample === 0)).toBe(true);
    g.send({ type: "settings", enabled: true, threshold: -60 });
    expect(g.render(0.1, 0.1).at(-1)).toBeCloseTo(0.1, 6);
  });
});
