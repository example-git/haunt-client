// Runs in the permanent launcher, before any downloaded application code.
// No Electron dependency: the same file-system/verification code runs in CI.
const crypto = require("node:crypto");
const https = require("node:https");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const { Transform } = require("node:stream");
const { EventEmitter } = require("node:events");
let fs;
try {
  fs = require("original-fs");
} catch {
  fs = require("node:fs");
}
const fsp = fs.promises;
const MAX_MANIFEST = 128 * 1024;
const MAX_ARCHIVE = 256 * 1024 * 1024;
const MAX_INSTALLER = 1024 * 1024 * 1024;
const VERSION = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
function compare(a, b) {
  if (!VERSION.test(a) || !VERSION.test(b))
    throw Error("Invalid release version");
  const x = a.split(".").map(Number),
    y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return Math.sign(x[i] - y[i]);
  return 0;
}
function repository(value) {
  if (typeof value !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(value))
    throw Error("Invalid update repository");
  return value;
}
function releaseURL(repo, version, file, feedURL) {
  if (feedURL) return new URL(`client-v${version}/${file}`, feedURL).href;
  return `https://github.com/${repository(repo)}/releases/download/client-v${version}/${file}`;
}
function artifact(value, ext, max) {
  if (
    !value ||
    typeof value.file !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,160}$/.test(value.file) ||
    !value.file.endsWith(ext) ||
    !/^[a-f0-9]{64}$/.test(value.sha256) ||
    !Number.isSafeInteger(value.size) ||
    value.size < 1 ||
    value.size > max
  )
    throw Error("Invalid update artifact");
}
function linuxInstallerFormat(resourcesPath, appImage = process.env.APPIMAGE) {
  if (appImage) return "AppImage";
  try {
    const format = fs
      .readFileSync(path.join(resourcesPath, "package-type"), "utf8")
      .trim();
    if (format !== "rpm")
      throw Error("Unsupported installed Linux package format: " + format);
    return format;
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}
function verifyManifest(envelope, config, platform, arch) {
  if (!config.publicKey)
    throw Error("Updates are not configured in this build");
  if (
    !envelope ||
    envelope.schema !== 1 ||
    typeof envelope.payload !== "string" ||
    envelope.payload.length > MAX_MANIFEST ||
    typeof envelope.signature !== "string"
  )
    throw Error("Invalid update manifest");
  const payload = Buffer.from(envelope.payload, "base64");
  const signature = Buffer.from(envelope.signature, "base64");
  const key = crypto.createPublicKey(config.publicKey);
  if (
    key.asymmetricKeyType !== "ed25519" ||
    signature.length !== 64 ||
    !crypto.verify(null, payload, key, signature)
  )
    throw Error("Update signature could not be verified");
  const data = JSON.parse(payload.toString("utf8"));
  if (
    data.schema !== 1 ||
    data.repository !== repository(config.repository) ||
    !VERSION.test(data.version) ||
    typeof data.notes !== "string" ||
    data.notes.length > 8000
  )
    throw Error("Invalid release metadata");
  const target = data.targets?.[`${platform}-${arch}`];
  if (!target || !/^[a-f0-9]{64}$/.test(target.runtime))
    throw Error("No compatible release for this device");
  artifact(target.asar, ".asar", MAX_ARCHIVE);
  artifact(
    target.installer,
    platform === "win32"
      ? ".exe"
      : platform === "darwin"
        ? ".dmg"
        : ".AppImage",
    MAX_INSTALLER,
  );
  if (target.rpm !== undefined) {
    if (platform !== "linux")
      throw Error("RPM installer is only valid for Linux");
    artifact(target.rpm, ".rpm", MAX_INSTALLER);
  }
  let installer = target.installer;
  if (config.installerFormat !== undefined) {
    if (
      platform !== "linux" ||
      !["rpm", "AppImage"].includes(config.installerFormat)
    )
      throw Error("Unsupported installer format");
    if (config.installerFormat === "rpm") {
      if (!target.rpm)
        throw Error("This release does not provide a Fedora RPM installer.");
      installer = target.rpm;
    }
  }
  return { ...target, installer, version: data.version, notes: data.notes };
}
function requestURL(raw, config) {
  const repo = typeof config === "string" ? config : config.repository;
  const feed =
    typeof config === "object" && config.feedURL
      ? new URL(config.feedURL)
      : null;
  const url = new URL(raw);
  const ownFeed =
    feed &&
    feed.protocol === "https:" &&
    url.origin === feed.origin &&
    url.pathname.startsWith(feed.pathname);
  const allowed = config.token
    ? ownFeed
    : ownFeed ||
      (url.hostname === "github.com"
        ? url.pathname.startsWith(`/${repository(repo)}/releases/`)
        : [
            "release-assets.githubusercontent.com",
            "objects.githubusercontent.com",
            "github-releases.githubusercontent.com",
          ].includes(url.hostname));
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !allowed
  )
    throw Error("Untrusted update download location");
  return url;
}
// Bounded redirects, idle timeout, no cookies or service credentials.
async function response(url, repo, redirects = 0) {
  const target = requestURL(url, repo);
  if (redirects > 5) throw Error("Too many update redirects");
  const res = await new Promise((resolve, reject) => {
    const req = https.get(
      target,
      {
        headers: {
          "User-Agent": "Haunt-Updater",
          "Accept-Encoding": "identity",
          ...(repo.token ? { Authorization: `Bearer ${repo.token}` } : {}),
        },
      },
      resolve,
    );
    req.setTimeout(30_000, () =>
      req.destroy(Error("Update download timed out")),
    );
    req.on("error", reject);
  });
  if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
    const next = res.headers.location;
    res.destroy();
    if (!next) throw Error("Missing update redirect");
    return response(new URL(next, target).href, repo, redirects + 1);
  }
  if (res.statusCode !== 200) {
    res.destroy();
    throw Error(
      res.statusCode === 404
        ? "No published client release is available yet"
        : `Update server returned ${res.statusCode}`,
    );
  }
  return res;
}
async function readSmall(filename) {
  const stat = await fsp.stat(filename);
  if (stat.size > MAX_MANIFEST * 4) throw Error("Update state is too large");
  return JSON.parse(await fsp.readFile(filename, "utf8"));
}
async function atomicJSON(filename, value) {
  const temporary = filename + ".tmp";
  const handle = await fsp.open(temporary, "w", 0o600);
  try {
    await handle.writeFile(JSON.stringify(value));
    await handle.sync();
  } finally {
    await handle.close();
  }
  // Node uses replace-existing semantics on Windows; no unlink gap.
  await fsp.rename(temporary, filename);
}
async function hashFile(filename) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}
async function verifyFile(filename, info) {
  const stat = await fsp.lstat(filename);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size !== info.size ||
    (await hashFile(filename)) !== info.sha256
  )
    throw Error("Update file is incomplete or has changed");
}
async function download(stream, destination, info, progress = () => {}) {
  const temporary = destination + ".part";
  let size = 0,
    last = 0;
  const hash = crypto.createHash("sha256");
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length;
      if (size > info.size)
        return callback(Error("Update exceeds its signed size"));
      hash.update(chunk);
      if (Date.now() - last > 200) {
        last = Date.now();
        progress(size / info.size);
      }
      callback(null, chunk);
    },
  });
  const deadline = setTimeout(
    () => stream.destroy(Error("Update download timed out")),
    15 * 60_000,
  );
  deadline.unref?.();
  try {
    await pipeline(
      stream,
      meter,
      fs.createWriteStream(temporary, { flags: "w", mode: 0o600 }),
    );
    if (size !== info.size || hash.digest("hex") !== info.sha256)
      throw Error("Update checksum does not match");
    const handle = await fsp.open(temporary, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fsp.rename(temporary, destination);
    progress(1);
  } finally {
    clearTimeout(deadline);
    await fsp.rm(temporary, { force: true });
  }
}

