import { cachedMessage, userAddress, serverAddress } from "@haunt/core";
import type {
  Conversation,
  InstanceClient,
  Message,
  ReadState,
  Snapshot,
  User,
} from "@haunt/core";
import type { IndexedDBStore } from "./storage";

export const dmKey = (scope: string, conversation: string) =>
  JSON.stringify([scope, conversation]);
export interface DirectMessage {
  key: string;
  instance: InstanceClient;
  conversation: Conversation;
  users: User[];
  title: string;
  address: string;
  server: string;
  latest?: Message;
  read?: ReadState;
}
export function dmPreview(message?: Message): string {
  if (!message) return "No cached messages";
  message = cachedMessage(message);
  if (message.deleted) return "Message deleted";
  const body = message.body.replace(/[\r\n\t\s]+/g, " ").trim();
  return body
    ? body.slice(0, 240)
    : message.attachment_ids?.length
      ? "Attachment"
      : "";
}
export function sortDMs(
  entries: DirectMessage[],
  favorites: Record<string, boolean>,
) {
  return [...entries].sort(
    (a, b) =>
      Number(!!favorites[b.key]) - Number(!!favorites[a.key]) ||
      (Date.parse(b.latest?.created_at ?? "") || 0) -
        (Date.parse(a.latest?.created_at ?? "") || 0) ||
      a.title.localeCompare(b.title) ||
      a.key.localeCompare(b.key),
  );
}

/** A single lightweight directory for all accounts. No network requests or polling. */
export class DirectMessageDirectory {
  private entries: DirectMessage[] = [];
  private listeners = new Set<() => void>();
  getSnapshot = () => this.entries;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  start(
    instances: InstanceClient[],
    store: Pick<IndexedDBStore, "subscribeMessages" | "latestMessages">,
  ) {
    let live = true;
    const groups = new Map<string, DirectMessage[]>();
    const off: (() => void)[] = [];
    const publish = () => {
      if (!live) return;
      this.entries = [...groups.values()].flat();
      for (const fn of this.listeners) fn();
    };
    for (const instance of instances) {
      const scope = instance.scope;
      let previous: Snapshot | undefined;
      let server = "",
        address = "";
      const latest = new Map<string, Message>();
      let ids = new Set<string>();
      const dirty = new Set<string>();
      let fetching = false;
      const rebuild = () => {
        const state = instance.snapshot;
        const users = new Map(state.users.map((u) => [u.id, u]));
        const own = instance.account.login.user.id;
        const rows: DirectMessage[] = [];
        if (state.status !== "signed-out")
          for (const c of state.conversations) {
            if (c.kind !== "dm") continue;
            const peers = (c.members ?? [])
              .filter((id) => id !== own)
              .map((id) => users.get(id))
              .filter((u): u is User => !!u);
            // Deleted accounts must not reappear from the message archive.
            if (!peers.length) continue;
            rows.push({
              key: dmKey(scope, c.id),
              instance,
              conversation: c,
              users: peers,
              title: peers.map((u) => u.display_name || u.username).join(", "),
              address: peers.map((u) => userAddress(instance, u)).join(", "),
              server: instance.account.instance.name || serverAddress(instance),
              latest: latest.get(c.id),
              read: state.readStates[c.id],
            });
          }
        groups.set(scope, rows);
        publish();
      };
      const flush = async () => {
        if (fetching || !live) return;
        fetching = true;
        try {
          while (dirty.size && live) {
            const batch = [...dirty];
            dirty.clear();
            try {
              const values = await store.latestMessages(scope, batch);
              if (!live) return;
              const pending = [...values.values()].filter(
                (m) => m.security === "pending",
              );
              if (pending.length) {
                await instance.resolveCachedMessages(pending);
                if (!live) return;
                // Read again so edits/deletions during repair win over old data.
                const updated = await store.latestMessages(scope, batch);
                if (!live) return;
                values.clear();
                for (const [id, message] of updated) values.set(id, message);
              }
              for (const id of batch) {
                if (ids.has(id) && values.has(id))
                  latest.set(id, values.get(id)!);
                else latest.delete(id);
              }
              rebuild();
            } catch {
              /* An unavailable local cache must not prevent opening a DM. */
            }
          }
        } finally {
          fetching = false;
        }
      };
      const request = (values: Iterable<string>) => {
        for (const id of values) if (ids.has(id)) dirty.add(id);
        queueMicrotask(() => {
          void flush();
        });
      };
      const update = () => {
        const state = instance.snapshot;
        const name = instance.account.instance.name;
        if (
          previous &&
          previous.conversations === state.conversations &&
          previous.users === state.users &&
          previous.readStates === state.readStates &&
          previous.status === state.status &&
          server === name &&
          address === instance.account.instance.public_url
        )
          return;
        previous = state;
        server = name;
        address = instance.account.instance.public_url;
        const next = new Set(
          state.status === "signed-out"
            ? []
            : state.conversations
                .filter((c) => c.kind === "dm")
                .map((c) => c.id),
        );
        const added = [...next].filter((id) => !ids.has(id));
        ids = next;
        for (const id of latest.keys()) if (!ids.has(id)) latest.delete(id);
        rebuild();
        request(added);
      };
      off.push(instance.subscribe(update));
      off.push(
        store.subscribeMessages((changedScope, conversations) => {
          if (changedScope === scope) request(conversations ?? ids);
        }),
      );
      update();
    }
    publish();
    return () => {
      live = false;
      for (const stop of off) stop();
    };
  }
}
