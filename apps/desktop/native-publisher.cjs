const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");
const purposes = ["audio", "camera", "screen", "camera_audio", "screen_audio"];

class NativePublisher extends EventEmitter {
  constructor(binary) {
    super();
    this.closed = false;
    this.ready = false;
    this.waiters = new Map();
    this.needKey = new Set([
      "camera:h",
      "screen:h",
      "camera:m",
      "screen:m",
      "camera:l",
      "screen:l",
    ]);
    this.bindings = [];
    this.child = spawn(binary, [], {
      stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"],
    });
    let output = "";
    this.child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      if (output.length > 256 * 1024)
        return this.fail(Error("Native publisher response exceeds limit"));
      let end;
      while ((end = output.indexOf("\n")) >= 0) {
        const line = output.slice(0, end);
        output = output.slice(end + 1);
        try {
          this.message(JSON.parse(line));
        } catch (e) {
          this.fail(e);
        }
      }
    });
    this.child.stderr.resume();
    for (const stream of [
      this.child.stdin,
      this.child.stdio[3],
      this.child.stdio[4],
    ])
      stream.on("error", (error) => this.fail(error));
    this.child.on("error", (error) => this.fail(error));
    this.child.once("close", () => {
      clearTimeout(this.killTimer);
      if (!this.closed) this.fail(Error("Native publisher stopped"));
    });
  }
  message(message) {
    if (message.type === "keyframe") this.emit("keyframe", message);
    if (message.type === "error") return this.fail(Error(message.message));
    if (
      message.type === "state" &&
      ["failed", "disconnected"].includes(message.state)
    )
      return this.fail(Error("Native media connection interrupted"));
    this.waiters.get(message.type)?.resolve(message);
  }
  command(command) {
    if (this.closed) return Promise.reject(Error("Native publisher closed"));
    return new Promise((resolve, reject) => {
      const finish = (error, value) => {
        clearTimeout(timer);
        this.waiters.delete(command.type);
        error ? reject(error) : resolve(value);
      };
      const timer = setTimeout(
        () => finish(Error("Native publisher timed out")),
        12000,
      );
      this.waiters.set(command.type, {
        resolve: (value) => finish(null, value),
        reject: (error) => finish(error),
      });
      this.child.stdin.write(JSON.stringify(command) + "\n");
    });
  }
  bind(purpose, capture) {
    const send = (packet) =>
      this.packet(purpose, packet.data, packet.timestamp, packet.key);
    capture.on("video", send);
    this.bindings.push(() => capture.removeListener("video", send));
  }
  packet(purpose, bytes, timestamp, key = true, layer = "h") {
    if (this.closed || !this.ready) return;
    const video = purpose === "camera" || purpose === "screen";
    const pipe = this.child.stdio[layer === "h" ? 3 : 4];
    const stream = `${purpose}:${layer}`;
    if (pipe.writableLength > (layer === "h" ? 512 : 256) * 1024) {
      if (video) this.needKey.add(stream);
      return;
    }
    if (video && this.needKey.has(stream)) {
      if (!key) return;
      this.needKey.delete(stream);
    }
    const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const frame = Buffer.allocUnsafe(14 + data.length);
    frame.writeUInt32BE(10 + data.length, 0);
    frame[4] = purposes.indexOf(purpose) + ["h", "m", "l"].indexOf(layer) * 16;
    frame[5] = key ? 1 : 0;
    frame.writeBigUInt64BE(BigInt(Math.max(0, Math.round(timestamp))), 6);
    data.copy(frame, 14);
    pipe.write(frame);
  }
  fail(error) {
    if (this.closed) return;
    this.emit("failure", error);
    this.close();
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const binding of this.bindings) binding();
    for (const waiter of this.waiters.values())
      waiter.reject(Error("Native publisher closed"));
    this.child.stdin.end();
    this.child.stdio[3].end();
    this.child.stdio[4].end();
    this.killTimer = setTimeout(() => {
      if (this.child.exitCode === null && this.child.signalCode === null)
        this.child.kill("SIGKILL");
    }, 2000);
    this.killTimer.unref();
  }
}
module.exports = { NativePublisher, purposes };
