type Entry = {
  refs: number;
  running: boolean;
  done: boolean;
  bytes: number;
  url?: string;
  load: () => Promise<Blob>;
  listeners: Set<(url: string) => void>;
};

/** Picker-scoped cache: four downloads, visible demand only, bounded idle LRU. */
export class EmojiArtPool {
  private entries = new Map<string, Entry>();
  private active = 0;
  private closed = false;
  constructor(private idleBudget = 8 * 1024 * 1024) {}
  acquire(
    key: string,
    load: () => Promise<Blob>,
    listener: (url: string) => void,
  ) {
    if (this.closed) return () => {};
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        refs: 0,
        running: false,
        done: false,
        bytes: 0,
        load,
        listeners: new Set(),
      };
      this.entries.set(key, entry);
    }
    entry.refs++;
    entry.listeners.add(listener);
    if (entry.url) listener(entry.url);
    this.pump();
    return () => {
      entry.refs--;
      entry.listeners.delete(listener);
      // Move the released entry to the most recently used end.
      if (this.entries.get(key) === entry) {
        this.entries.delete(key);
        this.entries.set(key, entry);
      }
      this.trim();
    };
  }
  dispose() {
    this.closed = true;
    for (const entry of this.entries.values()) {
      if (entry.url) URL.revokeObjectURL(entry.url);
      entry.listeners.clear();
    }
    this.entries.clear();
  }
  private trim() {
    let idle = 0,
      count = 0;
    for (const entry of this.entries.values())
      if (!entry.refs) {
        idle += entry.bytes;
        count++;
      }
    for (const [key, entry] of this.entries) {
      if (entry.refs || entry.running) continue;
      if (!entry.done || idle > this.idleBudget || count > 64) {
        if (entry.url) URL.revokeObjectURL(entry.url);
        this.entries.delete(key);
        idle -= entry.bytes;
        count--;
      }
    }
  }
  private pump() {
    if (this.closed) return;
    for (const entry of this.entries.values()) {
      if (this.active >= 4) break;
      if (!entry.refs || entry.running || entry.done) continue;
      this.active++;
      entry.running = true;
      void Promise.resolve()
        .then(entry.load)
        .then((blob) => {
          if (this.closed) return;
          entry.bytes = blob.size;
          entry.url = URL.createObjectURL(blob);
          for (const listener of entry.listeners) listener(entry.url);
        })
        .catch(() => {})
        .finally(() => {
          entry.done = true;
          entry.running = false;
          this.active--;
          this.trim();
          this.pump();
        });
    }
  }
}
