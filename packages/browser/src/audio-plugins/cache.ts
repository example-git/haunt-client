import { pluginDownloads } from "./progress";
import { getPreferences, setPreferences } from "../preferences";
import { normalizePluginPreferences, type PluginPreferences } from "./contract";
import { openDB } from "idb";
import { APIError, type InstanceClient } from "@haunt/core";
import {
  validatePlugin,
  validateWasmResources,
  type AudioPlugin,
} from "./contract";
const BUDGET = 256 * 1024 * 1024;
const dbOpen = () =>
  openDB("haunt-audio-plugins-v1", 2, {
    upgrade(db) {
      // Version 1 existed only during development. Cached models can be
      // downloaded again; never scan every model buffer during an upgrade.
      if (db.objectStoreNames.contains("assets"))
        db.deleteObjectStore("assets");
      db.createObjectStore("assets");
      db.createObjectStore("assetInfo");
      if (!db.objectStoreNames.contains("catalogs"))
        db.createObjectStore("catalogs");
    },
  });
const pending = new WeakMap<
  InstanceClient,
  Map<string, Promise<ArrayBuffer>>
>();
const defaults = new WeakMap<InstanceClient, PluginPreferences>();
export const serverAudioDefault = (client: InstanceClient) =>
  defaults.get(client);
function adoptDefault(
  client: InstanceClient,
  plugins: AudioPlugin[],
  raw: unknown,
) {
  const value = raw as Partial<PluginPreferences> | undefined;
  const plugin = plugins.find((p) => p.manifest.id === value?.id);
  if (!plugin) {
    defaults.delete(client);
    return;
  }
  const options = normalizePluginPreferences(plugin, value);
  defaults.set(client, options);
  const prefs = getPreferences(),
    key = client.account.instance.instance_id;
  if (!prefs.audioPlugins[key]?.selected)
    setPreferences({
      audioPlugins: {
        ...prefs.audioPlugins,
        [key]: {
          selected: options.id,
          plugins: {
            ...prefs.audioPlugins[key]?.plugins,
            [options.id]: options,
          },
        },
      },
    });
}
const catalogs = new WeakMap<InstanceClient, AudioPlugin[]>();
const syncing = new WeakMap<InstanceClient, Promise<AudioPlugin[]>>();
const restoring = new WeakMap<InstanceClient, Promise<void>>();
class CacheMiss extends Error {}
const transient = (error: unknown) =>
  error instanceof TypeError ||
  (error instanceof DOMException &&
    ["NetworkError", "TimeoutError", "AbortError"].includes(error.name)) ||
  (error instanceof APIError &&
    (error.status >= 500 || [408, 425, 429].includes(error.status)));
function catalog(raw: unknown): AudioPlugin[] {
  if (!Array.isArray(raw) || raw.length > 4)
    throw Error("Invalid audio plugin catalog");
  const plugins = raw.map(validatePlugin);
  if (new Set(plugins.map((p) => p.manifest.id)).size !== plugins.length)
    throw Error("Duplicate audio plugin IDs");
  return plugins;
}
const listeners = new Set<() => void>();
let revision = 0;
export const pluginRevision = () => revision;
export const subscribePlugins = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export const audioPlugins = (client: InstanceClient) =>
  catalogs.get(client) ?? [];
