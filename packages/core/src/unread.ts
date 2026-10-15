import type { ReadState } from "./types.js";
/** Attention counts are direct messages and explicit mentions; other unread
 * messages get a dot. These counters are independent of sound preferences. */
export function unreadSummary(states: Record<string, ReadState>) {
  let count = 0,
    unread = false;
  for (const state of Object.values(states)) {
    unread ||= state.unread_count > 0;
    count += state.kind === "dm" ? state.unread_count : state.mention_count;
  }
  return { count: Math.min(count, 999999), unread };
}
