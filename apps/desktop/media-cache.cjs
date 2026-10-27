const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const maxItem = 20 * 1024 * 1024;
const digest = (value) => createHash("sha256").update(value).digest("hex");
const validType = (type) =>
  /^(image\/(png|jpeg|gif|webp|avif)|application\/json)$/.test(type);

/** Private binary files, atomic writes, bounded LRU. Reads stay independent. */
class DiskMediaCache {
  constructor(directory, budget = 512 * 1024 * 1024, limit = 4096) {
    this.directory = directory;
    this.budget = budget;
    this.limit = limit;
    this.entries = new Map();
    this.bytes = 0;
    this.writes = Promise.resolve();
  }
  key(raw) {
    if (typeof raw !== "string" || !raw.length || raw.length > 8192)
      throw Error("Invalid media cache key");
    return digest(raw);
  }
  init() {
    return (this.ready ??= (async () => {
      await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
      const files = await fs.readdir(this.directory);
      // Startup reads metadata only; image bytes are loaded on demand.
      for (let offset = 0; offset < files.length; offset += 16) {
        await Promise.all(
          files.slice(offset, offset + 16).map(async (name) => {
            if (/^[a-f0-9]{64}\.[a-f0-9-]+\.tmp$/.test(name)) {
              await fs.unlink(path.join(this.directory, name)).catch(() => {});
            } else if (/^[a-f0-9]{64}$/.test(name)) {
              const info = await fs.lstat(path.join(this.directory, name));
              if (!info.isFile() || info.size > maxItem + 512) return;
              this.entries.set(name, {
                bytes: info.size,
                touched: info.mtimeMs,
              });
              this.bytes += info.size;
            }
          }),
        );
      }
      await this.trim();
    })());
  }
  async trim() {
    if (this.bytes <= this.budget && this.entries.size <= this.limit) return;
    const oldest = [...this.entries].sort(
      (a, b) => a[1].touched - b[1].touched,
    );
    for (const [key, entry] of oldest) {
      if (this.bytes <= this.budget && this.entries.size <= this.limit) break;
      await fs.unlink(path.join(this.directory, key)).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
      this.bytes -= entry.bytes;
      this.entries.delete(key);
    }
  }
  async get(raw) {
    const key = this.key(raw);
    await this.init();
    const entry = this.entries.get(key);
    if (!entry) return null;
    try {
      const data = await fs.readFile(path.join(this.directory, key));
      const newline = data.indexOf(10);
      if (newline < 0 || newline > 512) return null;
      const header = JSON.parse(data.subarray(0, newline).toString());
      const body = data.subarray(newline + 1);
      if (
        !validType(header.type) ||
        !body.length ||
        body.length > maxItem ||
        digest(body) !== header.sha256
      )
        return null;
      const now = Date.now(),
        old = entry.touched;
      entry.touched = now;
      if (now - old > 60_000)
        await fs
          .utimes(path.join(this.directory, key), now / 1000, now / 1000)
          .catch(() => {});
      return { type: header.type, data: body };
    } catch (error) {
      // Corrupt/evicted cache files are misses, never a permanent image error.
      return null;
    }
  }
  put(raw, value) {
    const key = this.key(raw);
    if (
      !value ||
      !validType(value.type) ||
      !(value.data instanceof Uint8Array) ||
      !value.data.byteLength ||
      value.data.byteLength > maxItem
    )
      return Promise.reject(Error("Invalid cached media"));
    const body = Buffer.from(value.data);
    const header = Buffer.from(
      JSON.stringify({ type: value.type, sha256: digest(body) }) + "\n",
    );
    const data = Buffer.concat([header, body]);
    if (data.length > this.budget) return Promise.resolve();
    // Only cache file mutations queue; network traffic and reads are independent.
    const task = this.writes.then(async () => {
      await this.init();
      const file = path.join(this.directory, key),
        temporary = file + "." + randomUUID() + ".tmp";
      try {
        await fs.writeFile(temporary, data, { mode: 0o600, flag: "wx" });
        await fs.rename(temporary, file);
      } finally {
        await fs.unlink(temporary).catch(() => {});
      }
      this.bytes += data.length - (this.entries.get(key)?.bytes ?? 0);
      this.entries.set(key, { bytes: data.length, touched: Date.now() });
      await this.trim();
    });
    this.writes = task.catch(() => {});
    return task;
  }
  async stats() {
    await this.init();
    await this.writes;
    return {
      bytes: this.bytes,
      entries: this.entries.size,
      budget: this.budget,
    };
  }
  configure(budget, clear = false) {
    if (
      !Number.isInteger(budget) ||
      budget < 16 * 1024 * 1024 ||
      budget > 8 * 1024 * 1024 * 1024
    )
      return Promise.reject(
        Error("Choose a media cache budget from 16 to 8192 MiB."),
      );
    const task = this.writes.then(async () => {
      await this.init();
      this.budget = clear ? 0 : budget;
      try {
        await this.trim();
      } finally {
        this.budget = budget;
      }
    });
    this.writes = task.catch(() => {});
    return task;
  }
}
module.exports = { DiskMediaCache };
