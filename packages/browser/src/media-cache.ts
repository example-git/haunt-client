import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { InstanceClient } from "@haunt/core";
import { mediaTask } from "./media-queue";

export const maxCacheItem = 20 * 1024 * 1024;
export const cacheable = (blob: Blob) =>
  blob.size > 0 &&
  blob.size <= maxCacheItem &&
  /^(image\/(png|jpeg|gif|webp|avif)|application\/json)$/.test(blob.type);
export interface MediaStore {
  get(key: string): Promise<Blob | undefined>;
  put(key: string, blob: Blob): Promise<void>;
}
interface MediaDB extends DBSchema {
  entries: {
    key: string;
    value: { key: string; bytes: number; touched: number };
    indexes: { touched: number };
  };
  blobs: { key: string; value: Blob };
  totals: { key: string; value: { bytes: number; count: number } };
}
/** Binary sidecar to the local message archive; no base64/localStorage images. */
export class BrowserMediaStore implements MediaStore {
  private db?: Promise<IDBPDatabase<MediaDB>>;
  constructor(
    private name = "haunt-media-cache-v1",
    private budget = 256 * 1024 * 1024,
    private limit = 4096,
  ) {}
  private open() {
    return (this.db ??= openDB<MediaDB>(this.name, 1, {
      upgrade(db) {
        db.createObjectStore("entries", { keyPath: "key" }).createIndex(
          "touched",
          "touched",
        );
        db.createObjectStore("blobs");
        db.createObjectStore("totals");
      },
    }));
  }
  async get(key: string) {
    const tx = (await this.open()).transaction(
      ["entries", "blobs"],
      "readwrite",
    );
    const entry = await tx.objectStore("entries").get(key);
    const blob = entry ? await tx.objectStore("blobs").get(key) : undefined;
    if (entry && blob && cacheable(blob)) {
      entry.touched = Date.now();
      await tx.objectStore("entries").put(entry);
    }
    await tx.done;
    return blob && cacheable(blob) ? blob : undefined;
  }
  async put(key: string, blob: Blob) {
    if (!cacheable(blob) || blob.size > this.budget) return;
    const tx = (await this.open()).transaction(
      ["entries", "blobs", "totals"],
      "readwrite",
    );
    // Observe aborts even if a quota error rejects an earlier request.
    void tx.done.catch(() => {});
    const entries = tx.objectStore("entries"),
      blobs = tx.objectStore("blobs");
    const old = await entries.get(key);
    const totals = (await tx.objectStore("totals").get("usage")) ?? {
      bytes: 0,
      count: 0,
    };
    totals.bytes += blob.size - (old?.bytes ?? 0);
    totals.count += old ? 0 : 1;
    await blobs.put(blob, key);
    await entries.put({ key, bytes: blob.size, touched: Date.now() });
    let cursor = await entries.index("touched").openCursor();
    while (
      cursor &&
      (totals.bytes > this.budget || totals.count > this.limit)
    ) {
      totals.bytes -= cursor.value.bytes;
      totals.count--;
      await blobs.delete(cursor.value.key);
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.objectStore("totals").put(totals, "usage");
    await tx.done;
  }
  async close() {
    (await this.open()).close();
  }
}

class DesktopMediaStore implements MediaStore {
  async get(key: string) {
    const value = await window.hauntDesktop!.mediaCacheRead(key);
    return value
      ? new Blob([new Uint8Array(value.data)], { type: value.type })
      : undefined;
  }
  async put(key: string, blob: Blob) {
    if (!cacheable(blob)) return;
    await window.hauntDesktop!.mediaCacheWrite(key, {
      type: blob.type,
      data: new Uint8Array(await blob.arrayBuffer()),
    });
  }
}

type Pending = {
  promise: Promise<Blob>;
  controller: AbortController;
  refs: number;
};
/** Share concurrent reads/downloads, never retain rejected promises. */
export class MediaCache {
  private pending = new Map<string, Pending>();
  constructor(private store: MediaStore) {}
  load(
    key: string,
    download: (signal: AbortSignal) => Promise<Blob>,
    signal: AbortSignal,
  ): Promise<Blob> {
    if (signal.aborted) return Promise.reject(signal.reason);
    let entry = this.pending.get(key);
    if (!entry) {
      const controller = new AbortController();
      const created: Pending = {
        refs: 0,
        controller,
        promise: Promise.resolve(new Blob()),
      };
      created.promise = (async () => {
        const saved = await this.store.get(key).catch(() => undefined);
        controller.signal.throwIfAborted();
        if (saved) return saved;
        return mediaTask(async () => {
          const blob = await download(controller.signal);
          controller.signal.throwIfAborted();
          // Keep writes inside the four-work-item bound too: large GIFs must
          // not accumulate behind a slow disk while more downloads start.
          if (cacheable(blob)) await this.store.put(key, blob).catch(() => {});
          return blob;
        }, controller.signal);
      })().finally(() => {
        if (this.pending.get(key) === created) this.pending.delete(key);
      });
      entry = created;
      this.pending.set(key, entry);
    }
    entry.refs++;
    const shared = entry;
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = () => {
        if (finished) return false;
        finished = true;
        signal.removeEventListener("abort", abort);
        if (--shared.refs === 0) {
          shared.controller.abort();
          if (this.pending.get(key) === shared) this.pending.delete(key);
        }
        return true;
      };
      const abort = () => {
        if (finish()) reject(signal.reason);
      };
      signal.addEventListener("abort", abort, { once: true });
      shared.promise.then(
        (blob) => {
          if (finish()) resolve(blob);
        },
        (error) => {
          if (finish()) reject(error);
        },
      );
    });
  }
}
let shared: MediaCache | undefined;
let diskStore: BrowserMediaStore | DesktopMediaStore | undefined;
const mediaStore = () =>
  (diskStore ??= window.hauntDesktop?.mediaCacheRead
    ? new DesktopMediaStore()
    : new BrowserMediaStore());
export function cachedMedia(
  key: string,
  download: (signal: AbortSignal) => Promise<Blob>,
  signal: AbortSignal,
) {
  shared ??= new MediaCache(mediaStore());
  return shared.load(key, download, signal);
}
export const mediaKey = (
  instance: InstanceClient,
  ...parts: (string | number)[]
) => JSON.stringify([instance.origin, instance.scope, ...parts]);

/** Finite retry for visible message media; aborts promptly when it leaves view. */
export async function retryMedia<T>(
  job: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try {
      return await job();
    } catch (error) {
      if (signal.aborted || attempt >= 3) throw error;
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(signal.reason);
        };
        const timer = setTimeout(
          () => {
            signal.removeEventListener("abort", abort);
            resolve();
          },
          500 * 2 ** attempt,
        );
        signal.addEventListener("abort", abort, { once: true });
      });
    }
  }
}

/** Read an already cached asset without issuing a network request. */
export async function localMedia(key: string): Promise<Blob | undefined> {
  const store = mediaStore();
  return store.get(key).catch(() => undefined);
}
