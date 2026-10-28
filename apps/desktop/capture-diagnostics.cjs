const fs = require("node:fs/promises");
const path = require("node:path");

class CaptureDiagnostics {
  constructor() {
    this.text = "";
    this.limit = 256 * 1024;
    this.ready = Promise.resolve();
  }
  configure(directory) {
    this.filename = path.join(directory, "capture.log");
    this.ready = (async () => {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      try {
        const previous = await fs.readFile(this.filename, "utf8");
        this.text = (previous + this.text).slice(-this.limit);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    })().catch((error) => this.writeFailed(error));
  }
  record(id, event, detail) {
    const line = JSON.stringify({
      time: new Date().toISOString(),
      id,
      event,
      detail: typeof detail === "string" ? detail.slice(-16384) : detail,
    });
    this.text = (this.text + line + "\n").slice(-this.limit);
    this.dirty = true;
    void this.flush();
  }
  writeFailed(error) {
    this.writeError = error.message;
    console.error("Capture diagnostics could not be saved:", error.message);
  }
  flush() {
    if (this.pending) return this.pending;
    if (!this.filename) return Promise.resolve();
    this.pending = (async () => {
      await this.ready;
      while (this.dirty) {
        this.dirty = false;
        await fs.writeFile(this.filename + ".tmp", this.text, { mode: 0o600 });
        await fs.rename(this.filename + ".tmp", this.filename);
        this.writeError = undefined;
      }
    })()
      .catch((error) => this.writeFailed(error))
      .finally(() => {
        this.pending = undefined;
        if (this.dirty) void this.flush();
      });
    return this.pending;
  }
  async snapshot() {
    await this.ready;
    await this.flush();
    return { file: this.filename, writeError: this.writeError, log: this.text };
  }
}

module.exports = {
  CaptureDiagnostics,
  captureDiagnostics: new CaptureDiagnostics(),
};
