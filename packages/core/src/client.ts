import type { DMEncryption } from "./dm.js";
import {
  cachedMessage,
  isEncryptedEnvelope,
  messageDisplayVersion,
  mlsMessagePrefix,
} from "./message-content.js";
import { requestMenuJSON, requestBoundedJSON } from "./menus.js";
import { requestExtensionSpeech } from "./server-extensions.js";
import { parseInviteLink } from "./invites.js";
import { UserPresence } from "./presence.js";
import { PasswordChangeRequired } from "./password-reset.js";
import { knownServer, type KnownServerStore } from "./known-servers.js";
import {
  api,
  APIError,
  discover,
  checkReadiness,
  friendlyError,
  serverOrigin,
  socketURL,
  unwrap,
} from "./api.js";
import { EventSocket } from "./socket.js";
import {
  accountScope,
  type Credentials,
  type Message,
  type MessageStore,
  type PendingMessage,
  type Runtime,
  type ReadState,
  type SavedAccount,
  type Snapshot,
  type TokenVault,
  type WireEvent,
} from "./types.js";

export class InstanceClient {
  private encryption?: DMEncryption;
  get dmEncryption() {
    if (!this.account.instance.capabilities?.includes("dms.mls.v1"))
      return undefined;
    return (this.encryption ??= this.runtime.dmEncryption?.(this));
  }
  isDM(id: string) {
    return this.snapshot.conversations.some(
      (c) => c.id === id && c.kind === "dm",
    );
  }
  private async decodeMessage(message: Message): Promise<Message> {
    // API objects are wire data, never trusted local presentation metadata.
    message = {
      ...message,
      wire: undefined,
      displayVersion: messageDisplayVersion,
      security: undefined,
      securityError: undefined,
    };
    if (message.deleted) return cachedMessage(message);
    if (isEncryptedEnvelope(message.body)) {
      const wire = {
        body: message.body,
        attachment_ids: message.attachment_ids ?? [],
      };
      const decoded =
        message.body.startsWith(mlsMessagePrefix) && this.dmEncryption
          ? await this.dmEncryption.decode(message)
          : {
              ...message,
              body: "Update your client to read this encrypted message",
              attachment_ids: [],
              security: "unavailable" as const,
            };
      return { ...decoded, wire, displayVersion: messageDisplayVersion };
    }
    return this.isDM(message.conversation_id)
      ? { ...message, security: "legacy" }
      : message;
  }

