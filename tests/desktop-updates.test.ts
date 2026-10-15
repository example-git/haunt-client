import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { Readable } from "node:stream";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const {
  Updater,
  verifyManifest,
  requestURL,
  replaceAppImage,
  startUpdatePolling,
  createUpdateInstaller,
} = createRequire(import.meta.url)("../apps/desktop/updates.cjs");
const keys = generateKeyPairSync("ed25519");
const config = {
  repository: "example-git/haunt-client",
  publicKey: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
  feedURL: "https://updates.example.test/haunt/",
};
const runtime = "a".repeat(64);
const payload = Buffer.from("test application payload");
const installer = Buffer.from("test installer payload");
const directories: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const dir of directories.splice(0))
    await fs.rm(dir, { recursive: true, force: true });
});
function signed(data: any) {
  const bytes = Buffer.from(JSON.stringify(data));
  return {
    schema: 1,
    payload: bytes.toString("base64"),
    signature: sign(null, bytes, keys.privateKey).toString("base64"),
  };
}
const artifact = (file: string, data: Buffer) => ({
  file,
  size: data.length,
  sha256: createHash("sha256").update(data).digest("hex"),
});
function manifest(
  platform = "win32",
  arch = "x64",
  version = "0.2.0",
  runtimeID = runtime,
  content = payload,
) {
  return signed({
    schema: 1,
    repository: config.repository,
    version,
    notes: "Release notes",
    targets: {
      [`${platform}-${arch}`]: {
        runtime: runtimeID,
        asar: artifact("Haunt.asar", content),
        installer: artifact(
          platform === "win32"
            ? "Haunt.exe"
            : platform === "darwin"
              ? "Haunt.dmg"
              : "Haunt.AppImage",
          installer,
        ),
      },
    },
  });
}
async function fixture(platform = "win32", arch = "x64") {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "haunt updates & ' "),
  );
  directories.push(directory);
  let envelope = manifest(platform, arch),
    bytes = payload;
  const requests: string[] = [];
  const options = {
    directory,
    config,
    runtime,
    version: "0.1.0",
    platform,
    arch,
    getResponse: async (url: string) => {
      requests.push(url);
      return Readable.from([
        new URL(url).pathname.endsWith("haunt-updates.json")
          ? Buffer.from(JSON.stringify(envelope))
          : url.endsWith(".asar")
            ? bytes
            : installer,
      ]);
    },
  };
  const updater = new Updater(options);
  await updater.boot();
  return {
    directory,
    updater,
    requests,
    boot: () => new Updater(options),
    set: (next: any, data = payload) => {
      envelope = next;
      bytes = data;
    },
  };
}
describe("verified desktop archive updates", () => {
  for (const [platform, arch] of [
    ["win32", "x64"],
    ["linux", "x64"],
    ["linux", "arm64"],
    ["darwin", "arm64"],
  ]) {
    it(`${platform}/${arch} activates after restart and survives another restart`, async () => {
      const f = await fixture(platform, arch);
      expect((await f.updater.check()).phase).toBe("available");
      expect((await f.updater.download()).phase).toBe("ready");
      expect(f.updater.snapshot().current).toBe("0.1.0");
      const next = f.boot();
      const archive = await next.boot();
      expect(await fs.readFile(archive)).toEqual(payload);
      expect(next.snapshot().current).toBe("0.2.0");
      await next.healthy();
      const again = f.boot();
      expect(await again.boot()).toBe(archive);
      expect(again.state.trial).toBeNull();
      expect(f.requests.every((url) => url.startsWith(config.feedURL))).toBe(
        true,
      );
    });
  }
  it("rolls back a failed first startup without downloading or losing local user data", async () => {
    const f = await fixture();
    await fs.writeFile(
      path.join(f.directory, "sessions.encrypted"),
      "untouched",
    );
    await f.updater.check();
    await f.updater.download();
    const trial = f.boot();
    expect(await trial.boot()).toBeTruthy();
    const recovered = f.boot();
    expect(await recovered.boot()).toBeUndefined();
    expect(recovered.snapshot().message).toMatch(/restored/);
    expect((await recovered.check()).phase).toBe("current");
    expect(
      await fs.readFile(path.join(f.directory, "sessions.encrypted"), "utf8"),
    ).toBe("untouched");
  });
  it("keeps the last healthy archive for rollback from a later bad release", async () => {
    const f = await fixture();
    await f.updater.check();
    await f.updater.download();
    const first = f.boot();
    const previous = await first.boot();
    await first.healthy();
    const data = Buffer.from("next application");
    f.set(manifest("win32", "x64", "0.3.0", runtime, data), data);
    await first.check();
    await first.download();
    const second = f.boot();
    expect(await second.boot()).not.toBe(previous);
    const rollback = f.boot();
    expect(await rollback.boot()).toBe(previous);
    expect(rollback.snapshot().current).toBe("0.2.0");
  });
  it("rechecks archive bytes on every launch", async () => {
    const f = await fixture();
    await f.updater.check();
    await f.updater.download();
    const candidate = await f.updater.verifyReady();
    await fs.writeFile(candidate.filename, Buffer.alloc(payload.length));
    expect(await f.boot().boot()).toBeUndefined();
  });
  it("rejects altered manifests, foreign keys and repository identities", async () => {
    const envelope = manifest();
    const changed = JSON.parse(
      Buffer.from(envelope.payload, "base64").toString(),
    );
    changed.notes = "tampered";
    expect(() =>
      verifyManifest(
        {
          ...envelope,
          payload: Buffer.from(JSON.stringify(changed)).toString("base64"),
        },
        config,
        "win32",
        "x64",
      ),
    ).toThrow(/signature/);
    const other = generateKeyPairSync("ed25519").publicKey.export({
      type: "spki",
      format: "pem",
    });
    expect(() =>
      verifyManifest(envelope, { ...config, publicKey: other }, "win32", "x64"),
    ).toThrow(/signature/);
    expect(() =>
      verifyManifest(
        envelope,
        { ...config, repository: "someone/else" },
        "win32",
        "x64",
      ),
    ).toThrow(/metadata/);
  });
  it("rejects traversal, malformed sizes, incompatible platform and oversized archives", () => {
    const data = JSON.parse(
      Buffer.from(manifest().payload, "base64").toString(),
    );
    expect(() =>
      verifyManifest(signed(data), config, "linux", "arm64"),
    ).toThrow(/device/);
    for (const file of [
      "../app.asar",
      "a/b.asar",
      "a\\b.asar",
      "https://evil/app.asar",
      "bad.exe",
    ]) {
      const bad = structuredClone(data);
      bad.targets["win32-x64"].asar.file = file;
      expect(() => verifyManifest(signed(bad), config, "win32", "x64")).toThrow(
        /artifact/,
      );
    }
    for (const size of [-1, 0, 1.5, 257 * 1024 * 1024]) {
      const bad = structuredClone(data);
      bad.targets["win32-x64"].asar.size = size;
      expect(() => verifyManifest(signed(bad), config, "win32", "x64")).toThrow(
        /artifact/,
      );
    }
  });
  it("never follows redirects to arbitrary hosts or sends credentials", () => {
    expect(requestURL(config.feedURL + "file", config).hostname).toBe(
      "updates.example.test",
    );
    expect(
      requestURL("https://release-assets.githubusercontent.com/file", config)
        .hostname,
    ).toBe("release-assets.githubusercontent.com");
    for (const url of [
      "http://updates.example.test/haunt/file",
      "https://evil.test/file",
      "https://user:pass@github.com/example-git/haunt-client/releases/file",
      "https://updates.example.test/other/file",
      "https://github.com/other/repo/releases/file",
    ])
      expect(() => requestURL(url, config)).toThrow();
  });
  it("cleans interrupted, short, overlong and hash-mismatched downloads", async () => {
    for (const bytes of [
      payload.subarray(1),
      Buffer.concat([payload, payload]),
      Buffer.alloc(payload.length),
    ]) {
      const f = await fixture();
      f.set(manifest(), bytes);
      await f.updater.check();
      expect((await f.updater.download()).phase).toBe("error");
      expect(
        (await fs.readdir(f.directory)).some(
          (p) => p.endsWith(".asar") || p.endsWith(".part"),
        ),
      ).toBe(false);
      expect(f.updater.state.pending).toBeUndefined();
    }
  });
  it("deduplicates parallel checks and downloads", async () => {
    const f = await fixture();
    await Promise.all([
      f.updater.check(),
      f.updater.check(),
      f.updater.check(),
    ]);
    await Promise.all([
      f.updater.download(),
      f.updater.download(),
      f.updater.download(),
    ]);
    expect(f.requests).toHaveLength(2);
  });
  it("selects the full installer when runtime compatibility changes", async () => {
    const f = await fixture();
    f.set(manifest("win32", "x64", "0.2.0", "b".repeat(64)));
    expect((await f.updater.check()).phase).toBe("runtime-required");
    expect((await f.updater.download()).phase).toBe("installer-ready");
    expect((await f.updater.verifyReady()).kind).toBe("installer");
    expect(f.updater.state.pending).toBeUndefined();
  });
  it("ignores outdated feeds and starts from a newer installed baseline", async () => {
    const f = await fixture();
    f.set(manifest("win32", "x64", "0.0.9"));
    expect((await f.updater.check()).phase).toBe("current");
    f.set(manifest());
    await f.updater.check();
    await f.updater.download();
    const newer = f.boot();
    newer.baseline = "0.3.0";
    newer.status.current = "0.3.0";
    expect(await newer.boot()).toBeUndefined();
  });
  it("fails closed without a key, and tolerates a damaged state file", async () => {
    const f = await fixture();
    await fs.writeFile(path.join(f.directory, "state.json"), "broken");
    expect(await f.boot().boot()).toBeUndefined();
    const disabled = new Updater({
      directory: f.directory,
      runtime,
      version: "0.1.0",
      config: { ...config, publicKey: null },
    });
    expect((await disabled.check()).phase).toBe("disabled");
  });
  it("replaces an AppImage atomically and keeps the previous file", async () => {
    const f = await fixture("linux");
    const current = path.join(f.directory, "Haunt's image & test.AppImage");
    const next = path.join(f.directory, "download.AppImage");
    await fs.writeFile(current, "old image", { mode: 0o755 });
    await fs.writeFile(next, installer);
    await replaceAppImage(current, next, artifact("new.AppImage", installer));
    expect(await fs.readFile(current)).toEqual(installer);
    expect(await fs.readFile(current + ".haunt-previous", "utf8")).toBe(
      "old image",
    );
    if (process.platform !== "win32")
      expect((await fs.stat(current)).mode & 0o777).toBe(0o755);
    await fs.writeFile(next, "damaged");
    await expect(
      replaceAppImage(current, next, artifact("new.AppImage", installer)),
    ).rejects.toThrow();
    expect(await fs.readFile(current)).toEqual(installer);
  });
});

