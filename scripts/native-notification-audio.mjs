import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { expect } from "@playwright/test";
import assert from "node:assert/strict";
const run = promisify(execFile);

// A real PipeWire output device and its monitor. The app uses normal Chromium
// audio routing; the observer records PCM after it reaches the OS audio server.
export async function prepareLinuxAudio(scratch, target) {
  if (process.platform !== "linux") return undefined;
  const runtime = process.env.XDG_RUNTIME_DIR || path.join(scratch, "runtime");
  await fs.mkdir(runtime, { recursive: true, mode: 0o700 });
  process.env.XDG_RUNTIME_DIR = runtime;
  const children = [];
  let recorder,
    log,
    stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    recorder?.kill();
    for (const child of children.reverse()) child.kill();
    await log?.close();
  };
  try {
    await fs.mkdir("test-results", { recursive: true });
    log = await fs.open(`test-results/notification-${target}-audio.log`, "a");
    for (const command of ["pipewire", "wireplumber", "pipewire-pulse"])
      children.push(spawn(command, [], { stdio: ["ignore", log.fd, log.fd] }));
    let identity;
    await expect
      .poll(
        async () => {
          try {
            identity = (
              await run("pactl", ["info"], {
                env: { ...process.env, LC_ALL: "C" },
              })
            ).stdout;
            return identity.includes("PipeWire");
          } catch {
            return false;
          }
        },
        { timeout: 30000 },
      )
      .toBe(true);
    await run("pactl", [
      "load-module",
      "module-null-sink",
      "sink_name=haunt_ci",
      "sink_properties=device.description=Haunt_CI_Output",
    ]);
    await run("pactl", ["set-default-sink", "haunt_ci"]);
    const chunks = [];
    let remainder = Buffer.alloc(0),
      recordedBytes = 0;
    recorder = spawn(
      "parec",
      [
        "--device=haunt_ci.monitor",
        "--format=s16le",
        "--rate=48000",
        "--channels=2",
        "--raw",
        "--latency-msec=20",
      ],
      { stdio: ["ignore", "pipe", log.fd] },
    );
    recorder.stdout.on("data", (data) => {
      data = Buffer.concat([remainder, data]);
      remainder = data.subarray(data.length - (data.length % 2));
      data = data.subarray(0, data.length - (data.length % 2));
      let peak = 0;
      for (let offset = 0; offset < data.length; offset += 2)
        peak = Math.max(peak, Math.abs(data.readInt16LE(offset)));
      recordedBytes += data.length;
      chunks.push({ at: Date.now(), peak, bytes: data.length });
      while (chunks.length > 2000) chunks.shift();
    });
    await expect
      .poll(() => recordedBytes, { timeout: 10000 })
      .toBeGreaterThan(0);
    return {
      identity,
      async check(since, audible) {
        const measured = () => chunks.filter((chunk) => chunk.at >= since);
        if (audible)
          await expect
            .poll(() => Math.max(0, ...measured().map((chunk) => chunk.peak)), {
              timeout: 10000,
            })
            .toBeGreaterThan(8);
        const samples = measured();
        assert(samples.length, "The OS audio monitor recorded samples");
        const peak = Math.max(0, ...samples.map((chunk) => chunk.peak));
        if (!audible)
          assert(
            peak <= 8,
            `Expected silence at the OS output, received PCM peak ${peak}`,
          );
        return {
          server: "PipeWire",
          device: "haunt_ci.monitor",
          peak,
          bytes: samples.reduce((sum, chunk) => sum + chunk.bytes, 0),
          audible,
        };
      },
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
