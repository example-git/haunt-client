export type UserStatus = "online" | "offline" | "unknown";

/** Ephemeral per-instance state. Only avatars of affected users are notified. */
export class UserPresence {
  private online?: Set<string>;
  private revision = 0;
  private rosterListeners = new Set<() => void>();
  rosterRevision = () => this.revision;
  subscribeRoster = (listener: () => void) => {
    this.rosterListeners.add(listener);
    return () => {
      this.rosterListeners.delete(listener);
    };
  };
  private listeners = new Map<string, Set<() => void>>();
  status = (user: string): UserStatus =>
    this.online ? (this.online.has(user) ? "online" : "offline") : "unknown";
  subscribe(user: string, listener: () => void) {
    let listeners = this.listeners.get(user);
    if (!listeners) this.listeners.set(user, (listeners = new Set()));
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(user);
    };
  }
  receive(ids: unknown) {
    if (
      !Array.isArray(ids) ||
      ids.length > 512 ||
      !ids.every(
        (id) => typeof id === "string" && id.length > 0 && id.length <= 64,
      )
    )
      return;
    this.replace(new Set(ids));
  }
  clear() {
    this.replace(undefined);
  }
  private replace(next?: Set<string>) {
    const previous = this.online;
    this.online = next;
    if (
      (previous === undefined) !== (next === undefined) ||
      previous?.size !== next?.size ||
      (next && [...next].some((id) => !previous?.has(id)))
    ) {
      this.revision++;
      for (const listener of this.rosterListeners) listener();
    }
    for (const [user, listeners] of this.listeners) {
      if (
        (previous === undefined) !== (next === undefined) ||
        previous?.has(user) !== next?.has(user)
      )
        for (const listener of listeners) listener();
    }
  }
}
