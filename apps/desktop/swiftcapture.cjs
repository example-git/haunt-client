const { spawn, execFile } = require("node:child_process");
const { EventEmitter } = require("node:events");
const { promisify } = require("node:util");
const { randomUUID } = require("node:crypto");
const { captureDiagnostics } = require("./capture-diagnostics.cjs");

const LIMIT = 4 * 1024 * 1024;
// The watch client uses this same SCAP v1 framing. In FD mode stream_id is
// always zero: the descriptor identifies video versus source audio.
class PacketReader {
  constructor(receive) {
    this.receive = receive;
    this.header = Buffer.alloc(24);
    this.offset = 0;
    this.payload = null;
  }
  push(data) {
    let start = 0;
    while (start < data.length) {
      const target = this.payload ?? this.header;
      const size = Math.min(target.length - this.offset, data.length - start);
      data.copy(target, this.offset, start, start + size);
      this.offset += size;
      start += size;
      if (this.offset !== target.length) continue;
      this.offset = 0;
      if (!this.payload) {
        if (
          this.header.toString("ascii", 0, 4) !== "SCAP" ||
          this.header[4] !== 1 ||
          this.header[5] < 1 ||
          this.header[5] > 4
        )
          throw Error("Invalid SwiftCapture packet header");
        const length = this.header.readUInt32BE(16);
        if (length > LIMIT) throw Error("SwiftCapture packet exceeds limit");
        this.payload = Buffer.allocUnsafe(length);
        if (length) continue;
      }
      const packet = {
        type: this.header[5],
        key: !!(this.header.readUInt16BE(6) & 1),
        timestamp: Number(this.header.readBigUInt64BE(8) / 1000n),
        data: this.payload,
      };
      this.payload = null;
      this.receive(packet);
    }
  }
}

function videoConfig(value) {
  if (
    value.codec !== "h264" ||
    value.format !== "annexb" ||
    !Number.isInteger(value.width) ||
    !Number.isInteger(value.height) ||
    value.width < 1 ||
    value.width > 8192 ||
    value.height < 1 ||
    value.height > 8192 ||
    !Number.isFinite(value.fps) ||
    value.fps <= 0 ||
    value.fps > 1000
  )
    throw Error("Unsupported SwiftCapture video format");
  const sps = (value.parameterSets ?? [])
    .map((s) => Buffer.from(s, "base64"))
    .find((b) => (b[0] & 31) === 7);
  if (!sps || sps.length < 4)
    throw Error("SwiftCapture did not provide H.264 parameter sets");
  return {
    codec: `avc1.${sps.subarray(1, 4).toString("hex")}`,
    width: value.width,
    height: value.height,
    fps: value.fps,
    ...(typeof value.encoder === "string" ? { encoder: value.encoder } : {}),
    fmtp: `level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=${sps.subarray(1, 4).toString("hex")}`,
  };
}

function audioConfig(value) {
  if (
    value.codec !== "lpcm" ||
    !Number.isInteger(value.channels) ||
    value.channels < 1 ||
    value.channels > 16 ||
    typeof value.isInterleaved !== "boolean" ||
    !Number.isInteger(value.formatFlags) ||
    ![
      8000, 16000, 22050, 24000, 32000, 44100, 48000, 88200, 96000, 192000,
    ].includes(value.sampleRate) ||
    ![16, 32].includes(value.bitsPerChannel) ||
    value.formatFlags & 2
  )
    throw Error("Unsupported SwiftCapture PCM format");
  if (value.formatFlags & 1 && value.bitsPerChannel !== 32)
    throw Error("Unsupported SwiftCapture float format");
  if (!(value.formatFlags & 1) && !(value.formatFlags & 4))
    throw Error("Unsupported SwiftCapture unsigned PCM");
  return value;
}

// Capture cards can expose more than two channels. As in the watch client,
// preserve the first stereo pair and duplicate mono. No voice processing.
function stereoPCM(data, config) {
  const bytes = config.bitsPerChannel / 8;
  if (data.length % (bytes * config.channels))
    throw Error("Incomplete PCM frame");
  const frames = data.length / bytes / config.channels;
  if (frames > config.sampleRate / 2) throw Error("Oversized PCM block");
  const out = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++)
    for (let ch = 0; ch < 2; ch++) {
      const channel = Math.min(ch, config.channels - 1);
      const sample = config.isInterleaved
        ? i * config.channels + channel
        : channel * frames + i;
      const offset = sample * bytes;
      const value =
        config.formatFlags & 1
          ? data.readFloatLE(offset)
          : bytes === 2
            ? data.readInt16LE(offset) / 32768
            : data.readInt32LE(offset) / 2147483648;
      out[i * 2 + ch] = Number.isFinite(value)
        ? Math.max(-1, Math.min(1, value))
        : 0;
    }
  return out;
}

async function listSources(binary) {
  const { stdout } = await promisify(execFile)(
    binary,
    ["--list-sources", "--source-kind", "all"],
    { timeout: 20000, maxBuffer: 2 * 1024 * 1024 },
  );
  return sourceCatalog(JSON.parse(stdout));
}