it("uses connected server credentials only for that server's protected mirror", async () => {
  const f = await fixture();
  f.updater.config = { ...config, feedURL: null };
  f.updater.source({
    id: "one",
    origin: "https://chat.example.test",
    manifestURL:
      "https://chat.example.test/api/v1/client-updates/haunt-updates.json",
    authenticated: true,
    token: "test-session",
  });
  expect((await f.updater.check()).phase).toBe("available");
  expect(f.requests[0]).toContain("version=0.1.0&target=win32-x64");
  expect((await f.updater.download()).phase).toBe("ready");
  expect(f.requests[1]).toBe(
    "https://chat.example.test/api/v1/client-updates/0.2.0/Haunt.asar",
  );
  const source = f.updater.sources.get("one");
  expect(source.token).toBe("test-session");
  expect(() => requestURL("https://evil.example.test/steal", source)).toThrow();
  expect(() =>
    requestURL(
      "https://github.com/example-git/haunt-client/releases/download/test",
      source,
    ),
  ).toThrow();
  expect(() =>
    f.updater.source({
      id: "bad",
      origin: "https://chat.example.test",
      manifestURL: "https://evil.example.test/haunt-updates.json",
      authenticated: true,
      token: "test-session",
    }),
  ).toThrow();
  expect(JSON.stringify(f.updater.snapshot())).not.toContain("test-session");
  expect(
    await fs.readFile(path.join(f.directory, "state.json"), "utf8"),
  ).not.toContain("test-session");
});
it("does not attach account credentials to external manifests and removes signed-out sources", async () => {
  const f = await fixture();
  f.updater.config = { ...config, feedURL: null };
  f.updater.source({
    id: "external",
    origin: "https://chat.example.test",
    manifestURL: "https://downloads.example.test/haunt-updates.json",
    authenticated: false,
    token: "secret",
  });
  expect(f.updater.sources.get("external").token).toBeUndefined();
  await f.updater.check();
  f.updater.source({ id: "external", remove: true });
  expect((await f.updater.download()).phase).toBe("error");
  expect(f.requests).toHaveLength(1);
  expect((await f.updater.check()).phase).toBe("idle");
});
it("accepts a valid release from another server when the first is offline", async () => {
  const f = await fixture();
  f.updater.config = { ...config, feedURL: null };
  const get = f.updater.getResponse;
  f.updater.getResponse = (url: string, source: any) =>
    url.includes("offline")
      ? Promise.reject(Error("offline"))
      : get(url, source);
  for (const name of ["offline", "online"])
    f.updater.source({
      id: name,
      origin: `https://${name}.example.test`,
      manifestURL: `https://${name}.example.test/api/v1/client-updates/haunt-updates.json`,
      authenticated: true,
      token: "session",
    });
  expect((await f.updater.check()).phase).toBe("available");
});