function publish(client: InstanceClient, plugins: AudioPlugin[]) {
  catalogs.set(client, plugins);
  revision++;
  listeners.forEach((fn) => fn());
}
async function hash(b: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    // Plain HTTP clients can download plugins without exposing Web Crypto.
    // Verify the same SHA-256 digest before caching or executing their bytes.
    const { sha256 } = await import("hash-wasm");
    return sha256(new Uint8Array(b));
  }
  return [...new Uint8Array(await subtle.digest("SHA-256", b))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
export async function pluginAsset(
  client: InstanceClient,
  plugin: AudioPlugin,
  name: string,
  cacheOnly = false,
): Promise<ArrayBuffer> {
  const file = plugin.files.find((f) => f.name === name);
  if (!file) throw Error("Missing plugin file");
  const key = JSON.stringify([
    client.account.instance.instance_id,
    file.sha256,
    cacheOnly,
  ]);
  let requests = pending.get(client);
  if (!requests) {
    requests = new Map();
    pending.set(client, requests);
  }
  const running = requests.get(key);
  if (running) return running;
  const progress = pluginDownloads(client);
  progress.file(plugin, name, "checking");
  const promise = (async () => {
    const db = await dbOpen();
    try {
      const cached = await db.get("assets", file.sha256);
      if (
        cached?.bytes instanceof ArrayBuffer &&
        cached.bytes.byteLength === file.bytes &&
        (await hash(cached.bytes)) === file.sha256
      ) {
        validateWasmResources(cached.bytes);
        await db.put(
          "assetInfo",
          { size: file.bytes, used: Date.now() },
          file.sha256,
        );
        progress.file(plugin, name, "ready", file.bytes);
        return cached.bytes;
      }
      if (cached) {
        const tx = db.transaction(["assets", "assetInfo"], "readwrite");
        await tx.objectStore("assets").delete(file.sha256);
        await tx.objectStore("assetInfo").delete(file.sha256);
        await tx.done;
      }
      if (cacheOnly) throw new CacheMiss();
      const bytes = await client.pluginBytes(
        `/api/v1/audio-plugins/${plugin.digest}/files/${name}`,
        file.bytes,
        undefined,
        (received) => progress.file(plugin, name, "downloading", received),
      );
      progress.file(plugin, name, "verifying", bytes.byteLength);
      if ((await hash(bytes)) !== file.sha256)
        throw Error("Audio plugin checksum mismatch");
      validateWasmResources(bytes);
      // One short IDB transaction for eviction/insertion; network and hashing
      // happen outside it. Shared hashes deduplicate packages across servers.
      const tx = db.transaction(["assets", "assetInfo"], "readwrite");
      const info = tx.objectStore("assetInfo"),
        assets = tx.objectStore("assets");
      const entries: { key: IDBValidKey; size: number; used: number }[] = [];
      let used = 0;
      let cursor = await info.openCursor();
      while (cursor) {
        // A different server may have finished downloading this same hash.
        // Replacing it must not charge its size twice against the budget.
        if (cursor.key !== file.sha256) {
          const size = cursor.value.size;
          used += size;
          entries.push({ key: cursor.key, size, used: cursor.value.used });
        }
        cursor = await cursor.continue();
      }
      entries.sort((a, b) => a.used - b.used);
      for (const entry of entries) {
        if (used + bytes.byteLength <= BUDGET) break;
        await assets.delete(entry.key);
        await info.delete(entry.key);
        used -= entry.size;
      }
      await assets.put({ bytes }, file.sha256);
      await info.put({ size: bytes.byteLength, used: Date.now() }, file.sha256);
      await tx.done;
      progress.file(plugin, name, "ready", file.bytes);
      return bytes;
    } finally {
      db.close();
    }
  })()
    .catch((error) => {
      if (error instanceof CacheMiss) {
        progress.file(plugin, name, "queued");
        throw error;
      }
      progress.file(
        plugin,
        name,
        "error",
        0,
        error instanceof Error ? error.message : "Model download failed.",
      );
      throw error;
    })
    .finally(() => requests!.delete(key));
  requests.set(key, promise);
  return promise;
}
/** Local-only bootstrap: restore the validated catalog and selected cached model. */
export async function restoreAudioPlugins(
  client: InstanceClient,
): Promise<void> {
  const existing = restoring.get(client);
  if (existing) return existing;
  if (catalogs.has(client)) return;
  const task = (async () => {
    const db = await dbOpen();
    let plugins: AudioPlugin[];
    try {
      const saved = await db.get(
        "catalogs",
        client.account.instance.instance_id,
      );
      if (!saved) return;
      try {
        plugins = catalog(Array.isArray(saved) ? saved : saved.plugins);
        if (!Array.isArray(saved)) adoptDefault(client, plugins, saved.default);
      } catch {
        await db.delete("catalogs", client.account.instance.instance_id);
        return;
      }
    } finally {
      db.close();
    }
    if (catalogs.has(client)) return;
    publish(client, plugins);
    pluginDownloads(client).catalog("ready", plugins);
    const prefs =
      getPreferences().audioPlugins[client.account.instance.instance_id];
    const selected =
      plugins.find((p) => p.manifest.id === prefs?.selected) ?? plugins[0];
    if (selected) {
      const options = normalizePluginPreferences(
        selected,
        prefs?.plugins[selected.manifest.id],
      );
      const variant = selected.manifest.variants.find(
        (v) => v.id === options.variant,
      )!;
      await pluginAsset(client, selected, variant.file, true).catch(() => {});
    }
  })().finally(() => restoring.delete(client));
  restoring.set(client, task);
  return task;
}
export async function ensureAudioPlugins(client: InstanceClient) {
  await restoreAudioPlugins(client);
  if (pluginDownloads(client).getSnapshot().catalog === "ready")
    return audioPlugins(client);
  return syncAudioPlugins(client, false);
}
export async function syncAudioPlugins(
  client: InstanceClient,
  prefetch = true,
): Promise<AudioPlugin[]> {
  const running = syncing.get(client);
  const promise =
    running ??
    (async () => {
      await restoreAudioPlugins(client).catch(() => {});
      const progress = pluginDownloads(client);
      if (!catalogs.has(client)) progress.catalog("loading");
      if (!client.account.instance.capabilities?.includes("audio.plugins.v1")) {
        publish(client, []);
        progress.catalog("ready", []);
        return [];
      }
      const db = await dbOpen(),
        key = client.account.instance.instance_id;
      let plugins: AudioPlugin[];
      let temporaryFailure = false;
      try {
        let raw: { plugins?: unknown; default?: unknown } | null;
        try {
          raw = (await client.menuRequest(
            "/api/v1/audio-plugins",
          )) as typeof raw;
        } catch (error) {
          // Catch transport failures separately from validation. A malformed
          // manifest must never be mistaken for an offline network TypeError.
          temporaryFailure = transient(error);
          if (!temporaryFailure) throw error;
          const cached = await db.get("catalogs", key);
          if (!cached) throw error;
          raw = Array.isArray(cached) ? { plugins: cached } : cached;
        }
        temporaryFailure = false;
        plugins = catalog(raw?.plugins);
        adoptDefault(client, plugins, raw?.default);
        await db.put(
          "catalogs",
          { plugins, default: defaults.get(client) },
          key,
        );
      } catch (error) {
        publish(client, []);
        progress.catalog(
          "error",
          [],
          "Could not load server audio plugins. Check your connection and retry.",
        );
        if (!temporaryFailure) await db.delete("catalogs", key);
        throw error;
      } finally {
        db.close();
      }
      publish(client, plugins);
      progress.catalog("ready", plugins);
      return plugins;
    })()
      .catch((error) => {
        pluginDownloads(client).catalog(
          "error",
          undefined,
          "Could not load server audio plugins. Check your connection and retry.",
        );
        throw error;
      })
      .finally(() => syncing.delete(client));
  if (!running) syncing.set(client, promise);
  const plugins = await promise;
  if (prefetch) {
    let failed: unknown;
    const saved =
      getPreferences().audioPlugins[client.account.instance.instance_id];
    const ordered = [...plugins].sort(
      (a, b) =>
        Number(b.manifest.id === saved?.selected) -
        Number(a.manifest.id === saved?.selected),
    );
    for (const plugin of ordered) {
      const variant =
        saved?.plugins[plugin.manifest.id]?.variant ??
        plugin.manifest.default_variant;
      const selected = plugin.manifest.variants.find(
        (v) => v.id === variant,
      )?.file;
      const files = [...plugin.files].sort(
        (a, b) => Number(b.name === selected) - Number(a.name === selected),
      );
      for (const file of files) {
        try {
          await pluginAsset(client, plugin, file.name);
        } catch (error) {
          failed ??= error;
        }
      }
    }
    if (failed) throw failed;
  }
  return plugins;
}