class Updater extends EventEmitter {
  constructor({
    directory,
    config,
    runtime,
    version,
    platform = process.platform,
    arch = process.arch,
    getResponse = response,
  }) {
    super();
    this.directory = directory;
    this.config = config;
    this.runtime = runtime;
    this.baseline = version;
    this.development = config.channel === "dev" || /-dev\.\d+$/.test(version);
    this.platform = platform;
    this.arch = arch;
    this.getResponse = getResponse;
    this.state = {};
    this.sources = new Map();
    this.status = {
      phase: !this.development && config.publicKey ? "idle" : "disabled",
      current: version,
      message: this.development
        ? "Development builds use manual downloads."
        : config.publicKey
          ? ""
          : "This build does not have a release verification key.",
    };
  }
  snapshot = () => ({ ...this.status });
  set(value) {
    this.status = { ...this.status, ...value };
    this.emit("status", this.snapshot());
  }
  save() {
    const value = JSON.parse(JSON.stringify(this.state));
    this.saving = (this.saving ?? Promise.resolve())
      .catch(() => {})
      .then(() => atomicJSON(path.join(this.directory, "state.json"), value));
    return this.saving;
  }
  info(envelope) {
    return verifyManifest(envelope, this.config, this.platform, this.arch);
  }
  filename(info, kind = "asar") {
    return path.join(
      this.directory,
      info[kind].sha256 + path.extname(info[kind].file),
    );
  }
  async valid(envelope) {
    const info = this.info(envelope);
    if (
      info.runtime !== this.runtime ||
      compare(info.version, this.baseline) < 0
    )
      throw Error("Update needs a different runtime");
    await verifyFile(this.filename(info), info.asar);
    return info;
  }
  async boot() {
    if (this.development) return;
    await fsp.mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      this.state = await readSmall(path.join(this.directory, "state.json"));
    } catch {
      this.state = {};
    }
    if (
      !this.state ||
      typeof this.state !== "object" ||
      Array.isArray(this.state)
    )
      this.state = {};
    let rolledBack = false;
    if (this.state.trial) {
      this.state.rejected = this.state.trial;
      this.state.active = this.state.previous;
      this.state.previous = null;
      this.state.pending = null;
      this.state.trial = null;
      rolledBack = true;
    }
    if (this.state.pending) {
      try {
        const info = await this.valid(this.state.pending);
        this.state.previous = this.state.active ?? null;
        this.state.active = this.state.pending;
        this.state.trial = info.asar.sha256;
      } catch {
        this.set({
          message:
            "The staged update could not be loaded; using the installed version.",
        });
      }
      this.state.pending = null;
    }
    let selected;
    for (const candidate of [this.state.active, this.state.previous]) {
      if (!candidate) continue;
      try {
        const info = await this.valid(candidate);
        selected = this.filename(info);
        if (candidate !== this.state.active) {
          this.state.active = candidate;
          this.state.previous = null;
          this.state.trial = null;
          rolledBack = true;
        }
        this.set({ current: info.version });
        break;
      } catch {
        rolledBack = true;
      }
    }
    if (!selected) {
      this.state.active = null;
      this.state.previous = null;
      this.state.trial = null;
    }
    if (rolledBack)
      this.set({
        message:
          "The previous update failed to start or could not be verified. A working version was restored.",
      });
    await this.save();
    await this.cleanup();
    return selected;
  }
  async healthy() {
    if (!this.state.trial) return;
    this.state.trial = null;
    await this.save();
  }
  async cleanup() {
    const keep = new Set();
    for (const envelope of [
      this.state.active,
      this.state.previous,
      this.state.pending,
    ]) {
      try {
        keep.add(path.basename(this.filename(this.info(envelope))));
      } catch {
        /* absent */
      }
    }
    for (const file of await fsp.readdir(this.directory)) {
      if (
        /^[a-f0-9]{64}\.(asar|exe|dmg|AppImage|rpm)(\.part)?$/.test(file) &&
        !keep.has(file)
      )
        await fsp.rm(path.join(this.directory, file), { force: true });
    }
  }
  async operation(task) {
    if (this.running) return this.running;
    this.running = task()
      .catch((error) => {
        this.set({ phase: "error", message: error.message });
        return this.snapshot();
      })
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }
  source(value) {
    if (this.development) return;
    if (!value || typeof value.id !== "string" || value.id.length > 512)
      throw Error("Invalid update source");
    if (value.remove) {
      this.sources.delete(value.id);
      return;
    }
    if (!this.sources.has(value.id) && this.sources.size >= 32)
      throw Error("Too many update sources");
    const origin = new URL(value.origin);
    const url = new URL(value.manifestURL);
    if (
      origin.protocol !== "https:" ||
      origin.origin !== value.origin ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash ||
      !url.pathname.endsWith(".json")
    )
      throw Error("Invalid update manifest address");
    if (
      value.authenticated &&
      (url.origin !== origin.origin ||
        url.pathname !== "/api/v1/client-updates/haunt-updates.json" ||
        typeof value.token !== "string" ||
        value.token.length > 1024 ||
        !/^[\x21-\x7e]+$/.test(value.token))
    )
      throw Error("Update credentials must stay on their server");
    const source = {
      ...this.config,
      id: value.id,
      manifestURL: url.href,
      feedURL: new URL(".", url).href,
      token: value.authenticated ? value.token : undefined,
      local: !!value.authenticated,
      kind: value.kind === "sync" ? "sync" : "community",
    };
    this.sources.set(value.id, source);
  }
  async readManifest(source) {
    const url = new URL(source.manifestURL);
    url.searchParams.set("version", this.status.current);
    url.searchParams.set("target", `${this.platform}-${this.arch}`);
    const stream = await this.getResponse(url.href, source);
    const chunks = [];
    let size = 0;
    const deadline = setTimeout(
      () => stream.destroy(Error("Update check timed out")),
      30_000,
    );
    deadline.unref?.();
    try {
      for await (const chunk of stream) {
        size += chunk.length;
        if (size > MAX_MANIFEST) throw Error("Update manifest is too large");
        chunks.push(chunk);
      }
    } finally {
      clearTimeout(deadline);
      stream.destroy();
    }
    const envelope = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return { envelope, info: this.info(envelope), source };
  }
  check() {
    if (this.development) return Promise.resolve(this.snapshot());
    if (
      !this.config.publicKey ||
      this.status.phase === "ready" ||
      this.status.phase === "installer-ready" ||
      this.status.phase === "installing"
    )
      return Promise.resolve(this.snapshot());
    return this.operation(async () => {
      const sources = [...this.sources.values()];
      if (this.config.feedURL)
        sources.push({
          ...this.config,
          manifestURL: new URL("haunt-updates.json", this.config.feedURL).href,
        });
      if (!sources.length) {
        this.set({
          phase: "idle",
          message: "Connect to a server offering client updates.",
        });
        return this.snapshot();
      }
      this.set({ phase: "checking", message: "", progress: undefined });
      const candidates = [];
      let error;
      // Bounded independent server requests. Failure on one server does not hide
      // an authentic update offered by another server.
      for (let i = 0; i < sources.length; i += 4) {
        const results = await Promise.allSettled(
          sources.slice(i, i + 4).map((s) => this.readManifest(s)),
        );
        for (const result of results) {
          if (result.status === "fulfilled") candidates.push(result.value);
          else error = result.reason;
        }
      }
      const newest = candidates
        .filter((c) => !c.source.id || this.sources.has(c.source.id))
        .sort(
          (a, b) =>
            compare(b.info.version, a.info.version) ||
            Number(b.source.kind === "sync") - Number(a.source.kind === "sync"),
        )[0];
      if (!newest) throw error || Error("Update sources disconnected.");
      const { info } = newest;
      if (
        compare(info.version, this.status.current) <= 0 ||
        info.asar.sha256 === this.state.rejected
      ) {
        this.available = null;
        this.set({
          phase: "current",
          available: undefined,
          kind: undefined,
          message:
            info.asar.sha256 === this.state.rejected
              ? "This release failed to start previously. Waiting for a newer release."
              : "You’re up to date.",
        });
        return this.snapshot();
      }
      this.available = newest;
      this.set({
        phase: info.runtime === this.runtime ? "available" : "runtime-required",
        available: info.version,
        kind: info.runtime === this.runtime ? "asar" : "installer",
        notes: info.notes,
        message:
          info.runtime === this.runtime
            ? ""
            : "This release needs a new desktop runtime.",
      });
      return this.snapshot();
    });
  }
  download() {
    return this.operation(async () => {
      if (
        !this.available ||
        !["available", "runtime-required", "error"].includes(this.status.phase)
      )
        return this.snapshot();
      const { envelope, info, source } = this.available;
      const current = source.id ? this.sources.get(source.id) : source;
      if (!current)
        throw Error("Reconnect to the server offering this update.");
      const kind = info.runtime === this.runtime ? "asar" : "installer";
      const filename = this.filename(info, kind);
      this.set({ phase: "downloading", progress: 0, message: "" });
      const url = current.local
        ? new URL(`${info.version}/${info[kind].file}`, current.feedURL).href
        : releaseURL(
            this.config.repository,
            info.version,
            info[kind].file,
            current.feedURL,
          );
      const stream = await this.getResponse(url, current);
      await download(stream, filename, info[kind], (progress) =>
        this.set({ progress }),
      );
      if (kind === "asar") {
        this.state.pending = envelope;
        await this.save();
      }
      this.downloaded = { filename, envelope, kind };
      this.set({
        phase: kind === "asar" ? "ready" : "installer-ready",
        message: "",
      });
      return this.snapshot();
    });
  }
  async verifyReady() {
    if (!this.downloaded) throw Error("Download an update first");
    const { filename, envelope, kind } = this.downloaded;
    const info = this.info(envelope);
    await verifyFile(filename, info[kind]);
    return { filename, kind, info };
  }
}

