#!/usr/bin/env node
// Test-only FD producer. Real encoded test-pattern frames, simulated devices;
// never claims to exercise ScreenCaptureKit, VideoToolbox, or macOS permissions.
const fs = require("node:fs");
const path = require("node:path");
if (process.argv.includes("--list-sources")) {
  process.stdout.write(
    JSON.stringify({
      video: {
        displays: [
          {
            electronSourceId: "screen:1:0",
            name: "Fixture display",
            frame: { width: 1920, height: 1080 },
          },
        ],
        applications: [
          {
            name: "Fixture app",
            windows: [
              {
                electronSourceId: "window:123:0",
                title: "Fixture window",
                isOnScreen: true,
                frame: { width: 1280, height: 720 },
              },
            ],
          },
        ],
      },
      webcams: [
        {
          uniqueID: "fixture-camera",
          name: "Fixture capture card",
          connected: true,
        },
      ],
      audio: {
        inputDevices: [
          { uniqueID: "fixture-audio", name: "Fixture capture audio" },
        ],
      },
    }),
  );
  process.exit(0);
}
const frames = JSON.parse(
  fs.readFileSync(path.join(__dirname, "frames.json"), "utf8"),
);
function packet(fd, type, data, pts = 0, key = false) {
  const header = Buffer.alloc(24);
  header.write("SCAP");
  header[4] = 1;
  header[5] = type;
  header.writeUInt16BE(key ? 1 : 0, 6);
  header.writeBigUInt64BE(BigInt(pts) * 1000n, 8);
  header.writeUInt32BE(data.length, 16);
  fs.writeSync(fd, Buffer.concat([header, data]));
}
const parameterSets = frames.parameterSets;
packet(
  3,
  1,
  Buffer.from(
    JSON.stringify({
      codec: "h264",
      format: "annexb",
      width: frames.width ?? 1280,
      height: frames.height ?? 720,
      fps: frames.fps ?? 60,
      parameterSets,
    }),
  ),
);
const withAudio =
  process.argv.includes("--input-audio-fd") ||
  process.argv.includes("--system-audio-fd");
// Exercise both rates in the same call. A capture card's rate need not match
// either the microphone, screen-audio device or the receiver's output device.
const sampleRate = process.argv.includes("--webcam-video-fd") ? 44100 : 48000;
const audioFrames = sampleRate / 50;
if (withAudio)
  packet(
    4,
    1,
    Buffer.from(
      JSON.stringify({
        codec: "lpcm",
        channels: 2,
        sampleRate,
        bitsPerChannel: 32,
        formatFlags: 9,
        isInterleaved: true,
      }),
    ),
  );
let videoIndex = 0,
  audioIndex = 0;
const started = performance.now();
const timestampOrigin = 14 * 24 * 60 * 60 * 1e6; // Native uptime need not start at zero.
let video,
  nextVideoAt = started;
const emitVideo = () => {
  const frame = frames.frames[videoIndex % frames.frames.length];
  videoIndex++;
  packet(
    3,
    2,
    Buffer.from(frame.data, "base64"),
    timestampOrigin + Math.round((performance.now() - started) * 1000),
    frame.key,
  );
  nextVideoAt = Math.max(
    nextVideoAt + 1000 / (frames.fps ?? 60),
    performance.now() + 1,
  );
  video = setTimeout(emitVideo, Math.max(1, nextVideoAt - performance.now()));
};
emitVideo();
let audio,
  nextAudioAt = performance.now();
const emitAudio = () => {
  if (!withAudio) return;
  const data = Buffer.alloc(audioFrames * 8);
  for (let i = 0; i < audioFrames; i++) {
    const time = (audioIndex * audioFrames + i) / sampleRate;
    data.writeFloatLE(0.2 * Math.sin(time * 2 * Math.PI * 440), i * 8);
    data.writeFloatLE(0.15 * Math.sin(time * 2 * Math.PI * 880), i * 8 + 4);
  }
  packet(4, 2, data, timestampOrigin + audioIndex++ * 20000, true);
  nextAudioAt += 20;
  audio = setTimeout(emitAudio, Math.max(1, nextAudioAt - performance.now()));
};
emitAudio();
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  clearTimeout(video);
  clearTimeout(audio);
  // Releasing a real capture device is not instantaneous.
  setTimeout(() => process.exit(0), 100);
};
process.stdin.resume();
process.stdin.on("end", stop);
process.stdin.on("data", stop);
process.on("SIGTERM", stop);
