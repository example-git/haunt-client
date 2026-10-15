import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { NativeBridge } from "./media/native-types";
import {
  shouldMerge,
  cachedMessage,
  validateKnownServer,
  type KnownServer,
  type KnownServerStore,
  type Message,
  type MessageStore,
  type PendingMessage,
  type SavedAccount,
  type Scope,
  type TokenVault,
} from "@haunt/core";
interface Archive extends DBSchema {
  messages: {
    key: [string, string];
    value: Message & { scope: string };
    indexes: { conversation: [string, string, number]; scope: string };
  };
  cursors: { key: string; value: number };
  pending: {
    key: [string, string];
    value: PendingMessage & { scope: string };
    indexes: { scope: string };
  };
}
export class IndexedDBStore implements MessageStore {
  private db: Promise<IDBPDatabase<Archive>>;
  private listeners = new Set<
    (scope: Scope, conversations: string[] | null) => void
  >();
  /** Archive commits, not presence/voice updates, invalidate DM previews. */
  subscribeMessages = (
    listener: (scope: Scope, conversations: string[] | null) => void,
  ) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  async latestMessages(
    scope: Scope,
    conversations: string[],
  ): Promise<Map<string, Message>> {
    const result = new Map<string, Message>();
    const db = await this.db;
    // One indexed lookup per conversation, bounded transactions, no history scans.
    for (let offset = 0; offset < conversations.length; offset += 128) {
      const tx = db.transaction("messages");
      await Promise.all(
        conversations.slice(offset, offset + 128).map(async (id) => {
          const cursor = await tx.store
            .index("conversation")
            .openCursor(
              IDBKeyRange.bound(
                [scope, id, 0],
                [scope, id, Number.MAX_SAFE_INTEGER],
              ),
              "prev",
            );
          if (cursor) result.set(id, cachedMessage(cursor.value));
        }),
      );
      await tx.done;
    }
    return result;
  }
  constructor(name = "chatxo-history-v1") {
    this.db = openDB<Archive>(name, 1, {
      upgrade(db) {
        const messages = db.createObjectStore("messages", {
          keyPath: ["scope", "id"],
        });
        messages.createIndex("conversation", [
          "scope",
          "conversation_id",
          "seq",
        ]);
        messages.createIndex("scope", "scope");
        db.createObjectStore("cursors");
        db.createObjectStore("pending", {
          keyPath: ["scope", "request_id"],
        }).createIndex("scope", "scope");
      },
    });
  }
  async messages(
    scope: Scope,
    conversation: string,
    options: { before?: number; limit?: number } = {},
  ) {
    const limit = Math.max(1, Math.min(10_000, options.limit ?? 200));
    const result: Message[] = [];
    const tx = (await this.db).transaction("messages");
    let cursor = await tx.store
      .index("conversation")
      .openCursor(
        IDBKeyRange.bound(
          [scope, conversation, 0],
          [scope, conversation, options.before ?? Number.MAX_SAFE_INTEGER],
          false,
          true,
        ),
        "prev",
      );
    while (cursor && result.length < limit) {
      result.push(cachedMessage(cursor.value));
      cursor = await cursor.continue();
    }
    await tx.done;
    return result.reverse();
  }
  async merge(scope: Scope, messages: Message[]) {
    const tx = (await this.db).transaction("messages", "readwrite");
    const changed = new Set<string>();
    for (const raw of messages) {
      const message = cachedMessage(raw);
      const old = await tx.store.get([scope, message.id]);
      if (shouldMerge(old, message)) {
        await tx.store.put({ ...message, scope });
        changed.add(message.conversation_id);
      }
    }
    await tx.done;
    if (changed.size)
      for (const listener of this.listeners) listener(scope, [...changed]);
  }
  async cursor(scope: Scope) {
    return (await (await this.db).get("cursors", scope)) ?? 0;
  }
  async setCursor(scope: Scope, cursor: number) {
    await (await this.db).put("cursors", cursor, scope);
  }
  async pending(scope: Scope) {
    return (await this.db).getAllFromIndex("pending", "scope", scope);
  }
  async putPending(scope: Scope, message: PendingMessage) {
    await (await this.db).put("pending", { ...message, scope });
  }
  async removePending(scope: Scope, id: string) {
    await (await this.db).delete("pending", [scope, id]);
  }
  async clear(scope: Scope) {
    const tx = (await this.db).transaction(
      ["messages", "pending", "cursors"],
      "readwrite",
    );
    for (const name of ["messages", "pending"] as const) {
      let cursor = await tx.objectStore(name).index("scope").openCursor(scope);
      while (cursor) {
        await cursor.delete();
        cursor = await cursor.continue();
      }
    }
    await tx.objectStore("cursors").delete(scope);
    await tx.done;
    for (const listener of this.listeners) listener(scope, null);
  }
  async close() {
    (await this.db).close();
  }
}
/** Remembered credentials live separately from history; ordinary logins stay in the tab. */
export class BrowserVault implements TokenVault {
  private tail: Promise<unknown> = Promise.resolve();
  private prefix = "chatxo-remembered-v1:";
  constructor(
    private storage: Storage = sessionStorage,
    private persistent?: Storage,
  ) {}
  private durable() {
    return (
      this.persistent ??
      (typeof localStorage === "undefined" ? undefined : localStorage)
    );
  }
  async list(): Promise<SavedAccount[]> {
    const rows = new Map<string, SavedAccount>();
    const durable = this.durable();
    if (durable)
      for (let i = 0; i < durable.length; i++) {
        const key = durable.key(i);
        if (!key?.startsWith(this.prefix)) continue;
        const row: SavedAccount = JSON.parse(durable.getItem(key)!);
        rows.set(row.instance.instance_id, row);
      }
    for (const row of JSON.parse(
      this.storage.getItem("chatxo-sessions-v1") ?? "[]",
    ) as SavedAccount[])
      rows.set(row.instance.instance_id, row);
    return [...rows.values()];
  }
  private update(fn: () => void) {
    const task = this.tail.then(fn);
    this.tail = task.catch(() => {});
    return task;
  }
  put(account: SavedAccount) {
    return this.update(() => {
      const id = account.instance.instance_id;
      const rows = (
        JSON.parse(
          this.storage.getItem("chatxo-sessions-v1") ?? "[]",
        ) as SavedAccount[]
      ).filter((a) => a.instance.instance_id !== id);
      const durable = this.durable();
      if (account.remember) {
        if (!durable)
          throw Error("This browser cannot save logins on this device.");
        // One key per installation avoids lost updates from other tabs/servers.
        durable.setItem(
          this.prefix + encodeURIComponent(id),
          JSON.stringify(account),
        );
        this.storage.setItem("chatxo-sessions-v1", JSON.stringify(rows));
      } else {
        this.storage.setItem(
          "chatxo-sessions-v1",
          JSON.stringify([...rows, account]),
        );
        durable?.removeItem(this.prefix + encodeURIComponent(id));
      }
    });
  }
  remove(id: string) {
    return this.update(() => {
      this.durable()?.removeItem(this.prefix + encodeURIComponent(id));
      const rows = (
        JSON.parse(
          this.storage.getItem("chatxo-sessions-v1") ?? "[]",
        ) as SavedAccount[]
      ).filter((a) => a.instance.instance_id !== id);
      this.storage.setItem("chatxo-sessions-v1", JSON.stringify(rows));
    });
  }
}
export interface DesktopUpdateState {
  phase:
    | "idle"
    | "disabled"
    | "checking"
    | "current"
    | "available"
    | "runtime-required"
    | "downloading"
    | "ready"
    | "installer-ready"
    | "error";
  current: string;
  available?: string;
  message?: string;
  notes?: string;
  progress?: number;
}
export interface DesktopBridge extends NativeBridge {
  appearance?: {
    set(value: {
      mode: "solid" | "material" | "transparent";
      background: string;
      dark: boolean;
    }): Promise<{
      effect: "solid" | "material" | "transparent";
      restart: boolean;
      supported: boolean;
    }>;
  };
  updates?: {
    source(value: {
      id: string;
      remove?: boolean;
      origin?: string;
      manifestURL?: string;
      authenticated?: boolean;
      token?: string;
    }): Promise<void>;
    state(): Promise<DesktopUpdateState>;
    check(): Promise<DesktopUpdateState>;
    download(): Promise<DesktopUpdateState>;
    apply(): Promise<void>;
    healthy(): Promise<void>;
    subscribe(callback: (state: DesktopUpdateState) => void): () => void;
  };
  mediaCacheRead(
    key: string,
  ): Promise<{ type: string; data: Uint8Array } | null>;
  mediaCacheWrite(
    key: string,
    value: { type: string; data: Uint8Array },
  ): Promise<void>;
  mediaDiagnostics(): Promise<{
    hardwareAcceleration: boolean;
    gpu: Record<string, string>;
  }>;
  onCallWindowClosed(callback: () => void): () => void;
  windowState(target: "main" | "call"): Promise<{
    target: "main" | "call";
    maximized: boolean;
    fullscreen: boolean;
  }>;
  windowControl(
    action: "minimize" | "maximize" | "close" | "focus",
    target: "main" | "call",
  ): Promise<void>;
  onWindowState(
    callback: (state: {
      target: "main" | "call";
      maximized: boolean;
      fullscreen: boolean;
    }) => void,
  ): () => void;
  backupSave(data: string): Promise<boolean>;
  serversRead(): Promise<KnownServer[]>;
  serversWrite(servers: KnownServer[]): Promise<void>;
  openExternal(url: string): Promise<void>;
  vaultRead(): Promise<SavedAccount[]>;
  vaultWrite(accounts: SavedAccount[]): Promise<void>;
  platform: string;
  setBadge(value: {
    count: number;
    unread: boolean;
    icon: string;
  }): Promise<void>;
  notificationAvailable(): Promise<boolean>;
  showNotification(value: {
    title: string;
    body: string;
    instance: string;
    conversation: string;
  }): Promise<void>;
  onNotificationClick(
    callback: (value: { instance: string; conversation: string }) => void,
  ): () => void;
}
declare global {
  interface Window {
    hauntDesktop?: DesktopBridge;
  }
}
export class DesktopVault implements TokenVault {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private bridge: DesktopBridge) {}
  list() {
    return this.bridge.vaultRead();
  }
  private update(fn: (rows: SavedAccount[]) => SavedAccount[]) {
    const task = this.tail.then(async () =>
      this.bridge.vaultWrite(fn(await this.list())),
    );
    this.tail = task.catch(() => {});
    return task;
  }
  put(account: SavedAccount) {
    return this.update((rows) => [
      ...rows.filter(
        (a) => a.instance.instance_id !== account.instance.instance_id,
      ),
      account,
    ]);
  }
  remove(id: string) {
    return this.update((rows) =>
      rows.filter((a) => a.instance.instance_id !== id),
    );
  }
}