// Shared by authenticated server mirrors and an optional standalone feed.
// Focus/reconnect storms are capped at one automatic check per five minutes.
function startUpdatePolling(updater) {
  let lastCheck = -Infinity,
    sourceTimer;
  const checking = (state) => {
    if (state.phase === "checking") lastCheck = Date.now();
  };
  updater.on("status", checking);
  const poll = () => {
    if (Date.now() - lastCheck < 5 * 60_000) return;
    void updater.check();
  };
  const first = setTimeout(poll, 60_000);
  const interval = setInterval(poll, 15 * 60_000);
  first.unref?.();
  interval.unref?.();
  return {
    wake: poll,
    sourceChanged() {
      if (sourceTimer) return;
      sourceTimer = setTimeout(
        () => {
          sourceTimer = undefined;
          poll();
        },
        Math.max(2000, lastCheck + 5 * 60_000 - Date.now()),
      );
      sourceTimer.unref?.();
    },
    stop() {
      clearTimeout(first);
      clearTimeout(sourceTimer);
      clearInterval(interval);
      updater.off("status", checking);
    },
  };
}

// Keep explicit installation testable without starting Electron. A confirmed
// restart may end a call; merely opening a macOS DMG does not interrupt one.
const updateActivityScript = `({
  call: Boolean(document.querySelector('[data-active-call="true"]')),
  upload: Boolean(document.querySelector('[data-update-upload="true"]')),
  draft: Boolean(document.querySelector('[data-update-draft="true"]'))
})`;
function createUpdateInstaller({
  updater,
  readActivity,
  confirm,
  app,
  shell,
  platform = process.platform,
  appImage = process.env.APPIMAGE,
  replaceImage = replaceAppImage,
  macInstaller,
}) {
  let applying = false;
  return async () => {
    if (applying) return;
    applying = true;
    let localMacInstall = false;
    try {
      let release = await updater.verifyReady();
      localMacInstall =
        platform === "darwin" &&
        release.kind === "installer" &&
        (await macInstaller?.configured());
      if (release.kind === "asar" || platform !== "darwin" || localMacInstall) {
        const activity = await readActivity();
        if (activity.call || activity.upload || activity.draft) {
          const detail = [
            activity.call && "Your current voice call will end.",
            activity.upload &&
              "Unfinished uploads or messages being sent will be interrupted.",
            activity.draft && "Unsent text and attachments may be lost.",
          ]
            .filter(Boolean)
            .join(" ");
          if (!(await confirm(detail))) return;
          // Files can change while a confirmation dialog is open.
          release = await updater.verifyReady();
        }
      }
      if (release.kind === "asar") {
        app.relaunch();
        app.quit();
      } else if (localMacInstall) {
        updater.set({
          phase: "installing",
          progress: undefined,
          message: "Opening the downloaded update…",
        });
        const prepared = await macInstaller.prepare(
          release.filename,
          (progress) => updater.set(progress),
        );
        updater.set({
          progress: undefined,
          message:
            "Preparing the replacement. Approve the macOS permission prompt if shown…",
        });
        await macInstaller.finish(prepared);
        updater.set({
          progress: 1,
          message: "Update verified. Restarting Haunt…",
        });
        app.quit();
      } else if (platform === "linux" && appImage) {
        await replaceImage(appImage, release.filename, release.info.installer);
        app.relaunch({ execPath: appImage, args: [] });
        app.quit();
      } else {
        const error = await shell.openPath(release.filename);
        if (error) throw Error(error);
        if (platform === "win32") app.quit();
      }
    } catch (error) {
      updater.set({
        message: error.message,
        ...(localMacInstall
          ? { phase: "installer-ready", progress: undefined }
          : {}),
      });
      throw error;
    } finally {
      applying = false;
    }
  };
}

