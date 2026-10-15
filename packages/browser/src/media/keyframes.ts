import { isAudioPurpose } from "@haunt/core";
import type { Purpose } from "@haunt/core";
/** Bound recovery traffic to the relay's two controls/second allowance. */
export class KeyframeRequests {
  private queue = new Map<string, { publisher: string; purpose: Purpose }>();
  private last = new Map<string, number>();
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;
  constructor(private send: (publisher: string, purpose: Purpose) => void) {}
  request(publisher: string, purpose: Purpose) {
    if (this.closed || isAudioPurpose(purpose)) return;
    const key = `${publisher}:${purpose}`;
    if (Date.now() - (this.last.get(key) ?? 0) < 1100 || this.queue.size >= 64)
      return;
    this.queue.set(key, { publisher, purpose });
    this.schedule();
  }
  private schedule() {
    if (this.timer || !this.queue.size || this.closed) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const item = this.queue.entries().next().value;
      if (!item) return;
      const [key, request] = item;
      this.queue.delete(key);
      this.last.set(key, Date.now());
      this.send(request.publisher, request.purpose);
      this.schedule();
    }, 550);
  }
  satisfied(publisher: string, purpose: Purpose) {
    this.queue.delete(`${publisher}:${purpose}`);
  }
  remove(publisher: string) {
    for (const key of this.queue.keys())
      if (key.startsWith(`${publisher}:`)) this.queue.delete(key);
    for (const key of this.last.keys())
      if (key.startsWith(`${publisher}:`)) this.last.delete(key);
  }
  close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.queue.clear();
    this.last.clear();
  }
}
