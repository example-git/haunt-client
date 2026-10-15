import { expect, it } from "vitest";
import fs from "node:fs";
import vm from "node:vm";
import { fullBandOpus } from "../packages/browser/src/media/audio-quality";
it("negotiates full-band Opus without changing video parameters or duplicating fmtp", () => {
  const sdp =
    "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;useinbandfec=1;maxaveragebitrate=64000\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=rtpmap:96 VP8/90000\r\na=fmtp:96 arbitrary=1\r\n";
  const result = fullBandOpus(sdp);
  expect(result).toContain("maxaveragebitrate=510000");
  expect(result).toContain("maxplaybackrate=48000;stereo=1");
  expect(result).toContain("a=fmtp:96 arbitrary=1");
  expect(fullBandOpus(result)).toBe(result);
  expect(
    fullBandOpus("m=audio 9 RTP/AVP 0\r\na=rtpmap:0 PCMU/8000\r\n"),
  ).not.toContain("fmtp");
});
it.each([44100, 48000])(
  "keeps stereo and 20 ms timestamps at %i Hz across render boundaries",
  (rate) => {
    let Processor: any;
    const frames: { samples: Float32Array; timestamp: number }[] = [];
    vm.runInNewContext(
      fs.readFileSync(
        new URL(
          "../packages/browser/src/media/capture-worklet.js",
          import.meta.url,
        ),
        "utf8",
      ),
      {
        AudioWorkletProcessor: class {
          port = { postMessage: (data: any) => frames.push(data) };
        },
        registerProcessor: (_: string, value: any) => {
          Processor = value;
        },
        sampleRate: rate,
        Float32Array,
      },
    );
    const processor = new Processor({ processorOptions: { channels: 2 } });
    for (let i = 0; i < 15; i++)
      processor.process([
        [new Float32Array(128).fill(0.25), new Float32Array(128).fill(-0.75)],
      ]);
    expect(frames).toHaveLength(2);
    expect(frames.map((f) => f.timestamp)).toEqual([0, 20000]);
    for (const frame of frames) {
      expect(frame.samples).toHaveLength(rate * 0.02 * 2);
      for (let i = 0; i < frame.samples.length; i += 2) {
        expect(frame.samples[i]).toBe(0.25);
        expect(frame.samples[i + 1]).toBe(-0.75);
      }
    }
  },
);