describe("automatic update polling", () => {
  it("polls authenticated mirrors on source availability and every 15 minutes, and throttles wake/reconnect storms", async () => {
    const f = await fixture();
    f.updater.config = { ...config, feedURL: null };
    vi.useFakeTimers();
    const polling = startUpdatePolling(f.updater);
    try {
      f.updater.source({
        id: "local",
        origin: "https://chat.example.test",
        manifestURL:
          "https://chat.example.test/api/v1/client-updates/haunt-updates.json",
        authenticated: true,
        token: "session",
      });
      for (let i = 0; i < 20; i++) polling.sourceChanged();
      await vi.advanceTimersByTimeAsync(2000);
      expect(f.requests).toHaveLength(1);
      expect(f.requests[0]).toContain(
        "chat.example.test/api/v1/client-updates/",
      );
      for (let i = 0; i < 20; i++) {
        polling.wake();
        polling.sourceChanged();
      }
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(f.requests).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(f.requests).toHaveLength(3);
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      polling.wake();
      await vi.advanceTimersByTimeAsync(0);
      expect(f.requests).toHaveLength(4);
      f.updater.source({ id: "local", remove: true });
      await vi.advanceTimersByTimeAsync(15 * 60_000);
      expect(f.requests).toHaveLength(4);
    } finally {
      polling.stop();
    }
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("explicit update installation", () => {
  function setup(platform = "win32", kind = "asar") {
    const release = {
      kind,
      filename: "verified-package",
      info: { installer: {} },
    };
    const updater = { verifyReady: vi.fn(async () => release), set: vi.fn() };
    const app = { relaunch: vi.fn(), quit: vi.fn() };
    const shell = { openPath: vi.fn(async () => "") };
    const readActivity = vi.fn(async () => ({
      call: false,
      upload: false,
      draft: false,
    }));
    const confirm = vi.fn(async (_detail: string) => true);
    const replaceImage = vi.fn(async () => {});
    const apply = createUpdateInstaller({
      updater,
      app,
      shell,
      readActivity,
      confirm,
      replaceImage,
      platform,
      appImage: "/home/user/Haunt.AppImage",
    });
    return { apply, updater, app, shell, readActivity, confirm, replaceImage };
  }
  it("restarts an idle client without prompting", async () => {
    const f = setup();
    await f.apply();
    expect(f.confirm).not.toHaveBeenCalled();
    expect(f.updater.verifyReady).toHaveBeenCalledOnce();
    expect(f.app.relaunch).toHaveBeenCalledOnce();
    expect(f.app.quit).toHaveBeenCalledOnce();
  });
  it.each(["call", "upload", "draft"] as const)(
    "allows cancellation then explicit restart with an active %s",
    async (reason) => {
      const f = setup();
      f.readActivity.mockResolvedValue({
        call: false,
        upload: false,
        draft: false,
        [reason]: true,
      });
      f.confirm.mockResolvedValueOnce(false);
      await f.apply();
      expect(f.app.quit).not.toHaveBeenCalled();
      expect(f.updater.set).not.toHaveBeenCalled();
      await f.apply();
      expect(f.confirm).toHaveBeenCalledTimes(2);
      expect(f.confirm.mock.calls[0][0]).toContain(
        reason === "call"
          ? "voice call"
          : reason === "upload"
            ? "Unfinished uploads"
            : "Unsent text",
      );
      expect(f.app.relaunch).toHaveBeenCalledOnce();
      expect(f.app.quit).toHaveBeenCalledOnce();
      expect(f.updater.verifyReady).toHaveBeenCalledTimes(3);
    },
  );
  it("does not install an archive changed while confirmation was open", async () => {
    const f = setup();
    f.readActivity.mockResolvedValue({
      call: true,
      upload: false,
      draft: false,
    });
    f.updater.verifyReady.mockRejectedValueOnce(Error("checksum"));
    await expect(f.apply()).rejects.toThrow("checksum");
    expect(f.confirm).not.toHaveBeenCalled();
    f.confirm.mockImplementation(async () => {
      f.updater.verifyReady.mockRejectedValueOnce(Error("changed"));
      return true;
    });
    await expect(f.apply()).rejects.toThrow("changed");
    expect(f.app.quit).not.toHaveBeenCalled();
  });
  it("coalesces repeated clicks while confirming", async () => {
    const f = setup();
    f.readActivity.mockResolvedValue({
      call: true,
      upload: false,
      draft: false,
    });
    let decide!: (v: boolean) => void;
    f.confirm.mockImplementation(
      () =>
        new Promise((r) => {
          decide = r;
        }),
    );
    const installing = f.apply();
    await vi.waitFor(() => expect(f.confirm).toHaveBeenCalledOnce());
    await f.apply();
    decide(true);
    await installing;
    expect(f.app.quit).toHaveBeenCalledOnce();
  });
  it("opens a macOS DMG without interrupting the call", async () => {
    const f = setup("darwin", "installer");
    await f.apply();
    expect(f.readActivity).not.toHaveBeenCalled();
    expect(f.shell.openPath).toHaveBeenCalledWith("verified-package");
    expect(f.app.quit).not.toHaveBeenCalled();
  });
  it.each(["win32", "linux"])(
    "applies a confirmed %s runtime update",
    async (platform) => {
      const f = setup(platform, "installer");
      f.readActivity.mockResolvedValue({
        call: true,
        upload: false,
        draft: false,
      });
      await f.apply();
      expect(f.confirm).toHaveBeenCalledOnce();
      expect(f.app.quit).toHaveBeenCalledOnce();
      if (platform === "linux") {
        expect(f.replaceImage).toHaveBeenCalledOnce();
        expect(f.app.relaunch).toHaveBeenCalledWith({
          execPath: "/home/user/Haunt.AppImage",
          args: [],
        });
      } else expect(f.shell.openPath).toHaveBeenCalledOnce();
    },
  );
});

it("prefers sync for equal releases, keeps newer community updates, and falls back without sync credentials", async () => {
  const f = await fixture();
  f.updater.config = { ...config, feedURL: null };
  let syncVersion = "0.2.0",
    communityVersion = "0.2.0",
    syncUnavailable = false;
  f.updater.getResponse = async (url: string, source: any) => {
    if (source.kind === "sync") {
      expect(source.token).toBeUndefined();
      if (syncUnavailable) throw Error("sync unavailable");
    }
    return Readable.from([
      Buffer.from(
        JSON.stringify(
          manifest(
            "win32",
            "x64",
            source.kind === "sync" ? syncVersion : communityVersion,
          ),
        ),
      ),
    ]);
  };
  f.updater.source({
    id: "community",
    origin: "https://chat.example.test",
    manifestURL:
      "https://chat.example.test/api/v1/client-updates/haunt-updates.json",
    authenticated: true,
    token: "community-token",
  });
  f.updater.source({
    id: "sync",
    kind: "sync",
    origin: "https://sync.example.test",
    manifestURL: "https://sync.example.test/client-updates/haunt-updates.json",
    token: "must-not-be-used",
  });
  expect((await f.updater.check()).phase).toBe("available");
  expect(f.updater.available.source.id).toBe("sync");
  communityVersion = "0.3.0";
  await f.updater.check();
  expect(f.updater.available.source.id).toBe("community");
  syncUnavailable = true;
  await f.updater.check();
  expect(f.updater.available.source.id).toBe("community");
  f.updater.source({ id: "sync", remove: true });
  expect(f.updater.sources.has("sync")).toBe(false);
});