function sourceCatalog(catalog) {
  const screens = [];
  const seen = new Set();
  const add = (item, name, kind) => {
    const id = item.electronSourceId;
    if (
      typeof id !== "string" ||
      !new RegExp(`^${kind}:\\d+:\\d+$`).test(id) ||
      seen.has(id) ||
      screens.length >= 200
    )
      return;
    const width = item.frame?.width,
      height = item.frame?.height;
    if (!(
      Number.isFinite(width) &&
      width > 0 &&
      Number.isFinite(height) &&
      height > 0
    ))
      return;
    seen.add(id);
    screens.push({ id, name: String(name).slice(0, 256), width, height });
  };
  for (const display of catalog.video?.displays ?? [])
    add(display, display.name, "screen");
  for (const app of catalog.video?.applications ?? [])
    for (const window of app.windows ?? [])
      if (window.isOnScreen !== false)
        add(
          window,
          window.title ? `${app.name} — ${window.title}` : app.name,
          "window",
        );
  return {
    screens,
    cameras: (catalog.webcams ?? [])
      .filter((d) => d.connected !== false)
      .slice(0, 100)
      .map((d) => ({
        id: d.uniqueID,
        label: d.name,
        formats: (d.formats ?? [])
          .filter(
            (f) =>
              Number.isInteger(f.width) &&
              Number.isInteger(f.height) &&
              f.width > 0 &&
              f.height > 0 &&
              Number.isFinite(f.minFPS) &&
              Number.isFinite(f.maxFPS) &&
              f.minFPS > 0 &&
              f.maxFPS >= f.minFPS,
          )
          .map(({ width, height, minFPS, maxFPS }) => ({
            width,
            height,
            minFPS,
            maxFPS,
          })),
      })),
    audio: (catalog.audio?.inputDevices ?? [])
      .filter((d) => d.connected !== false)
      .slice(0, 100)
      .map((d) => ({ id: d.uniqueID, label: d.name })),
  };
}

function argumentsFor(options) {
  const args = ["--control-fd", "0"];
  if (options.purpose === "camera") {
    args.push(
      "--no-video",
      "--capture-webcam",
      "--webcam-video-fd",
      "3",
      "--webcam-fps",
      String(options.fps ?? 60),
      "--webcam-width",
      String(options.width ?? 1920),
      "--webcam-height",
      String(options.height ?? 1080),
    );
    if (options.device) args.push("--webcam-device-id", options.device);
    if (options.audioDevice)
      args.push(
        "--capture-input-audio",
        "--input-device-id",
        options.audioDevice,
        "--input-audio-fd",
        "4",
      );
  } else {
    if (!/^(screen|window):\d+:\d+$/.test(options.source))
      throw Error("Invalid Electron capture source");
    args.push(
      "--source-id",
      options.source,
      "--video-fd",
      "3",
      "--fps",
      String(options.fps ?? 60),
      "--bitrate",
      String(
        Math.max(
          1_000_000,
          Math.round(
            (options.width ?? 1920) *
              (options.height ?? 1080) *
              (options.fps ?? 60) *
              0.07,
          ),
        ),
      ),
      "--keyframe-interval",
      String(options.fps ?? 60),
      "--show-cursor",
    );
    if (options.width && options.height)
      args.push(
        "--output-width",
        String(options.width),
        "--output-height",
        String(options.height),
      );
    if (options.audio)
      args.push("--capture-system-audio", "--system-audio-fd", "4");
  }
  return args;
}

