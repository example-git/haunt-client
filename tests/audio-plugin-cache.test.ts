import "fake-indexeddb/auto";
import { openDB, deleteDB } from "idb";
import { beforeEach, it, expect, vi } from "vitest";
import fs from "node:fs";
import { createHash } from "node:crypto";
import {
  pluginAsset,
  syncAudioPlugins,
  audioPlugins,
  restoreAudioPlugins,
  ensureAudioPlugins,
} from "../packages/browser/src/audio-plugins/cache";
import { APIError } from "@haunt/core";
import {
  pluginDownloads,
  pluginFileKey,
} from "../packages/browser/src/audio-plugins/progress";
const raw = fs.readFileSync(
  new URL("fixtures/audio-plugin/default.wasm", import.meta.url),
);
const bytes = () =>
  raw.buffer.slice(
    raw.byteOffset,
    raw.byteOffset + raw.byteLength,
  ) as ArrayBuffer;
const manifest = JSON.parse(
  fs.readFileSync(
    new URL("fixtures/audio-plugin/manifest.json", import.meta.url),
    "utf8",
  ),
);
const plugin = {
  manifest,
  digest: "b".repeat(64),
  bytes: raw.length + 1000,
  files: [
    {
      name: "default.wasm",
      bytes: raw.length,
      sha256: createHash("sha256").update(raw).digest("hex"),
    },
  ],
};
beforeEach(async () => {
  await deleteDB("haunt-audio-plugins-v1");
});
const client = () =>
  ({
    account: {
      instance: {
        instance_id: "cache-test",
        capabilities: ["audio.plugins.v1"],
      },
    },
    pluginBytes: vi.fn(async () => bytes()),
    menuRequest: vi.fn(async () => ({ plugins: [plugin] })),
  }) as any;
it("deduplicates first load, survives a fresh client, and repairs a corrupted disk entry", async () => {
  const a = client();
  await Promise.all([syncAudioPlugins(a), syncAudioPlugins(a)]);
  expect(a.pluginBytes).toHaveBeenCalledTimes(1);
  const b = client();
  await syncAudioPlugins(b);
  expect(b.pluginBytes).not.toHaveBeenCalled();
  const db = await openDB("haunt-audio-plugins-v1", 2);
  await db.put(
    "assets",
    { bytes: new Uint8Array(10).buffer, used: 0 },
    plugin.files[0].sha256,
  );
  db.close();
  await pluginAsset(b, plugin, "default.wasm");
  expect(b.pluginBytes).toHaveBeenCalledTimes(1);
});
it("rejects corrupted downloads and does not cache them for later execution", async () => {
  const a = client();
  a.pluginBytes = vi.fn(async () => new Uint8Array(raw.length).buffer);
  await expect(pluginAsset(a, plugin, "default.wasm")).rejects.toThrow(
    "checksum",
  );
  const db = await openDB("haunt-audio-plugins-v1", 2);
  expect(await db.count("assets")).toBe(0);
  db.close();
  a.pluginBytes = vi.fn(async () => bytes());
  await pluginAsset(a, plugin, "default.wasm");
  expect(a.pluginBytes).toHaveBeenCalledTimes(1);
});
it("restores selected files before network refresh and retains a valid catalog through server restarts", async () => {
  await syncAudioPlugins(client());
  const b = client();
  b.menuRequest = vi.fn(async () => {
    throw new APIError(503, "instance_unavailable");
  });
  await restoreAudioPlugins(b);
  expect(b.menuRequest).not.toHaveBeenCalled();
  expect(b.pluginBytes).not.toHaveBeenCalled();
  expect(
    pluginDownloads(b).getSnapshot().files[
      pluginFileKey(plugin, "default.wasm")
    ].phase,
  ).toBe("ready");
  await ensureAudioPlugins(b);
  expect(b.menuRequest).not.toHaveBeenCalled();
  expect(await syncAudioPlugins(b)).toHaveLength(1);
  expect(b.pluginBytes).not.toHaveBeenCalled();
  const c = client();
  await restoreAudioPlugins(c);
  expect(audioPlugins(c)).toHaveLength(1);
  expect(c.menuRequest).not.toHaveBeenCalled();
});
it("does not start a network download while restoring an evicted cached model", async () => {
  await syncAudioPlugins(client());
  const db = await openDB("haunt-audio-plugins-v1", 2);
  await db.clear("assets");
  db.close();
  const b = client();
  await restoreAudioPlugins(b);
  expect(b.pluginBytes).not.toHaveBeenCalled();
  expect(
    pluginDownloads(b).getSnapshot().files[
      pluginFileKey(plugin, "default.wasm")
    ].phase,
  ).toBe("queued");
  await pluginAsset(b, plugin, "default.wasm");
  expect(b.pluginBytes).toHaveBeenCalledOnce();
});

it("clears revoked or malformed catalogs rather than treating them as an offline connection", async () => {
  const a = client();
  await syncAudioPlugins(a);
  a.menuRequest = vi.fn(async () => {
    throw new TypeError("offline");
  });
  expect(await syncAudioPlugins(a)).toHaveLength(1);
  a.menuRequest = vi.fn(async () => ({
    plugins: [{ ...plugin, manifest: { ...manifest, variants: [null] } }],
  }));
  await expect(syncAudioPlugins(a)).rejects.toThrow();
  expect(audioPlugins(a)).toEqual([]);
  a.menuRequest = vi.fn(async () => {
    throw new TypeError("offline");
  });
  await expect(syncAudioPlugins(a)).rejects.toThrow("offline");
  a.menuRequest = vi.fn(async () => ({ plugins: [plugin] }));
  await syncAudioPlugins(a);
  a.menuRequest = vi.fn(async () => {
    throw new Error("session_expired");
  });
  await expect(syncAudioPlugins(a)).rejects.toThrow("session_expired");
  expect(audioPlugins(a)).toEqual([]);
});

it("reports download, verification, failure and readiness without broadcasting chunks to other servers", async () => {
  const { pluginDownloads, pluginFileKey } =
    await import("../packages/browser/src/audio-plugins/progress");
  const a = client(),
    b = client();
  const phases: string[] = [];
  const off = pluginDownloads(a).subscribe(() => {
    const file =
      pluginDownloads(a).getSnapshot().files[
        pluginFileKey(plugin, "default.wasm")
      ];
    if (file) phases.push(file.phase);
  });
  const other = vi.fn();
  const offOther = pluginDownloads(b).subscribe(other);
  a.pluginBytes = vi.fn(async (_path, total, _upload, progress) => {
    progress(0, total);
    progress(Math.floor(total / 2), total);
    progress(total, total);
    return bytes();
  });
  await syncAudioPlugins(a);
  expect(phases).toContain("downloading");
  expect(phases).toContain("verifying");
  expect(phases.at(-1)).toBe("ready");
  expect(other).not.toHaveBeenCalled();
  off();
  offOther();
});
