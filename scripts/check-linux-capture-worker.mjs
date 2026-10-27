import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { LinuxCapture, listSources } = require(
  process.env.HAUNT_CAPTURE_MODULE || "../apps/desktop/linux-capture.cjs",
);
const exec = promisify(execFile);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const scratch = await fs.mkdtemp(
  path.join(os.tmpdir(), "haunt-capture-worker-"),
);
const children = [];
let capture,
  diagnostics = "";
const child = (command, args, options = {}) => {
  const process = spawn(command, args, {
    stdio: ["pipe", "pipe", "pipe"],
    ...options,
  });
  children.push(process);
  process.ownedGroup = options.detached === true;
  process.stderr.on("data", (data) => {
    diagnostics = (diagnostics + data).slice(-12000);
  });
  process.stdin.on("error", () => {});
  return process;
};
async function until(check, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await wait(100);
  }
  throw Error("Capture condition timed out\n" + diagnostics);
}
function amplitude(samples, frequency) {
  let real = 0,
    imaginary = 0;
  for (let i = 0; i < samples.length; i++) {
    const angle = (2 * Math.PI * frequency * i) / 48000;
    real += samples[i] * Math.cos(angle);
    imaginary += samples[i] * Math.sin(angle);
  }
  return (2 * Math.hypot(real, imaginary)) / samples.length;
}
try {
  if (!process.env.HAUNT_CAPTURE_EXISTING_SESSION) {
    process.env.LIBGL_ALWAYS_SOFTWARE = "1";
    const xvfb = child("Xvfb", [
      "-displayfd",
      "1",
      "-screen",
      "0",
      "960x600x24",
      "-nolisten",
      "tcp",
    ]);
    const [display] = await once(xvfb.stdout, "data");
    process.env.DISPLAY = ":" + display.toString().trim();
    delete process.env.WAYLAND_DISPLAY;
    process.env.XDG_SESSION_TYPE = "x11";
    if (process.env.HAUNT_CAPTURE_AUDIO_SERVER === "pipewire") {
      const runtime = path.join(scratch, "runtime");
      await fs.mkdir(runtime, { mode: 0o700 });
      process.env.XDG_RUNTIME_DIR = runtime;
      process.env.PULSE_SERVER = "unix:" + path.join(runtime, "pulse/native");
      child("pipewire", []);
      await until(() =>
        fs.access(path.join(runtime, "pipewire-0")).then(
          () => true,
          () => false,
        ),
      );
      child("wireplumber", []);
      child("pipewire-pulse", []);
      await until(() =>
        exec("pactl", ["info"]).then(
          () => true,
          () => false,
        ),
      );
      await exec("pactl", [
        "load-module",
        "module-null-sink",
        "sink_name=haunt_fixture",
        "rate=48000",
        "channels=2",
      ]);
      await until(() =>
        exec("pactl", ["set-default-sink", "haunt_fixture"]).then(
          () => true,
          () => false,
        ),
      );
    } else {
      if (
        process.env.HAUNT_CAPTURE_AUDIO_SERVER &&
        process.env.HAUNT_CAPTURE_AUDIO_SERVER !== "pulse"
      )
        throw Error("Unsupported test audio server");
      const config = path.join(scratch, "pulse.pa");
      process.env.PULSE_SERVER = "unix:" + path.join(scratch, "pulse.sock");
      await fs.writeFile(
        config,
        `load-module module-native-protocol-unix socket=${path.join(scratch, "pulse.sock")} auth-anonymous=1\nload-module module-null-sink sink_name=haunt_fixture rate=48000 channels=2\nset-default-sink haunt_fixture\n`,
      );
      child(
        "dbus-run-session",
        [
          "--",
          "pulseaudio",
          "-n",
          "--file=" + config,
          "--daemonize=no",
          "--use-pid-file=no",
          "--exit-idle-time=-1",
        ],
        { detached: true },
      );
      await until(() =>
        fs.access(path.join(scratch, "pulse.sock")).then(
          () => true,
          () => false,
        ),
      );
    }
  }
  process.env.PULSE_SINK = "haunt_fixture";
  const first = child("python3", [
    "scripts/ci/audio-app.py",
    "Selected audio app",
  ]);
  const other = child("python3", [
    "scripts/ci/audio-app.py",
    "Other audio app",
  ]);
  first.stdin.write("add 997\n");
  other.stdin.write("add 1601\n");
  const binary = path.resolve(
    process.env.HAUNT_CAPTURE_WORKER ||
      "release/native/linux/HauntCaptureWorker",
  );
  let catalog;
  await until(async () => {
    catalog = await listSources(binary);
    return (
      catalog.audioSources.some((a) => a.pid === first.pid) &&
      catalog.audioSources.some((a) => a.pid === other.pid)
    );
  });
  const snapshot = async () =>
    JSON.parse(
      (await exec("pactl", ["-f", "json", "list", "sink-inputs"])).stdout,
    )
      .filter((i) =>
        [String(first.pid), String(other.pid)].includes(
          i.properties?.["application.process.id"],
        ),
      )
      .map(({ index, sink, mute, volume }) => ({ index, sink, mute, volume }))
      .sort((a, b) => a.index - b.index);
  const before = await snapshot();
  const defaults = async () =>
    (await exec("pactl", ["info"])).stdout
      .split("\n")
      .filter((line) => line.startsWith("Default "));
  const serverBefore = await defaults();
  let pcm = [],
    video = [],
    failure,
    configs = [],
    configuring = false,
    silentSamples = 0,
    longestSilence = 0;
  const start = (audioSource) => {
    pcm = [];
    video = [];
    failure = undefined;
    configs = [];
    capture = new LinuxCapture(binary, {
      source: catalog.screens[0].id,
      width: 640,
      height: 480,
      fps: 30,
      audioSource,
    });
    capture.child.stderr.on("data", (data) => {
      diagnostics = (diagnostics + data).slice(-12000);
    });
    capture.on("failure", (error) => {
      failure = error;
      diagnostics += error.message;
    });
    capture.on("video-config", (config) => configs.push(config));
    capture.on("video", (packet) => {
      if (video.length < 60) video.push(packet.data);
    });
    capture.on("audio", (packet) => {
      if (configuring) {
        let energy = 0;
        for (let i = 0; i < packet.data.length; i += 2)
          energy += packet.data[i] ** 2;
        const frames = packet.data.length / 2;
        silentSamples = energy / frames < 0.001 ? silentSamples + frames : 0;
        longestSilence = Math.max(longestSilence, silentSamples);
      }
      for (let i = 0; i < packet.data.length; i += 2) pcm.push(packet.data[i]);
      if (pcm.length > 48000) pcm.splice(0, pcm.length - 48000);
    });
  };
  const measure = async (present, absent) => {
    await until(() => {
      if (failure) throw failure;
      return (
        pcm.length >= 24000 &&
        present.every((f) => amplitude(pcm.slice(-24000), f) > 0.07) &&
        absent.every((f) => amplitude(pcm.slice(-24000), f) < 0.005)
      );
    }).catch((error) => {
      throw Error(
        `${error.message}\n${JSON.stringify(Object.fromEntries([...present, ...absent].map((f) => [f, amplitude(pcm.slice(-24000), f)])))}`,
      );
    });
    return Object.fromEntries(
      [...present, ...absent].map((f) => [f, amplitude(pcm.slice(-24000), f)]),
    );
  };
  start(catalog.audioSources.find((a) => a.pid === first.pid).id);
  const isolated = await measure([997], [1601]);
  await until(() => video.length >= 20 && configs.length === 1).catch(
    (error) => {
      throw Error(
        `${error.message}\n${JSON.stringify({ configs, videoPackets: video.length, audioSamples: pcm.length })}`,
      );
    },
  );
  const encoded = path.join(scratch, "video.h264");
  await fs.writeFile(encoded, Buffer.concat(video));
  const probe = JSON.parse(
    (
      await exec("ffprobe", [
        "-v",
        "error",
        "-show_streams",
        "-of",
        "json",
        encoded,
      ])
    ).stdout,
  );
  assert.equal(probe.streams[0].codec_name, "h264");
  assert(probe.streams[0].width > 0);
  assert.equal(probe.streams[0].has_b_frames, 0);
  const initialMode = configs[0];
  if (process.env.HAUNT_EXPECT_ENCODER)
    assert.match(
      initialMode.encoder,
      new RegExp(process.env.HAUNT_EXPECT_ENCODER),
    );
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(await defaults(), serverBefore);
  first.stdin.write("add 701\n");
  const multiple = await measure([997, 701], [1601]);
  first.stdin.write("remove 997\n");
  const removed = await measure([701], [997, 1601]);
  configuring = true;
  const changed = await capture.configure({ width: 320, height: 240, fps: 15 });
  configuring = false;
  assert(
    longestSilence / 48 < 200,
    `Video configuration silenced audio for ${longestSilence / 48} ms`,
  );
  assert(changed.width <= 320 && changed.height <= 240 && changed.fps === 15);
  await measure([701], [1601]);
  capture.stop();
  await capture.finished;
  start(
    catalog.audioSources.find(
      (a) => a.kind === "output" && a.id.includes("haunt_fixture"),
    ).id,
  );
  const entire = await measure([701, 1601], []);
  capture.stop();
  await capture.finished;
  await until(
    async () =>
      !JSON.parse(
        (await exec("pactl", ["-f", "json", "list", "source-outputs"])).stdout,
      ).some(
        (i) => i.properties?.["application.name"] === "Haunt screen audio",
      ),
  );
  await fs.mkdir("test-results", { recursive: true });
  const evidence = {
    session: process.env.XDG_SESSION_TYPE,
    isolated,
    multiple,
    removed,
    entire,
    mode: changed,
    initialMode,
    configureSilenceMs: longestSilence / 48,
    playbackPreserved: true,
  };
  await fs.writeFile(
    `test-results/linux-capture-worker-${process.env.XDG_SESSION_TYPE}.json`,
    JSON.stringify(evidence, null, 2),
  );
  console.log(
    "PASS native GStreamer video, app audio isolation, new/removed streams, live resize, whole output, playback preservation and teardown",
    evidence,
  );
} catch (error) {
  console.error(diagnostics);
  throw error;
} finally {
  capture?.stop();
  await capture?.finished;
  for (const proc of children.reverse()) {
    proc.stdin.end();
    try {
      proc.ownedGroup
        ? process.kill(-proc.pid, "SIGTERM")
        : proc.kill("SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  await fs.rm(scratch, { recursive: true, force: true });
}