class Capture extends EventEmitter {
  constructor(binary, options, runtime = {}) {
    super();
    this.options = options;
    this.closed = false;
    this.diagnosticID = options.diagnosticID ?? randomUUID();
    this.stderr = "";
    this.startupStderr = "";
    this.lastPacket = {};
    this.report("start", {
      binary,
      args: runtime.args ?? argumentsFor(options),
    });
    this.child = spawn(binary, runtime.args ?? argumentsFor(options), {
      stdio: ["pipe", "ignore", "pipe", "pipe", "pipe"],
      ...(runtime.env ? { env: runtime.env } : {}),
    });
    this.finished = new Promise((resolve) => this.child.once("close", resolve));
    this.child.once("spawn", () =>
      this.report("spawn", { pid: this.child.pid }),
    );
    this.child.stderr.on("data", (data) => {
      const text = data.toString();
      this.stderr = (this.stderr + text).slice(-16384);
      if (this.stderr.includes("Checking encoder "))
        this.videoStartedAt ??= Date.now();
      if (!this.video)
        this.startupStderr = (this.startupStderr + text).slice(-16384);
      this.report("worker", text);
    });
    this.child.once("error", (error) => this.fail(error));
    this.child.once("exit", (code, signal) => {
      this.report("exit", { code, signal, requested: this.closed });
    });
    this.child.once("close", (code, signal) => {
      this.exited = true;
      clearTimeout(this.killTimer);
      if (!this.closed) {
        const cancelled =
          code === 1 && this.workerFailure() === "Capture cancelled";
        this.fail(
          Error(
            cancelled
              ? "Capture cancelled"
              : `Capture worker exited unexpectedly (${signal ? `signal ${signal}` : `code ${code ?? "unknown"}`}).`,
          ),
        );
      }
    });
    // Both pipes are private to this process; no local listening socket.
    for (const [fd, kind] of [
      [3, "video"],
      [4, "audio"],
    ]) {
      const parser = new PacketReader((packet) => this.packet(kind, packet));
      this.child.stdio[fd].on("data", (chunk) => {
        try {
          parser.push(chunk);
        } catch (error) {
          this.fail(error);
        }
      });
      this.child.stdio[fd].on("error", (error) => this.fail(error));
      this.child.stdio[fd].on("end", () => {
        this.report("pipe-ended", kind);
        if (
          kind === "video" ||
          options.audio ||
          options.audioSource ||
          options.audioDevice
        ) {
          const timer = setTimeout(() => {
            if (!this.closed)
              this.fail(
                Error(
                  `Capture ${kind} pipe closed while the worker was running.`,
                ),
              );
          }, 250);
          timer.unref();
        }
      });
    }
    this.child.stdin.on("error", (error) => {
      if (!this.closed)
        this.fail(Error(`Capture control pipe failed: ${error.message}`));
    });
    if (runtime.stallTimeout) {
      this.watchdog = setInterval(() => {
        if (this.closed) return;
        if (!this.video) {
          if (
            this.videoStartedAt !== undefined &&
            Date.now() - this.videoStartedAt > runtime.stallTimeout
          )
            this.fail(
              Error(
                `Capture did not produce its first video frame within ${runtime.stallTimeout / 1000} seconds of encoder selection.`,
              ),
            );
          return;
        }
        for (const kind of [
          "video",
          ...(options.audio || options.audioSource ? ["audio"] : []),
        ]) {
          if (
            Date.now() - (this.lastPacket[kind] ?? this.configuredAt) >
            runtime.stallTimeout
          ) {
            this.fail(
              Error(
                `Capture stopped delivering ${kind} for ${runtime.stallTimeout / 1000} seconds (${this.video.encoder ?? this.video.codec}).`,
              ),
            );
            break;
          }
        }
      }, 1000);
      this.watchdog.unref();
    }
  }
  report(event, detail) {
    captureDiagnostics.record(this.diagnosticID, event, detail);
  }
  workerFailure() {
    return (
      this.stderr.match(/^Capture failure: (.+)$/m)?.[1] ??
      this.stderr.trim().split("\n").at(-1)
    );
  }
  packet(kind, packet) {
    if (this.closed) return;
    if (packet.type === 1) {
      const raw = JSON.parse(packet.data.toString());
      if (kind === "video") {
        this.video = videoConfig(raw);
        this.configuredAt = Date.now();
        this.lastPacket.video = this.configuredAt;
        this.report("video-config", this.video);
        this.emit("video-config", this.video);
      } else {
        this.audio = audioConfig(raw);
        this.report("audio-config", this.audio);
        this.emit("audio-config", { sampleRate: raw.sampleRate });
      }
    } else if (packet.type === 2) {
      this.lastPacket[kind] = Date.now();
      if (kind === "video" && this.video) this.emit("video", packet);
      if (kind === "audio" && this.audio)
        this.emit("audio", {
          ...packet,
          data: stereoPCM(packet.data, this.audio),
        });
    } else if (packet.type === 3) this.fail(Error("Capture source ended"));
    else if (packet.type === 4)
      this.fail(Error(packet.data.toString().slice(0, 4096)));
  }
  fail(error) {
    if (this.closed || this.failing) return;
    this.failing = true;
    if (error.message !== "Capture cancelled") {
      const detail = this.workerFailure();
      if (detail && !error.message.includes(detail))
        error.message += ` ${detail}`;
    }
    this.report("failure", {
      message: error.message,
      video: this.video,
      lastPacket: this.lastPacket,
      startup: this.startupStderr,
      stderr: this.stderr,
    });
    this.emit("failure", error);
    this.stop();
  }
  stop() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.watchdog);
    this.report("stop", { failed: !!this.failing });
    this.emit("stopped");
    if (this.exited) return;
    this.child.stdin.end("stop\n");
    this.child.kill("SIGTERM");
    this.killTimer = setTimeout(() => {
      if (this.child.exitCode === null && this.child.signalCode === null) {
        this.report(
          "forced-stop",
          "Worker did not exit after SIGTERM; sending SIGKILL",
        );
        this.child.kill("SIGKILL");
      }
    }, 2000);
    this.killTimer.unref();
    // Never enumerate processes or kill workers owned by another app.
  }
}
module.exports = {
  PacketReader,
  videoConfig,
  audioConfig,
  stereoPCM,
  listSources,
  sourceCatalog,
  argumentsFor,
  Capture,
  LIMIT,
};