interface ServerDirectory extends DBSchema {
  servers: { key: [string, string]; value: KnownServer };
}
/** Non-secret connection details survive revocation and ordinary session expiry. */
export class IndexedDBKnownServers implements KnownServerStore {
  private db: Promise<IDBPDatabase<ServerDirectory>>;
  constructor(name = "chatxo-known-servers-v1") {
    this.db = openDB<ServerDirectory>(name, 1, {
      upgrade(db) {
        db.createObjectStore("servers", { keyPath: ["origin", "username"] });
      },
    });
  }
  async list() {
    return (await (await this.db).getAll("servers")).sort(
      (a, b) => b.lastUsed - a.lastUsed,
    );
  }
  async put(value: KnownServer) {
    const tx = (await this.db).transaction("servers", "readwrite");
    await tx.store.put(validateKnownServer(value));
    const rows = (await tx.store.getAll()).sort(
      (a, b) => b.lastUsed - a.lastUsed,
    );
    for (const old of rows.slice(100))
      await tx.store.delete([old.origin, old.username]);
    await tx.done;
  }
  async remove(origin: string, username: string) {
    await (await this.db).delete("servers", [origin, username]);
  }
  async close() {
    (await this.db).close();
  }
}
export class DesktopKnownServers implements KnownServerStore {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private bridge: DesktopBridge) {}
  async list() {
    return (await this.bridge.serversRead())
      .map(validateKnownServer)
      .sort((a, b) => b.lastUsed - a.lastUsed);
  }
  private update(fn: (rows: KnownServer[]) => KnownServer[]) {
    const task = this.tail.then(async () =>
      this.bridge.serversWrite(fn(await this.list())),
    );
    this.tail = task.catch(() => {});
    return task;
  }
  put(value: KnownServer) {
    const server = validateKnownServer(value);
    return this.update((rows) =>
      [
        server,
        ...rows.filter(
          (r) => r.origin !== server.origin || r.username !== server.username,
        ),
      ].slice(0, 100),
    );
  }
  remove(origin: string, username: string) {
    return this.update((rows) =>
      rows.filter((r) => r.origin !== origin || r.username !== username),
    );
  }
}
