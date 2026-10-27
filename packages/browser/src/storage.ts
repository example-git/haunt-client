import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { NativeBridge } from "./media/native-types";
import {
  shouldMerge,
  cachedMessage,
  searchableWords,
  searchWords,
  searchLimit,
  archivedText,
  archivePart,
  archiveChunkKey,
  mergeArchivedText,
  packTextChunk,
  unpackTextChunk,
  type ArchivedText,
  type TextArchiveChunk,
  type SearchOptions,
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
  textArchive: {
    key: [string, string];
    value: { scope: string; bucket: string; message: ArchivedText };
    indexes: {
      scope: string;
      bucket: string;
      chronological: [string, string, string];
    };
  };
  archiveChunks: {
    key: string;
    value: {
      key: string;
      scope: string;
      conversation: string;
      part: number;
      revision: number;
      chunk?: TextArchiveChunk;
    };
    indexes: { scope: string };
  };
  archiveMigrations: {
    key: string;
    value: { after: string; complete: boolean };
  };
  archiveSync: { key: string; value: { revision: number; digest: string } };
  search: {
    key: [string, string];
    value: {
      scope: string;
      id: string;
      terms: [string, string, string, number][];
    };
    indexes: { terms: [string, string, string, number]; scope: string };
  };
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
    this.db = openDB<Archive>(name, 3, {
      upgrade(db, previous, _next, transaction) {
        if (previous < 3) {
          const archive = db.createObjectStore("textArchive", {
            keyPath: ["scope", "message.id"],
          });
          archive.createIndex("scope", "scope");
          archive.createIndex("bucket", "bucket");
          archive.createIndex("chronological", [
            "scope",
            "message.created_at",
            "message.id",
          ]);
          db.createObjectStore("archiveChunks", { keyPath: "key" }).createIndex(
            "scope",
            "scope",
          );
          db.createObjectStore("archiveMigrations");
          db.createObjectStore("archiveSync");
          if (previous >= 1)
            void transaction
              .objectStore("cursors")
              .put(1, "archive-migration-v3");
        }
        if (previous >= 2) return;
        const search = db.createObjectStore("search", {
          keyPath: ["scope", "id"],
        });
        search.createIndex("terms", "terms", { multiEntry: true });
        search.createIndex("scope", "scope");
        if (previous >= 1) {
          void transaction.objectStore("cursors").put(1, "search-migration-v2");
          return;
        }
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
  async message(scope: Scope, conversation: string, id: string) {
    const value = await (await this.db).get("messages", [scope, id]);
    return value?.conversation_id === conversation
      ? cachedMessage(value)
      : undefined;
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
    const tx = (await this.db).transaction(
      ["messages", "search", "textArchive", "archiveChunks"],
      "readwrite",
    );
    void tx.done.catch(() => {});
    const changed = new Set<string>();
    const existing = await Promise.all(
      messages.map((m) => tx.objectStore("messages").get([scope, m.id])),
    );
    const oldRows = new Map(
      existing
        .filter((m): m is NonNullable<typeof m> => !!m)
        .map((m) => [m.id, m]),
    );
    const archival: ArchivedText[] = [];
    const writes: Promise<unknown>[] = [];
    for (const raw of messages) {
      const message = cachedMessage(raw);
      const old = oldRows.get(message.id);
      const saved = archivedText(message.deleted && old ? old : message);
      if (saved) archival.push(saved);
      if (shouldMerge(old, message)) {
        writes.push(tx.objectStore("messages").put({ ...message, scope }));
        writes.push(
          tx.objectStore("search").put(this.searchRow(scope, message)),
        );
        oldRows.set(message.id, { ...message, scope });
        changed.add(message.conversation_id);
      }
    }
    await Promise.all([...writes, this.archiveRows(tx, scope, archival)]);
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
      ["messages", "pending", "cursors", "search"],
      "readwrite",
    );
    for (const name of ["messages", "pending", "search"] as const) {
      let cursor = await tx.objectStore(name).index("scope").openCursor(scope);
      while (cursor) {
        await cursor.delete();
        cursor = await cursor.continue();
      }
    }
    await tx.objectStore("cursors").delete(scope);
    const prefix = JSON.stringify([scope, "history"]).slice(0, -1) + ",";
    let cursor = await tx
      .objectStore("cursors")
      .openCursor(IDBKeyRange.bound(prefix, prefix + "\uffff"));
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
    for (const listener of this.listeners) listener(scope, null);
  }
  async close() {
    (await this.db).close();
  }
  private async archiveRows(
    tx: import("idb").IDBPTransaction<
      Archive,
      (
        | "messages"
        | "search"
        | "textArchive"
        | "archiveChunks"
        | "archiveMigrations"
      )[],
      "readwrite"
    >,
    scope: string,
    rows: ArchivedText[],
  ) {
    void tx.done.catch(() => {});
    const records = tx.objectStore("textArchive"),
      chunks = tx.objectStore("archiveChunks");
    const old = await Promise.all(rows.map((m) => records.get([scope, m.id])));
    const current = new Map(
      old
        .filter((m): m is NonNullable<typeof m> => !!m)
        .map((m) => [m.message.id, m.message]),
    );
    const dirty = new Map<string, Omit<TextArchiveChunk, "data">>();
    const writes: Promise<unknown>[] = [];
    for (const row of rows) {
      const before = current.get(row.id),
        next = mergeArchivedText(before, row);
      if (JSON.stringify(before) === JSON.stringify(next)) continue;
      const metadata = {
        scope,
        conversation: next.conversation_id,
        part: archivePart(next.seq),
      };
      const bucket = archiveChunkKey(metadata);
      writes.push(records.put({ scope, bucket, message: next }));
      current.set(next.id, next);
      dirty.set(bucket, metadata);
    }
    await Promise.all([
      ...writes,
      ...[...dirty].map(async ([key, metadata]) => {
        const old = await chunks.get(key);
        await chunks.put({
          key,
          ...metadata,
          revision: (old?.revision ?? 0) + 1,
        });
      }),
    ]);
  }
  async prepareTextArchive(
    scopes: ReadonlySet<string>,
    signal?: AbortSignal,
    progress?: (count: number) => void,
  ) {
    const db = await this.db;
    if (!(await db.get("cursors", "archive-migration-v3"))) return;
    let count = 0;
    for (const scope of scopes) {
      for (;;) {
        signal?.throwIfAborted();
        const tx = db.transaction(
          ["messages", "textArchive", "archiveChunks", "archiveMigrations"],
          "readwrite",
        );
        const state = await tx.objectStore("archiveMigrations").get(scope);
        if (state?.complete) {
          await tx.done;
          break;
        }
        const rows = await tx
          .objectStore("messages")
          .getAll(
            IDBKeyRange.bound(
              [scope, state?.after ?? ""],
              [scope, "\uffff"],
              true,
            ),
            500,
          );
        await this.archiveRows(
          tx,
          scope,
          rows.map(archivedText).filter((m): m is ArchivedText => !!m),
        );
        await tx.objectStore("archiveMigrations").put(
          {
            after: rows.at(-1)?.id ?? state?.after ?? "",
            complete: rows.length < 500,
          },
          scope,
        );
        await tx.done;
        count += rows.length;
        progress?.(count);
        if (rows.length < 500) break;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  }
  async textArchiveScopes() {
    const db = await this.db;
    const scopes = new Set<string>();
    for (const name of ["messages", "textArchive"] as const) {
      let cursor = await db
        .transaction(name)
        .store.index("scope")
        .openKeyCursor(undefined, "nextunique");
      while (cursor) {
        scopes.add(cursor.key);
        cursor = await cursor.continue();
      }
    }
    return scopes;
  }
  async archiveSyncState(key: string) {
    return (await this.db).get("archiveSync", key);
  }
  async saveArchiveSyncState(
    key: string,
    value: { revision: number; digest: string },
  ) {
    await (await this.db).put("archiveSync", value, key);
  }
  async saveArchiveSyncStates(
    entries: [string, { revision: number; digest: string }][],
  ) {
    const tx = (await this.db).transaction("archiveSync", "readwrite");
    await Promise.all(entries.map(([key, value]) => tx.store.put(value, key)));
    await tx.done;
  }
  async textArchiveChunks(
    scopes?: ReadonlySet<string>,
    signal?: AbortSignal,
    progress?: (count: number) => void,
  ) {
    const chunks: TextArchiveChunk[] = [];
    for await (const chunk of this.iterateTextArchiveChunks(
      scopes,
      signal,
      progress,
    ))
      chunks.push(chunk);
    return chunks;
  }
  async *iterateTextArchiveChunks(
    scopes?: ReadonlySet<string>,
    signal?: AbortSignal,
    progress?: (count: number) => void,
  ) {
    scopes ??= await this.textArchiveScopes();
    await this.prepareTextArchive(scopes, signal, progress);
    const db = await this.db;
    let after: string | undefined;
    for (;;) {
      const keys = await db.getAllKeys(
        "archiveChunks",
        after === undefined ? undefined : IDBKeyRange.lowerBound(after, true),
        100,
      );
      if (!keys.length) return;
      for (const key of keys) {
        signal?.throwIfAborted();
        const [scope, conversation, part] = JSON.parse(key) as [
          string,
          string,
          number,
        ];
        if (!scopes.has(scope)) continue;
        const chunk = await this.textArchiveChunk({
          scope,
          conversation,
          part,
        });
        if (chunk) yield chunk;
      }
      after = keys.at(-1)!;
    }
  }
  async textArchiveChunk(
    identity: Pick<TextArchiveChunk, "scope" | "conversation" | "part">,
  ) {
    const db = await this.db;
    const key = archiveChunkKey(identity);
    const tx = db.transaction(["textArchive", "archiveChunks"]);
    const entry = await tx.objectStore("archiveChunks").get(key);
    if (!entry) {
      await tx.done;
      return undefined;
    }
    if (entry.chunk) {
      await tx.done;
      return entry.chunk;
    }
    const rows = await tx
      .objectStore("textArchive")
      .index("bucket")
      .getAll(key);
    await tx.done;
    const chunk = await packTextChunk(
      identity,
      rows.map((r) => r.message),
    );
    const write = db.transaction("archiveChunks", "readwrite");
    const latest = await write.store.get(key);
    if (latest?.revision === entry.revision)
      await write.store.put({ ...latest, chunk });
    await write.done;
    return chunk;
  }
  async restoreTextArchive(
    chunks: TextArchiveChunk[],
    scopes?: ReadonlySet<string>,
    signal?: AbortSignal,
    progress?: (count: number) => void,
  ) {
    const db = await this.db;
    let count = 0;
    for (const chunk of chunks) {
      signal?.throwIfAborted();
      if (scopes && !scopes.has(chunk.scope))
        throw Error("Text archive belongs to another account or server.");
      const rows = await unpackTextChunk(chunk);
      signal?.throwIfAborted();
      const tx = db.transaction(["textArchive", "archiveChunks"], "readwrite");
      await this.archiveRows(tx, chunk.scope, rows);
      await tx.done;
      progress?.((count += rows.length));
    }
  }
  async archivedMessages(scope: string, before?: string) {
    const db = await this.db;
    const rows: ArchivedText[] = [];
    const tx = db.transaction("textArchive");
    const boundary: [string, string] = before
      ? JSON.parse(before)
      : ["\uffff", "\uffff"];
    let cursor = await tx.store
      .index("chronological")
      .openCursor(
        IDBKeyRange.bound([scope, "", ""], [scope, ...boundary], false, true),
        "prev",
      );
    let last: string | undefined;
    while (cursor && rows.length < 50) {
      last = JSON.stringify([
        cursor.value.message.created_at,
        cursor.value.message.id,
      ]);
      if (!cursor.value.message.removed) rows.push(cursor.value.message);
      cursor = await cursor.continue();
    }
    await tx.done;
    return { messages: rows, before: cursor ? last : undefined };
  }
  async removeArchivedMessage(scope: string, id: string) {
    const db = await this.db;
    const tx = db.transaction(["textArchive", "archiveChunks"], "readwrite");
    const row = await tx.objectStore("textArchive").get([scope, id]);
    if (row)
      await this.archiveRows(tx, scope, [
        { ...row.message, body: "", removed: true },
      ]);
    await tx.done;
  }
  private searchRow(scope: string, message: Message) {
    return {
      scope,
      id: message.id,
      terms: searchableWords(message).map(
        (word): [string, string, string, number] => [
          scope,
          message.conversation_id,
          word,
          message.seq,
        ],
      ),
    };
  }
  async search(
    scope: Scope,
    conversation: string,
    query: string,
    options: SearchOptions = {},
  ) {
    const words = searchWords(query);
    if (!words.length) return { messages: [], hasMore: false };
    const db = await this.db;
    const checkpoint = JSON.stringify([
      scope,
      "history",
      conversation,
      "search",
    ]);
    const completed = JSON.stringify([
      scope,
      "history",
      conversation,
      "search-complete",
    ]);
    let indexed = 0;
    options.onProgress?.(indexed);
    const migrate =
      (await db.get("cursors", "search-migration-v2")) &&
      !(await db.get("cursors", completed));
    for (; migrate;) {
      options.signal?.throwIfAborted();
      const tx = db.transaction(["messages", "search", "cursors"], "readwrite");
      const after = (await tx.objectStore("cursors").get(checkpoint)) ?? 0;
      const rows = await tx
        .objectStore("messages")
        .index("conversation")
        .getAll(
          IDBKeyRange.bound(
            [scope, conversation, after],
            [scope, conversation, Number.MAX_SAFE_INTEGER],
            true,
            false,
          ),
          250,
        );
      for (const row of rows)
        await tx.objectStore("search").put(this.searchRow(scope, row));
      if (rows.length)
        await tx.objectStore("cursors").put(rows.at(-1)!.seq, checkpoint);
      if (rows.length < 250) await tx.objectStore("cursors").put(1, completed);
      await tx.done;
      indexed += rows.length;
      options.onProgress?.(indexed);
      if (rows.length < 250) break;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    options.signal?.throwIfAborted();
    const limit = searchLimit(options);
    const tx = db.transaction(["messages", "search"]);
    const index = tx.objectStore("search").index("terms");
    const range = (word: string) =>
      IDBKeyRange.bound(
        [scope, conversation, word, 0],
        [scope, conversation, word, options.before ?? Number.MAX_SAFE_INTEGER],
        false,
        true,
      );
    const counts = await Promise.all(
      words.map((word) => index.count(range(word))),
    );
    const rarest = words[counts.indexOf(Math.min(...counts))];
    const messages: Message[] = [];
    let cursor = await index.openCursor(range(rarest), "prev");
    while (cursor && messages.length <= limit) {
      if (options.signal?.aborted) {
        await tx.done;
        options.signal.throwIfAborted();
      }
      if (
        words.every((word) =>
          cursor!.value.terms.some((term) => term[2] === word),
        )
      ) {
        const row = await tx
          .objectStore("messages")
          .get([scope, cursor.value.id]);
        if (row) messages.push(cachedMessage(row));
      }
      cursor = await cursor.continue();
    }
    await tx.done;
    return {
      messages: messages.slice(0, limit),
      hasMore: messages.length > limit,
    };
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
    | "installing"
    | "error";
  current: string;
  available?: string;
  kind?: "asar" | "installer";
  message?: string;
  notes?: string;
  progress?: number;
  localSigning?: boolean;
}
export interface DesktopBridge extends NativeBridge {
  calls?: {
    settings(value?: {
      shortcuts: boolean;
      ptt: boolean;
    }): Promise<DesktopCallSettings>;
    state(value: {
      active: boolean;
      muted: boolean;
      deafened: boolean;
      sharing: boolean;
    }): Promise<void>;
    subscribe(
      callback: (event: {
        state?: DesktopCallSettings;
        action?: string;
      }) => void,
    ): () => void;
  };
  links?: {
    open(url: string): Promise<void>;
    ready(): Promise<import("./deep-links").DesktopLink[]>;
    subscribe(
      callback: (link: import("./deep-links").DesktopLink) => void,
    ): () => void;
  };
  downloads?: {
    start(url: string, name: string): Promise<string>;
    list(): Promise<DesktopDownload[]>;
    action(
      id: string,
      action: "cancel" | "retry" | "reveal" | "remove",
    ): Promise<void>;
    subscribe(callback: (downloads: DesktopDownload[]) => void): () => void;
  };
  storage?: {
    state(): Promise<DesktopCacheState & { downloadDirectory: string }>;
    budget(bytes: number): Promise<DesktopCacheState>;
    clear(): Promise<DesktopCacheState>;
    chooseDownloads(): Promise<string>;
    reveal(kind: "media" | "application" | "downloads"): Promise<void>;
  };
  copyImage?(bytes: Uint8Array): Promise<void>;
  linuxAudio?: {
    start(id: string): Promise<{ label: string } | null>;
    stop(id: string): Promise<void>;
    subscribe(
      callback: (event: {
        id: string;
        data?: Float32Array;
        error?: string;
      }) => void,
    ): () => void;
  };
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
      kind?: "sync";
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
    focused?: boolean;
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
      focused?: boolean;
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
    icon?: string;
    overlay?: string;
  }): Promise<{ status: "accepted" | "unconfirmed"; message: string } | void>;
  onNotificationError?(callback: (message: string) => void): () => void;
  notificationAvailable(): Promise<boolean>;
  showNotification(value: {
    title: string;
    body: string;
    instance: string;
    conversation: string;
  }): Promise<"shown" | "submitted" | "superseded" | void>;
  onNotificationClick(
    callback: (value: { instance: string; conversation: string }) => void,
  ): () => void;
}
declare global {
  interface Window {
    hauntDesktop?: DesktopBridge;
  }
}
export interface DesktopCallSettings {
  shortcuts: boolean;
  ptt: boolean;
  pressed: boolean;
  native: boolean;
  trigger: string;
  error: string;
}
export interface DesktopDownload {
  error?: string;
  id: string;
  name: string;
  received: number;
  total: number;
  state: "progressing" | "completed" | "cancelled" | "interrupted";
  filePath: string;
  active: boolean;
  sourceKey: string;
}
export interface DesktopCacheState {
  bytes: number;
  entries: number;
  budget: number;
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