// AppImages are mounted read-only. Replace the actual launch file on its own
// filesystem, keeping a recovery copy; never try to mutate its mounted ASAR.
async function replaceAppImage(current, downloaded, info) {
  if (!path.isAbsolute(current))
    throw Error("The AppImage launch path is unavailable");
  const stat = await fsp.lstat(current);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw Error("The AppImage must be a regular writable file");
  await verifyFile(downloaded, info);
  const staged = current + ".haunt-next";
  const backup = current + ".haunt-previous";
  await fsp.copyFile(downloaded, staged, fs.constants.COPYFILE_EXCL);
  try {
    await fsp.chmod(staged, stat.mode & 0o777);
    await verifyFile(staged, info);
    const handle = await fsp.open(staged, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fsp.copyFile(current, backup);
    // Linux rename replaces atomically, including when the old image is mounted.
    await fsp.rename(staged, current);
  } finally {
    await fsp.rm(staged, { force: true });
  }
}
module.exports = {
  Updater,
  linuxInstallerFormat,
  verifyManifest,
  verifyFile,
  hashFile,
  atomicJSON,
  download,
  response,
  requestURL,
  releaseURL,
  compare,
  replaceAppImage,
  startUpdatePolling,
  createUpdateInstaller,
  updateActivityScript,
};
