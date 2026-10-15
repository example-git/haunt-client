import { cachedMessage } from "./message-content.js";
import type {
  Message,
  MessageStore,
  PendingMessage,
  SavedAccount,
  Scope,
  TokenVault,
} from "./types.js";
/** Useful on native platforms during bring-up and in tests. Not durable storage. */
export class MemoryStore implements MessageStore {
  private rows = new Map<Scope, Map<string, Message>>();
  private cursors = new Map<Scope, number>();
  private outbox = new Map<Scope, Map<string, PendingMessage>>();
  async messages(
    scope: Scope,
    conversation: string,
    options: { before?: number; limit?: number } = {},
  ) {
    return [...(this.rows.get(scope)?.values() ?? [])]
      .filter(
        (m) =>
          m.conversation_id === conversation &&
          m.seq < (options.before ?? Number.MAX_SAFE_INTEGER),
      )
      .sort((a, b) => a.seq - b.seq)
      .slice(-Math.max(1, Math.min(10_000, options.limit ?? 200)))
      .map(cachedMessage);
  }
  async merge(scope: Scope, messages: Message[]) {
    const rows = this.rows.get(scope) ?? new Map();
    for (const raw of messages) {
      const message = cachedMessage(raw);
      const old = rows.get(message.id);
      if (shouldMerge(old, message))
        rows.set(message.id, structuredClone(message));
    }
    this.rows.set(scope, rows);
  }
  async cursor(scope: Scope) {
    return this.cursors.get(scope) ?? 0;
  }
  async setCursor(scope: Scope, cursor: number) {
    this.cursors.set(scope, cursor);
  }
  async pending(scope: Scope) {
    return [...(this.outbox.get(scope)?.values() ?? [])];
  }
  async putPending(scope: Scope, message: PendingMessage) {
    const rows = this.outbox.get(scope) ?? new Map();
    rows.set(message.request_id, structuredClone(message));
    this.outbox.set(scope, rows);
  }
  async removePending(scope: Scope, id: string) {
    this.outbox.get(scope)?.delete(id);
  }
  async clear(scope: Scope) {
    this.rows.delete(scope);
    this.cursors.delete(scope);
    this.outbox.delete(scope);
  }
}
export function shouldMerge(old: Message | undefined, next: Message): boolean {
  if (!old) return true;
  if (old.deleted && !next.deleted) return false;
  if (next.deleted) return true;
  const before = Date.parse(old.edited_at || old.created_at);
  const after = Date.parse(next.edited_at || next.created_at);
  if (after !== before) return after > before;
  const previous = cachedMessage(old),
    incoming = cachedMessage(next);
  // An equal server revision can have a newer local presentation. A replay,
  // older tab or failed decrypt must not replace text already decoded here.
  if ((old.displayVersion ?? 0) > (next.displayVersion ?? 0)) return false;
  if (previous.security === "encrypted" && incoming.security !== "encrypted")
    return false;
  if (previous.security === "unavailable" && incoming.security === "pending")
    return false;
  const { scope: _oldScope, ...oldValue } = old as Message & { scope?: string };
  const { scope: _nextScope, ...nextValue } = next as Message & {
    scope?: string;
  };
  return JSON.stringify(oldValue) !== JSON.stringify(nextValue);
}
export class MemoryVault implements TokenVault {
  private rows = new Map<string, SavedAccount>();
  async list() {
    return [...this.rows.values()];
  }
  async put(account: SavedAccount) {
    this.rows.set(account.instance.instance_id, structuredClone(account));
  }
  async remove(id: string) {
    this.rows.delete(id);
  }
}