  readonly presence = new UserPresence();
  readonly scope: string;
  readonly http: ReturnType<typeof api>;
  readonly origin: string;
  private events?: EventSocket;
  private listeners = new Set<() => void>();
  private wireListeners = new Set<(event: WireEvent) => void>();
  private reconnect?: ReturnType<typeof setTimeout>;
  private readinessAbort?: AbortController;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private attempts = 0;
  private stopped = false;
  private generation = 0;
  private active?: string;
  private syncing?: Promise<void>;
  private resyncQueued = false;
  private subscribed: string[] = [];
  private snapshotCursor = 0;
  private headCursor = 0;
  private onlineSince = Infinity;
  private accountFeed = false;
  private foreground = false;
  private directoryTimer?: ReturnType<typeof setTimeout>;
  private readSync?: Promise<void>;
  private readAgain = false;
  private readTimer?: ReturnType<typeof setTimeout>;
  private pendingReads = new Map<string, number>();
  private marking = false;
  get liveEventCursor() {
    return this.headCursor;
  }
  private eventWrites: Promise<void> = Promise.resolve();
  private eventBacklog = 0;
  private sending = new Set<string>();
  snapshot: Snapshot = {
    status: "connecting",
    channels: [],
    categories: [],
    conversations: [],
    users: [],
    emojis: [],
    voiceRooms: {},
    readStates: {},
    permissions: 0,
    rolePosition: 0,
    revision: 0,
  };
  constructor(
    readonly account: SavedAccount,
    private runtime: Runtime,
    readonly store: MessageStore,
    private vault: TokenVault,
  ) {
    this.origin = serverOrigin(account.origin);
    this.scope = accountScope(
      account.instance.instance_id,
      account.login.user.id,
    );
    this.http = api(this.origin, runtime, account.login.token);
  }
  menuRequest(
    path: string,
    method = "GET",
    body?: unknown,
    signal?: AbortSignal,
  ) {
    return requestMenuJSON(
      (request) => this.runtime.fetch(request),
      this.origin,
      this.account.login.token,
      path,
      method,
      body,
      signal,
    );
  }
  extensionSpeech(
    extension: string,
    prompt: { text: string; voice: string; room_id?: string },
    signal?: AbortSignal,
    test = false,
  ) {
    return requestExtensionSpeech(
      (request) => this.runtime.fetch(request), this.origin,
      this.account.login.token, extension, prompt, signal, test,
    );
  }
  dmRequest(path: string, method = "GET", body?: unknown) {
    if (
      !/^\/api\/v1\/(?:me\/dm-devices(?:\/[0-9a-f-]{36}\/packages)?|conversations\/[0-9a-f-]{36}\/encryption(?:\/events(?:\?after=\d+)?)?)$/.test(
        path,
      )
    )
      throw Error("Invalid DM encryption API path");
    return requestBoundedJSON(
      (request) => this.runtime.fetch(request),
      this.origin,
      this.account.login.token,
      path,
      method,
      body,
      undefined,
      2 * 1024 * 1024,
    );
  }
  async pluginBytes(
    path: string,
    expectedBytes: number,
    upload?: Blob,
    onProgress?: (received: number, total: number) => void,
  ): Promise<ArrayBuffer> {
    if (
      !/^\/api\/v1\/(?:audio-plugins\/[a-f0-9]{64}\/files\/[a-z][a-z0-9_-]{0,63}\.wasm|admin\/audio-plugins)$/.test(
        path,
      ) ||
      !Number.isSafeInteger(expectedBytes) ||
      expectedBytes < 0 ||
      expectedBytes > 50 * 1024 * 1024 ||
      (upload && upload.size > 50 * 1024 * 1024)
    )
      throw Error("Invalid audio plugin request");
    onProgress?.(0, expectedBytes);
    let notified = performance.now();
    const response = await this.runtime.fetch(this.origin + path, {
      method: upload ? "POST" : "GET",
      body: upload,
      headers: {
        Authorization: `Bearer ${this.account.login.token}`,
        ...(upload ? { "Content-Type": "application/zip" } : {}),
      },
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new APIError(response.status, "audio_plugin_unavailable");
    }
    const reader = response.body!.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > expectedBytes)
          throw Error("Audio plugin exceeds its size limit");
        chunks.push(value);
        if (performance.now() - notified >= 100 || size === expectedBytes) {
          onProgress?.(size, expectedBytes);
          notified = performance.now();
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    if (!upload && size !== expectedBytes)
      throw Error("Incomplete audio plugin download");
    onProgress?.(size, expectedBytes);
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes.buffer;
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.snapshot;
  onWire(fn: (event: WireEvent) => void) {
    this.wireListeners.add(fn);
    return () => {
      this.wireListeners.delete(fn);
    };
  }
  private changed(patch: Partial<Snapshot> = {}) {
    this.snapshot = {
      ...this.snapshot,
      ...patch,
      revision: this.snapshot.revision + 1,
    };
    for (const listener of this.listeners) listener();
  }
  async connect(): Promise<void> {
    if (this.stopped) return;
    const generation = ++this.generation;
    clearTimeout(this.reconnect);
    this.reconnect = undefined;
    clearTimeout(this.refreshTimer);
    this.events?.close();
    this.presence.clear();
    this.readinessAbort?.abort();
    const readinessAbort = (this.readinessAbort = new AbortController());
    this.changed({
      status: "connecting",
      readiness: "checking",
      error: undefined,
    });
    // Advisory only: misconfigured health routing must never block a working API.
    void checkReadiness(this.origin, this.runtime, readinessAbort.signal).then(
      () => {
        if (generation === this.generation && !this.stopped)
          this.changed({ readiness: "ready" });
      },
      (error) => {
        if (
          generation === this.generation &&
          !this.stopped &&
          this.snapshot.status !== "online"
        )
          this.changed({
            readiness: error instanceof APIError ? "unavailable" : "unknown",
          });
      },
    );
    void this.runtime.prepareConnection?.(this).catch(() => {});
    try {
      // Verify identity on EVERY reconnect before forwarding a saved credential.
      const instance = await discover(this.origin, this.runtime);
      if (instance.instance_id !== this.account.instance.instance_id)
        throw new APIError(401, "instance_changed");
      if (generation !== this.generation || this.stopped) return;
      const me = await unwrap(this.http.GET("/api/v1/me"));
      if (generation !== this.generation || this.stopped) return;
      if (me.user.id !== this.account.login.user.id)
        throw new APIError(401, "account_changed");
      this.account.instance = instance;
      // Upgrade explicitly saved credentials when an older server gains support.
      // A changed installation has already been rejected before any token is sent.
      if (
        this.account.remember &&
        this.account.login.session.expires_at &&
        instance.capabilities?.includes("sessions.persistent")
      )
        await this.setRemember(true);
      this.accountFeed =
        instance.capabilities?.includes("events.account_feed") ?? false;
      this.changed({
        rolePosition: me.role_position ?? 0,
        permissions: me.permissions,
      });
      const events = new EventSocket(
        this.runtime,
        socketURL(this.origin, "/api/v1/events"),
      );
      this.events = events;
      events.onEvent = (event) => {
        if (generation === this.generation) this.handleEvent(event);
      };
      events.onClose = () => {
        if (generation === this.generation && !this.stopped)
          this.disconnected();
      };
      const ready = await events.open(
        this.account.login.token,
        instance.instance_id,
      );
      this.headCursor = Number(ready.event_cursor);
      if (generation !== this.generation || this.stopped) {
        events.close();
        return;
      }
      this.changed({ status: "syncing" });
      if (instance.capabilities?.includes("presence.online"))
        await events.command({ type: "presence.watch" }, "presence.watching");
      if (this.syncing) await this.syncing.catch(() => {});
      if (generation !== this.generation || this.stopped) return;
      await this.refresh();
      if (this.accountFeed) {
        await this.eventWrites;
        const saved = await this.store.cursor(this.scope);
        // Persist the initial baseline even when this quiet account has no
        // subsequent frames. Reconnect must not skip its disconnected interval.
        if (!saved) await this.store.setCursor(this.scope, this.headCursor);
        await events.command(
          { type: "events.watch", after_event: saved || this.headCursor },
          "events.watching",
        );
      }
      if (generation !== this.generation || this.stopped) return;
      // Server selection can change while history/account state is syncing.
      // Apply its latest value at the end of the handshake, then reconcile any
      // selection change that happened while the watch acknowledgement arrived.
      if (instance.capabilities?.includes("media.presence")) {
        let watching = false;
        while (watching !== this.foreground) {
          watching = this.foreground;
          await events.command(
            { type: "voice.watch", enabled: watching },
            "voice.watching",
          );
          if (generation !== this.generation || this.stopped) return;
        }
      }
      this.attempts = 0;
      this.onlineSince = Date.now();
      this.changed({ status: "online", readiness: "ready", error: undefined });
      void this.dmEncryption?.start().catch(() => {});
      this.scheduleRefresh();
    } catch (error) {
      if (generation !== this.generation || this.stopped) return;
      if (
        error instanceof APIError &&
        (error.status === 401 ||
          error.code === "banned" ||
          error.code === "password_change_required")
      ) {
        this.stop();
        await this.vault.remove(this.account.instance.instance_id);
        this.changed({
          status: "signed-out",
          error: friendlyError(error),
          channels: [],
          conversations: [],
        });
      } else this.disconnected(friendlyError(error));
    }
  }
  private disconnected(error = "Connection interrupted. Reconnecting…") {
    if (this.stopped || this.reconnect) return;
    this.events?.close();
    clearTimeout(this.refreshTimer);
    this.changed({ status: "offline", error, voiceRooms: {} });
    this.presence.clear();
    for (const fn of this.wireListeners) fn({ type: "connection.lost" });
    const delay =
      Math.min(30_000, 1000 * 2 ** Math.min(this.attempts++, 5)) +
      Math.random() * 500;
    this.reconnect = setTimeout(() => {
      this.reconnect = undefined;
      void this.connect();
    }, delay);
  }
  private scheduleRefresh() {
    clearTimeout(this.refreshTimer);
    if (this.accountFeed) return;
    this.refreshTimer = setTimeout(() => {
      // HTTP refresh also discovers new DMs/channels, permission changes, and
      // conversations beyond the socket's 64-subscription limit.
      void this.refresh(false)
        .catch((error) => this.disconnected(friendlyError(error)))
        .finally(() => {
          if (!this.stopped && this.snapshot.status === "online")
            this.scheduleRefresh();
        });
    }, 60_000);
  }
  private handleEvent(event: WireEvent) {
    if (!event.type.startsWith("message."))
      for (const fn of this.wireListeners) fn(event);
    if (
      event.type === "dm.keys_changed" ||
      event.type === "dm.devices_changed"
    ) {
      if (typeof event.conversation_id === "string")
        void this.dmEncryption
          ?.sync(event.conversation_id)
          .then(() => this.syncHistory(String(event.conversation_id)))
          .catch(() => {});
    }
    if (event.type === "presence.snapshot") {
      this.presence.receive(event.online_user_ids);
      return;
    }
    if (event.type === "read.state") {
      this.mergeReads(event.states);
      return;
    }
    if (event.type === "directory.changed") {
      if (this.directoryTimer) return;
      this.directoryTimer = setTimeout(() => {
        this.directoryTimer = undefined;
        void this.refreshAfterChange().catch((error) =>
          this.disconnected(friendlyError(error)),
        );
      }, 200);
      return;
    }
    if (event.type === "read.sync") {
      void this.syncReads().catch((error) =>
        this.disconnected(friendlyError(error)),
      );
      return;
    }
    if (event.type === "events.checkpoint") {
      if (
        Number.isSafeInteger(event.event_cursor) &&
        Number(event.event_cursor) >= 0
      )
        this.eventWrites = this.eventWrites
          .then(() =>
            this.store.setCursor(this.scope, Number(event.event_cursor)),
          )
          .catch((error) => this.disconnected(friendlyError(error)));
      return;
    }
    if (event.type === "voice.presence") {
      const rooms = event.rooms;
      if (!rooms || typeof rooms !== "object" || Array.isArray(rooms)) return;
      const clean: Snapshot["voiceRooms"] = {};
      for (const [id, members] of Object.entries(rooms)) {
        if (!Array.isArray(members) || members.length > 512) return;
        if (
          !members.every(
            (p) =>
              p &&
              typeof p.user_id === "string" &&
              typeof p.participant_id === "string" &&
              p.state,
          )
        )
          return;
        clean[id] = members;
      }
      this.changed({ voiceRooms: clean });
      return;
    }
    if (event.type === "sync.required") {
      if (Number.isSafeInteger(event.event_cursor))
        this.headCursor = Number(event.event_cursor);
      if (this.accountFeed) {
        void this.recoverGap().catch((error) =>
          this.disconnected(friendlyError(error)),
        );
        return;
      }
      if (this.syncing) {
        this.resyncQueued = true;
        return;
      }
      void this.refresh().catch((error) =>
        this.disconnected(friendlyError(error)),
      );
      return;
    }
    if (event.type === "subscription.revoked") {
      const readStates = { ...this.snapshot.readStates };
      delete readStates[String(event.conversation_id)];
      this.changed({
        readStates,
        channels: this.snapshot.channels.filter(
          (c) => c.id !== event.conversation_id,
        ),
        conversations: this.snapshot.conversations.filter(
          (c) => c.id !== event.conversation_id,
        ),
      });
      return;
    }
    if (!Number.isSafeInteger(event.id) || Number(event.id) < 0) return;
    if (++this.eventBacklog > 256) {
      this.eventBacklog--;
      this.disconnected("Catching up with messages…");
      return;
    }
    this.eventWrites = this.eventWrites
      .then(async () => {
        if (event.type.startsWith("message.")) {
          const raw = event.data as Message;
          const message = raw ? await this.decodeMessage(raw) : raw;
          if (
            !message ||
            message.conversation_id !== event.conversation_id ||
            !Number.isSafeInteger(message.seq)
          )
            throw Error("Invalid message event");
          await this.store.merge(this.scope, [message]);
          for (const fn of this.wireListeners) fn({ ...event, data: message });
          if (message.author_id === this.account.login.user.id)
            await this.store.removePending(this.scope, message.request_id);
        }
        // Retention events intentionally keep older downloaded content.
        await this.store.setCursor(this.scope, Number(event.id));
        this.changed();
      })
      .catch((error) => this.disconnected(friendlyError(error)))
      .finally(() => {
        this.eventBacklog--;
      });
  }
  async refresh(full = true) {
    if (this.syncing) return this.syncing;
    this.syncing = this.synchronize(full).finally(() => {
      this.syncing = undefined;
      if (this.resyncQueued && !this.stopped) {
        this.resyncQueued = false;
        queueMicrotask(() => {
          void this.refresh().catch((error) =>
            this.disconnected(friendlyError(error)),
          );
        });
      }
    });
    return this.syncing;
  }
  // A response already in flight may predate the caller's mutation. Wait for
  // that snapshot, then fetch a new one; ordinary refreshes remain coalesced.
  async refreshAfterChange() {
    if (this.syncing) await this.syncing;
    if (!this.stopped) await this.refresh(false);
  }
  private async synchronize(full: boolean) {
    const generation = this.generation;
    const known = new Set(this.snapshot.conversations.map((c) => c.id));
    const knewEmojis =
      this.account.instance.capabilities?.includes("community.emojis");
    const [channels, categories, conversations, users, me, instance, emojis] =
      await Promise.all([
        unwrap(this.http.GET("/api/v1/channels")),
        unwrap(this.http.GET("/api/v1/categories")),
        this.allConversations(),
        this.allUsers(),
        unwrap(this.http.GET("/api/v1/me")),
        discover(this.origin, this.runtime),
        knewEmojis
          ? unwrap(this.http.GET("/api/v1/emojis"))
          : Promise.resolve({ emojis: [] }),
      ]);
    if (this.stopped || generation !== this.generation) return;
    if (instance.instance_id !== this.account.instance.instance_id)
      throw new APIError(401, "instance_changed");
    // An already-saved account may be reconnecting to a newly upgraded server.
    const catalog =
      !knewEmojis && instance.capabilities?.includes("community.emojis")
        ? await unwrap(this.http.GET("/api/v1/emojis"))
        : emojis;
    if (this.stopped || generation !== this.generation) return;
    if (
      JSON.stringify(instance) !== JSON.stringify(this.account.instance) ||
      JSON.stringify(me.user) !== JSON.stringify(this.account.login.user)
    ) {
      this.account.instance = instance;
      this.account.login.user = me.user;
      await this.vault.put(this.account);
      if (this.stopped || generation !== this.generation) return;
    }
    this.changed({
      channels: channels.channels ?? [],
      categories: categories.categories ?? [],
      conversations,
      users,
      emojis: catalog.emojis ?? [],
      rolePosition: me.role_position ?? 0,
      permissions: me.permissions,
    });
    if (this.accountFeed) {
      const visible = new Set(
        [...(channels.channels ?? []), ...conversations].map((c) => c.id),
      );
      this.changed({
        readStates: Object.fromEntries(
          Object.entries(this.snapshot.readStates).filter(([id]) =>
            visible.has(id),
          ),
        ),
      });
      await this.syncReads();
      if (full && this.active && visible.has(this.active))
        await this.syncHistory(this.active);
      return;
    }
    const ids = [
      ...new Set([
        ...(channels.channels ?? [])
          .filter((c) => c.kind === "text")
          .map((c) => c.id),
        ...conversations.map((c) => c.id),
      ]),
    ];
    const refreshIds = full
      ? ids
      : ids.filter((id) => !known.has(id) || !this.subscribed.includes(id));
    let cursor = full
      ? Number.MAX_SAFE_INTEGER
      : Math.max(this.snapshotCursor, await this.store.cursor(this.scope));
    let next = 0;
    // Independent histories in parallel; bound both HTTP pressure and memory.
    await Promise.all(
      Array.from({ length: Math.min(4, refreshIds.length) }, async () => {
        while (
          next < refreshIds.length &&
          !this.stopped &&
          generation === this.generation
        ) {
          const id = refreshIds[next++];
          try {
            cursor = Math.min(cursor, await this.syncHistory(id));
          } catch (error) {
            if (!(
              error instanceof APIError && [403, 404].includes(error.status)
            ))
              throw error;
          }
        }
      }),
    );
    if (this.stopped || generation !== this.generation) return;
    if (cursor === Number.MAX_SAFE_INTEGER) cursor = this.headCursor;
    const subscribed = [
      ...new Set([
        ...(this.active && ids.includes(this.active) ? [this.active] : []),
        ...ids,
      ]),
    ].slice(0, 64);
    if (
      full ||
      JSON.stringify(subscribed) !== JSON.stringify(this.subscribed)
    ) {
      await this.command(
        { type: "subscribe", conversations: subscribed, after_event: cursor },
        "subscribed",
      );
      this.subscribed = subscribed;
      this.snapshotCursor = cursor;
    }
    this.changed();
  }
  async syncHistory(conversation: string): Promise<number> {
    const previous =
      this.snapshot.status === "online"
        ? ((
            await this.store.messages(this.scope, conversation, { limit: 1 })
          )[0]?.seq ?? 0)
        : Infinity;
    let after = 0,
      cursor = Number.MAX_SAFE_INTEGER;
    for (;;) {
      const page = await unwrap(
        this.http.GET("/api/v1/conversations/{id}/messages", {
          params: { path: { id: conversation }, query: { after, limit: 100 } },
        }),
      );
      const messages: Message[] = [];
      for (const message of page.messages ?? [])
        messages.push(await this.decodeMessage(message));
      cursor = Math.min(cursor, page.event_cursor);
      await this.store.merge(this.scope, messages);
      // Histories also discover new DMs and rooms beyond the live socket limit.
      // Only creations during this online session can notify; reload/reconnect
      // history and edits to previously downloaded messages remain silent.
      for (const message of messages) {
        if (
          !this.accountFeed &&
          message.seq > previous &&
          Date.parse(message.created_at) > this.onlineSince &&
          this.snapshot.status === "online" &&
          !message.edited_at
        )
          for (const listener of this.wireListeners)
            listener({
              type: "message.discovered",
              conversation_id: conversation,
              data: message,
            });
      }
      for (const message of messages)
        if (message.author_id === this.account.login.user.id)
          await this.store.removePending(this.scope, message.request_id);
      if (messages.length < 100 || this.stopped) break;
      const last = messages[messages.length - 1].seq;
      if (last <= after) throw Error("Server returned nonadvancing history");
      after = last;
    }
    this.changed();
    return cursor;
  }
  private async allConversations() {
    const result = [];
    let after: string | undefined;
    for (;;) {
      const { conversations } = await unwrap(
        this.http.GET("/api/v1/conversations", {
          params: { query: { after } },
        }),
      );
      const page = conversations ?? [];
      result.push(...page);
      if (page.length < 100) return result;
      const last = page[page.length - 1].id;
      if (last === after)
        throw Error("Server returned nonadvancing conversations");
      after = last;
    }
  }
  async allUsers() {
    const result = [];
    let after: string | undefined;
    for (;;) {
      const { users } = await unwrap(
        this.http.GET("/api/v1/users", { params: { query: { after } } }),
      );
      const page = users ?? [];
      result.push(...page);
      if (page.length < 100) return result;
      const last = page[page.length - 1].id;
      if (last === after) throw Error("Server returned nonadvancing users");
      after = last;
    }
  }
  async selectConversation(id: string) {
    this.active = id;
    if (this.snapshot.status === "online") {
      if (this.accountFeed) await this.syncHistory(id);
      else await this.refresh();
    }
  }
  setForeground(enabled: boolean) {
    if (this.foreground === enabled) return;
    this.foreground = enabled;
    if (!enabled) this.changed({ voiceRooms: {} });
    if (
      this.snapshot.status === "online" &&
      this.account.instance.capabilities?.includes("media.presence") &&
      (enabled || this.accountFeed)
    )
      void this.command(
        { type: "voice.watch", enabled },
        "voice.watching",
      ).catch(() => {});
  }
  private mergeReads(value: unknown) {
    if (!Array.isArray(value) || value.length > 100) return;
    const next = { ...this.snapshot.readStates };
    let changed = false;
    for (const state of value as ReadState[]) {
      if (
        !state ||
        typeof state.conversation_id !== "string" ||
        ![
          state.read_seq,
          state.last_seq,
          state.unread_count,
          state.mention_count,
          state.event_cursor,
        ].every((n) => Number.isSafeInteger(n) && n >= 0)
      )
        continue;
      const previous = next[state.conversation_id];
      if (
        previous &&
        (state.event_cursor < previous.event_cursor ||
          state.read_seq < previous.read_seq)
      )
        continue;
      if (JSON.stringify(previous) !== JSON.stringify(state)) {
        next[state.conversation_id] = state;
        changed = true;
      }
    }
    if (changed) this.changed({ readStates: next });
  }
  private async syncReads(): Promise<void> {
    if (!this.accountFeed || this.stopped) return;
    if (this.readSync) {
      this.readAgain = true;
      return this.readSync;
    }
    this.readSync = (async () => {
      do {
        this.readAgain = false;
        let after: string | undefined;
        do {
          const page = await unwrap(
            this.http.GET("/api/v1/read-state", {
              params: { query: { after } },
            }),
          );
          if (this.stopped) return;
          this.mergeReads(page.states);
          if (page.next && page.next === after)
            throw Error("Server returned nonadvancing read state");
          after = page.next;
        } while (after);
      } while (this.readAgain && !this.stopped);
    })().finally(() => {
      this.readSync = undefined;
    });
    return this.readSync;
  }
  private async recoverGap() {
    await this.refreshAfterChange();
    if (this.active) await this.syncHistory(this.active);
    await this.eventWrites;
    await this.store.setCursor(this.scope, this.headCursor);
    await this.command(
      { type: "events.watch", after_event: this.headCursor },
      "events.watching",
    );
  }
  // Acknowledge only the sequence actually displayed by the host UI. Coalesce
  // bursts, and keep requests independent of gateway receipt and history sync.
  markRead(conversation: string, seq: number) {
    if (
      !this.accountFeed ||
      !Number.isSafeInteger(seq) ||
      seq < 1 ||
      seq <= (this.snapshot.readStates[conversation]?.read_seq ?? 0)
    )
      return;
    this.pendingReads.set(
      conversation,
      Math.max(seq, this.pendingReads.get(conversation) ?? 0),
    );
    if (this.pendingReads.size > 100)
      this.pendingReads.delete(this.pendingReads.keys().next().value!);
    if (!this.readTimer && !this.marking)
      this.readTimer = setTimeout(() => void this.flushReads(), 500);
  }
  private async flushReads() {
    this.readTimer = undefined;
    if (this.stopped || this.snapshot.status !== "online") return;
    this.marking = true;
    const batch = [...this.pendingReads];
    this.pendingReads.clear();
    try {
      // Usually one visible conversation; at most four concurrent HTTP writes.
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(4, batch.length) }, async () => {
          while (next < batch.length && !this.stopped) {
            const [id, seq] = batch[next++];
            const state = await unwrap(
              this.http.PUT("/api/v1/conversations/{id}/read", {
                params: { path: { id } },
                body: { seq },
              }),
            );
            this.mergeReads([state]);
          }
        }),
      );
    } catch {
      /* Retry when the visible UI next acknowledges its messages. */
    } finally {
      this.marking = false;
      if (this.pendingReads.size && !this.stopped)
        this.readTimer = setTimeout(() => void this.flushReads(), 500);
    }
  }
  /** Repair old cached wire rows before any UI, preview or export uses them. */
  async resolveCachedMessages(messages: Message[]): Promise<Message[]> {
    const safe = messages.map(cachedMessage);
    const repaired: Message[] = [];
    for (const message of safe) {
      if (message.security !== "pending" || !message.wire) continue;
      repaired.push(await this.decodeMessage({ ...message, ...message.wire }));
    }
    if (repaired.length) await this.store.merge(this.scope, repaired);
    const byID = new Map(repaired.map((message) => [message.id, message]));
    return safe.map((message) => byID.get(message.id) ?? message);
  }
  async messages(
    conversation: string,
    options?: { before?: number; limit?: number },
  ) {
    const messages = await this.store.messages(
      this.scope,
      conversation,
      options,
    );
    if (
      messages.some((message) => cachedMessage(message).security === "pending")
    ) {
      await this.resolveCachedMessages(messages);
      // A newer edit/delete may have arrived while decryption was in flight.
      return (await this.store.messages(this.scope, conversation, options)).map(
        cachedMessage,
      );
    }
    return messages.map(cachedMessage);
  }
  pending() {
    return this.store.pending(this.scope);
  }
  async send(
    conversation: string,
    body: string,
    attachments: string[] = [],
    replyTo?: string,
  ) {
    const maxBytes = Math.min(
      65_536,
      Math.floor((this.account.instance.limits.text_max_bytes - 2048) / 4),
    );
    if (
      (!body.trim() && !attachments.length) ||
      new TextEncoder().encode(body).length > maxBytes ||
      attachments.length > 8
    )
      throw Error("Message is empty or exceeds this server’s limit.");
    const message: PendingMessage = {
      request_id: this.runtime.randomUUID(),
      conversation_id: conversation,
      body,
      attachment_ids: attachments,
      reply_to_id: replyTo,
      created_at: new Date().toISOString(),
    };
    await this.store.putPending(this.scope, message);
    this.changed();
    return this.retry(message);
  }
  async retry(message: PendingMessage) {
    if (this.sending.has(message.request_id)) return;
    if (
      !this.isDM(message.conversation_id) &&
      Date.now() - Date.parse(message.created_at) >
        this.account.instance.limits.text_retention_days * 86_400_000
    )
      throw Error(
        "This draft is too old to retry safely. Copy it into a new message.",
      );
    this.sending.add(message.request_id);
    try {
      if (this.snapshot.status !== "online")
        throw Error("Saved on this device. Retry when the server reconnects.");
      const encryption = this.isDM(message.conversation_id)
        ? this.dmEncryption
        : undefined;
      if (this.isDM(message.conversation_id) && !encryption)
        throw Error(
          "Encrypted DMs require an updated server and a client encryption adapter. No plaintext was sent.",
        );
      const post = (body: string) =>
        unwrap(
          this.http.POST("/api/v1/conversations/{id}/messages", {
            params: { path: { id: message.conversation_id } },
            body: {
              request_id: message.request_id,
              body,
              attachment_ids: message.attachment_ids,
              reply_to_id: message.reply_to_id,
            },
          }),
        );
      let result: Message;
      try {
        result = await post(
          encryption ? await encryption.encode(message) : message.body,
        );
      } catch (error) {
        if (
          encryption &&
          error instanceof APIError &&
          error.code === "dm_epoch_changed"
        )
          result = await post(
            await encryption.encode(message, undefined, true),
          );
        else throw error;
      }
      result = await this.decodeMessage(result);
      await this.store.merge(this.scope, [result]);
      await this.store.removePending(this.scope, message.request_id);
      return result;
    } catch (error) {
      await this.store.putPending(this.scope, {
        ...message,
        error: friendlyError(error),
      });
      throw error;
    } finally {
      this.sending.delete(message.request_id);
      this.changed();
    }
  }
  async discard(id: string) {
    await this.store.removePending(this.scope, id);
    this.changed();
  }
  async edit(message: Message, body: string) {
    const encryption = this.isDM(message.conversation_id)
      ? this.dmEncryption
      : undefined;
    if (this.isDM(message.conversation_id) && !encryption)
      throw Error("Encrypted DM support is required to edit this message");
    const pending: PendingMessage = {
      request_id: this.runtime.randomUUID(),
      conversation_id: message.conversation_id,
      body,
      attachment_ids: message.attachment_ids ?? [],
      reply_to_id: message.reply_to_id ?? undefined,
      created_at: new Date().toISOString(),
    };
    const put = (body: string) =>
      unwrap(
        this.http.PUT("/api/v1/conversations/{id}/messages/{message}", {
          params: {
            path: { id: message.conversation_id, message: message.id },
          },
          body: { body },
        }),
      );
    let result: Message;
    try {
      result = await put(
        encryption ? await encryption.encode(pending, message.id) : body,
      );
    } catch (error) {
      if (
        encryption &&
        error instanceof APIError &&
        error.code === "dm_epoch_changed"
      )
        result = await put(await encryption.encode(pending, message.id, true));
      else throw error;
    }
    await this.store.merge(this.scope, [await this.decodeMessage(result)]);
    this.changed();
  }
  async deleteMessage(message: Message) {
    const result = await unwrap(
      this.http.DELETE("/api/v1/conversations/{id}/messages/{message}", {
        params: { path: { id: message.conversation_id, message: message.id } },
      }),
    );
    await this.store.merge(this.scope, [result]);
    this.changed();
  }
  async createDM(members: string[]) {
    const conversation = await unwrap(
      this.http.POST("/api/v1/dms", { body: { members } }),
    );
    await this.refreshAfterChange();
    return conversation;
  }
  async upload(
    conversation: string,
    file: Blob,
    filename: string,
    signal?: AbortSignal,
  ) {
    const dm = this.isDM(conversation);
    let prepared: Awaited<ReturnType<DMEncryption["prepareImage"]>> | undefined;
    if (dm) {
      if (!this.dmEncryption) throw Error("DM image encryption is unavailable");
      prepared = await this.dmEncryption.prepareImage(
        conversation,
        file,
        filename,
      );
      file = prepared.blob;
      filename = "encrypted-image";
    }
    const limit = dm
      ? this.account.instance.limits.dm!.image_max_bytes
      : file.type.startsWith("image/")
        ? this.account.instance.limits.image_max_bytes
        : file.type.startsWith("video/")
          ? this.account.instance.limits.video_max_bytes
          : 0;
    if (!limit || !file.size || file.size > limit)
      throw Error("Choose an image or video within this server’s size limit.");
    // Uploads are raw binary. OpenAPI describes the media type, not a JSON body.
    const response = await this.runtime.fetch(
      `${this.origin}/api/v1/conversations/${encodeURIComponent(conversation)}/attachments?${new URLSearchParams({ filename, size: String(file.size), ...(dm ? { encrypted: "1" } : {}) })}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.account.login.token}`,
          "Content-Type": "application/octet-stream",
        },
        body: file,
        credentials: "omit",
        redirect: "error",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(540_000)])
          : AbortSignal.timeout(540_000),
      },
    );
    if (!response.ok)
      throw new APIError(response.status, (await response.json()).error);
    const attachment =
      (await response.json()) as import("./types.js").Schemas["AttachmentsAttachment"];
    await prepared?.finish(attachment);
    return attachment;
  }
  async attachment(id: string): Promise<Blob> {
    const response = await this.runtime.fetch(
      `${this.origin}/api/v1/attachments/${encodeURIComponent(id)}`,
      {
        headers: { Authorization: `Bearer ${this.account.login.token}` },
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(60_000),
      },
    );
    if (!response.ok) throw new APIError(response.status, "not_found");
    return response.blob();
  }
  async art(
    kind: "avatar" | "icon" | "banner" | "emoji",
    userID?: string,
    signal?: AbortSignal,
  ): Promise<Blob> {
    const path =
      kind === "emoji"
        ? `/api/v1/emojis/${encodeURIComponent(userID ?? "")}/image`
        : kind === "avatar"
          ? `/api/v1/users/${encodeURIComponent(userID ?? this.account.login.user.id)}/avatar`
          : `/api/v1/instance/${kind}`;
    const response = await this.runtime.fetch(this.origin + path, {
      headers: { Authorization: `Bearer ${this.account.login.token}` },
      credentials: "omit",
      redirect: "error",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new APIError(response.status, "image_unavailable");
    return response.blob();
  }
  async saveEmoji(name: string, image: Blob): Promise<void> {
    const response = await this.runtime.fetch(
      `${this.origin}/api/v1/emojis/${encodeURIComponent(name)}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${this.account.login.token}`,
          "Content-Type": "application/octet-stream",
        },
        body: image,
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(60_000),
      },
    );
    if (!response.ok)
      throw new APIError(response.status, (await response.json()).error);
    await this.refreshAfterChange();
  }
  async deleteEmoji(id: string): Promise<void> {
    await unwrap(
      this.http.DELETE("/api/v1/emojis/{id}", { params: { path: { id } } }),
    );
    await this.refreshAfterChange();
  }
  async saveArt(
    kind: "avatar" | "icon" | "banner",
    image: Blob | null,
  ): Promise<void> {
    const path =
      kind === "avatar" ? "/api/v1/me/avatar" : `/api/v1/instance/${kind}`;
    const response = await this.runtime.fetch(this.origin + path, {
      method: image ? "PUT" : "DELETE",
      headers: {
        Authorization: `Bearer ${this.account.login.token}`,
        "Content-Type": "application/octet-stream",
      },
      body: image,
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok)
      throw new APIError(response.status, (await response.json()).error);
    await this.refreshAfterChange();
  }
  command(
    message: WireEvent,
    reply: string,
    match?: (event: WireEvent) => boolean,
  ) {
    if (!this.events) return Promise.reject(Error("Not connected"));
    return this.events.command(message, reply, match);
  }
  stop() {
    this.readinessAbort?.abort();
    this.presence.clear();
    this.stopped = true;
    this.generation++;
    clearTimeout(this.directoryTimer);
    clearTimeout(this.readTimer);
    this.pendingReads.clear();
    clearTimeout(this.reconnect);
    this.reconnect = undefined;
    clearTimeout(this.refreshTimer);
    this.events?.close();
    for (const fn of this.wireListeners) fn({ type: "connection.lost" });
  }
  async logout() {
    // A failed revocation is reported; do not silently claim the session was revoked.
    await unwrap(this.http.POST("/api/v1/auth/logout"));
    this.stop();
    await this.vault.remove(this.account.instance.instance_id);
  }
  async setRemember(remember: boolean) {
    const previous = this.account.login.session;
    const supported = this.account.instance.capabilities?.includes(
      "sessions.persistent",
    );
    const session = supported
      ? await unwrap(
          this.http.PUT("/api/v1/me/session", { body: { remember } }),
        )
      : previous;
    const next = {
      ...this.account,
      remember,
      login: { ...this.account.login, session },
    };
    try {
      await this.vault.put(next);
    } catch (error) {
      // Keep the previous preference if this device cannot save credentials.
      if (supported)
        await this.http
          .PUT("/api/v1/me/session", {
            body: { remember: previous.expires_at === null },
          })
          .catch(() => {});
      throw error;
    }
    Object.assign(this.account, next);
    this.changed();
  }
}
export class Client {
  readonly instances = new Map<string, InstanceClient>();
  constructor(
    readonly runtime: Runtime,
    readonly store: MessageStore,
    readonly vault: TokenVault,
    readonly knownServers?: KnownServerStore,
  ) {}
  async restore() {
    for (const account of await this.vault.list()) {
      try {
        // A full/blocked profile store must not discard a valid credential.
        await this.knownServers?.put(knownServer(account)).catch(() => {});
        const client = this.attach(account);
        void client.connect();
      } catch {
        await this.vault.remove(account.instance.instance_id);
      }
    }
  }
  /** Exchange a backup credential for this installation's own device session. */
  async restoreAccount(
    source: SavedAccount,
    deviceName: string,
    connect = false,
  ): Promise<void> {
    await this.knownServers?.put(knownServer(source)).catch(() => {});
    const id = source.instance.instance_id;
    if (
      this.instances.get(id)?.snapshot.status !== "signed-out" &&
      this.instances.has(id)
    )
      return;
    if ((await this.vault.list()).some((a) => a.instance.instance_id === id))
      return;
    const instance = await discover(source.origin, this.runtime);
    if (instance.instance_id !== id)
      throw Error(
        "The server identity has changed. Check the address before restoring this account.",
      );
    const login = await unwrap(
      api(source.origin, this.runtime, source.login.token).POST(
        "/api/v1/sessions/restore",
        {
          body: { device_name: deviceName },
          signal: AbortSignal.timeout(15_000),
        },
      ),
    );
    if (
      login.instance_id !== id ||
      login.user.id !== source.login.user.id ||
      login.token === source.login.token ||
      login.session.id === source.login.session.id ||
      login.password_change_required
    )
      throw Error("The server did not create an independent device session.");
    try {
      await this.vault.put({
        origin: source.origin,
        instance,
        login,
        remember: source.remember !== false,
      });
    } catch (error) {
      // Never revoke the source token when a local import fails.
      await api(source.origin, this.runtime, login.token)
        .POST("/api/v1/auth/logout")
        .catch(() => {});
      throw error;
    }
    if (connect) {
      const saved = (await this.vault.list()).find(
        (a) => a.instance.instance_id === id,
      );
      if (!saved) throw Error("The restored account was not saved.");
      await this.attach(saved).connect();
    }
  }
  async login(
    address: string,
    credentials: Credentials,
    register = false,
    expectedInstance?: string,
  ) {
    const invite = parseInviteLink(address);
    if (invite) {
      address = invite.origin;
      credentials = { ...credentials, invitation: invite.token };
      register = true;
    }
    const origin = serverOrigin(address);
    const instance = await discover(origin, this.runtime);
    if (expectedInstance && instance.instance_id !== expectedInstance)
      throw Error(
        "The server identity has changed. Check the address before signing in.",
      );
    const previous = this.instances.get(instance.instance_id);
    if (previous && previous.snapshot.status !== "signed-out")
      throw Error(
        "This server is already connected. Sign out before switching accounts.",
      );
    const http = api(origin, this.runtime);
    const { remember = false, ...ordinary } = credentials;
    const body = instance.capabilities?.includes("sessions.persistent")
      ? { ...ordinary, remember }
      : ordinary;
    const login = await unwrap(
      register
        ? http.POST("/api/v1/auth/register", {
            body: { ...body, invitation: credentials.invitation ?? "" },
          })
        : http.POST("/api/v1/auth/login", { body }),
    ).catch((error: unknown) => {
      // This request has no session: a 401 here rejects the credentials.
      if (
        !register &&
        error instanceof APIError &&
        error.status === 401 &&
        error.code === "unauthorized"
      )
        throw new APIError(401, "invalid_credentials");
      throw error;
    });
    if (login.instance_id !== instance.instance_id)
      throw Error("Server identity changed during sign in.");
    const account = { origin, instance, login, remember };
    // A full/blocked profile store must not discard a valid credential.
    await this.knownServers?.put(knownServer(account)).catch(() => {});
    if (login.password_change_required) {
      throw new PasswordChangeRequired(
        origin,
        login.user.username,
        this.runtime,
        login,
        credentials.password,
        (password) =>
          this.login(
            origin,
            {
              username: login.user.username,
              password,
              device_name: credentials.device_name,
              remember,
            },
            false,
            instance.instance_id,
          ),
      );
    }
    try {
      await this.vault.put(account);
    } catch (error) {
      await api(origin, this.runtime, login.token)
        .POST("/api/v1/auth/logout")
        .catch(() => {});
      throw error;
    }
    const client = this.attach(account);
    await client.connect();
    return client;
  }
  private attach(account: SavedAccount) {
    const id = account.instance.instance_id;
    this.instances.get(id)?.stop();
    const client = new InstanceClient(
      account,
      this.runtime,
      this.store,
      this.vault,
    );
    this.instances.set(id, client);
    return client;
  }
  async logout(id: string) {
    const instance = this.instances.get(id);
    if (!instance) return;
    await instance.logout();
    this.instances.delete(id);
  }
  /** Local removal for revoked sessions; never affects other installations. */
  async forget(id: string) {
    this.instances.get(id)?.stop();
    this.instances.delete(id);
    await this.vault.remove(id);
  }
  stop() {
    for (const instance of this.instances.values()) instance.stop();
  }
}
