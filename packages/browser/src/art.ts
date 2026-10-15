import type { InstanceClient } from "@haunt/core";
import { cachedMedia, mediaKey } from "./media-cache";
export type Art = "avatar" | "icon" | "banner" | "emoji";
type Entry = {
  listeners: Set<(url: string) => void>;
  controller: AbortController;
  timer?: ReturnType<typeof setTimeout>;
  running: boolean;
  attempts: number;
  url?: string;
  start: () => void;
};
class ArtPool {
  private entries = new Map<string, Entry>();
  private unsubscribe?: () => void;
  constructor(private instance: InstanceClient) {}
  acquire(
    kind: Art,
    version: string,
    id: string | undefined,
    listener: (url: string) => void,
  ) {
    const instance = this.instance;
    if (!this.unsubscribe) {
      let previous = instance.snapshot.status;
      this.unsubscribe = instance.subscribe(() => {
        const status = instance.snapshot.status;
        if (status === "online" && previous !== status)
          for (const entry of this.entries.values()) {
            clearTimeout(entry.timer);
            entry.attempts = 0;
            entry.start();
          }
        previous = status;
      });
    }
    const key = mediaKey(instance, "art", kind, id ?? "", version);
    let entry = this.entries.get(key);
    if (!entry) {
      const current: Entry = {
        listeners: new Set(),
        controller: new AbortController(),
        running: false,
        attempts: 0,
        start: () => {
          if (
            current.running ||
            current.url ||
            current.controller.signal.aborted
          )
            return;
          current.running = true;
          void cachedMedia(
            key,
            (signal) => {
              if (
                instance.snapshot.status === "offline" ||
                instance.snapshot.status === "signed-out"
              )
                throw Error("Server offline");
              return instance.art(kind, id, signal);
            },
            current.controller.signal,
          )
            .then((blob) => {
              if (current.controller.signal.aborted) return;
              current.url = URL.createObjectURL(blob);
              for (const update of current.listeners) update(current.url);
            })
            .catch(() => {
              if (!current.controller.signal.aborted)
                current.timer = setTimeout(
                  current.start,
                  Math.min(30_000, 1000 * 2 ** Math.min(current.attempts++, 5)),
                );
            })
            .finally(() => {
              current.running = false;
            });
        },
      };
      entry = current;
      this.entries.set(key, entry);
    }
    entry.listeners.add(listener);
    if (entry.url) listener(entry.url);
    else entry.start();
    return () => {
      entry.listeners.delete(listener);
      if (!entry.listeners.size) {
        entry.controller.abort();
        clearTimeout(entry.timer);
        if (entry.url) URL.revokeObjectURL(entry.url);
        if (this.entries.get(key) === entry) this.entries.delete(key);
      }
      if (!this.entries.size) {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
      }
    };
  }
}
const pools = new WeakMap<InstanceClient, ArtPool>();
export function subscribeArt(
  instance: InstanceClient,
  kind: Art,
  version: string,
  id: string | undefined,
  listener: (url: string) => void,
) {
  let pool = pools.get(instance);
  if (!pool) {
    pool = new ArtPool(instance);
    pools.set(instance, pool);
  }
  return pool.acquire(kind, version, id, listener);
}
