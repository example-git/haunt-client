import { KeyframeRequests } from "../packages/browser/src/media/keyframes";
import { describe, it, expect, vi } from "vitest";
import "fake-indexeddb/auto";
import {
  Client,
  APIError,
  friendlyError,
  EventSocket,
  MemoryStore,
  MemoryVault,
  api,
  serverOrigin,
  socketURL,
  type Instance,
  type Message,
  type Runtime,
  type SavedAccount,
  type SocketLike,
  type WireEvent,
  unreadSummary,
} from "@haunt/core";
import { BrowserVault, IndexedDBStore } from "../packages/browser/src/storage";
import { pack, unpack } from "../packages/browser/src/media/framing";
const instance = (id = "one"): Instance => ({
  instance_id: id,
  name: id,
  api_version: "v1",
  public_url: `https://${id}.test`,
  capabilities: [],
  media_transport: "webrtc",
  authentication: {
    scheme: "bearer",
    registration: "invitation",
    session_days: 30,
  },
  limits: {
    text_max_bytes: 256_000_000,
    text_retention_days: 30,
    image_max_bytes: 2 << 20,
    video_max_bytes: 10 << 20,
    attachment_max_bytes: 1 << 30,
    attachment_retention_days: 7,
  },
});
const message = (id: string, seq: number, body = "hello"): Message => ({
  id,
  seq,
  conversation_id: "conversation",
  author_id: "user",
  body,
  created_at: "2026-10-01T00:00:00Z",
  request_id: `request-${id}`,
  attachment_ids: [],
  deleted: false,
});
const account = (id = "one"): SavedAccount => ({
  origin: `https://${id}.test`,
  instance: instance(id),
  login: {
    instance_id: id,
    user: {
      id: "user",
      username: "alice",
      is_owner: false,
      created_at: "2026-10-01T00:00:00Z",
    },
    session: {
      id: "session",
      device_name: "test",
      created_at: "2026-10-01T00:00:00Z",
      expires_at: "2099-01-01T00:00:00Z",
    },
    token: `token-${id}`,
    token_type: "Bearer",
  },
});
class Socket implements SocketLike {
  readyState = 0;
  onopen: SocketLike["onopen"] = null;
  onerror: SocketLike["onerror"] = null;
  onclose: SocketLike["onclose"] = null;
  onmessage: SocketLike["onmessage"] = null;
  commands: WireEvent[] = [];
  constructor(readonly id: string) {
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.({});
    });
  }
  emit(event: WireEvent) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
  send(raw: string) {
    const command = JSON.parse(raw);
    this.commands.push(command);
    queueMicrotask(() =>
      this.emit(
        command.type === "authenticate"
          ? { type: "ready", instance_id: this.id, event_cursor: 400 }
          : command.type === "events.watch"
            ? { type: "events.watching", event_cursor: 400 }
            : command.type === "presence.watch"
              ? { type: "presence.watching" }
              : command.type === "voice.watch"
                ? { type: "voice.watching" }
                : { type: "subscribed", conversations: command.conversations },
      ),
    );
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({});
  }
}
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
function fixture(empty = false, accountFeed = false) {
  const sockets: Socket[] = [],
    requests: Request[] = [],
    sentMessages: Record<string, unknown>[] = [];
  let changedIdentity = false,
    revoked = false,
    failSend = false,
    emojisAvailable = false;
  const runtime: Runtime = {
    randomUUID: () => crypto.randomUUID(),
    socket: (url) => {
      const s = new Socket(new URL(url).hostname.split(".")[0]);
      sockets.push(s);
      return s;
    },
    fetch: vi.fn(async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request);
      const url = new URL(request.url),
        id = url.hostname.split(".")[0],
        path = url.pathname;
      if (path === "/api/v1/instance")
        return response({
          ...instance(changedIdentity ? "replacement" : id),
          capabilities: [
            ...(accountFeed
              ? [
                  "events.account_feed",
                  "messages.read_state",
                  "media.presence",
                  "presence.online",
                ]
              : []),
            ...(emojisAvailable ? ["community.emojis"] : []),
          ],
        });
      if (path === "/api/v1/auth/login") return response(account(id).login);
      if (path === "/api/v1/me" && revoked)
        return response({ error: "unauthorized" }, 401);
      if (path === "/api/v1/me")
        return response({
          user: account(id).login.user,
          permissions: 7,
          session_id: "session",
        });
      if (path === "/api/v1/channels")
        return response({
          channels: empty
            ? []
            : [
                {
                  id: "conversation",
                  kind: "text",
                  name: "general",
                  category_id: null,
                  permissions: 7,
                },
              ],
        });
      if (path === "/api/v1/read-state")
        return response({
          states: [
            {
              kind: "channel",
              conversation_id: "conversation",
              read_seq: 0,
              last_seq: 205,
              unread_count: 7,
              mention_count: 2,
              event_cursor: 400,
            },
          ],
        });
      if (path.endsWith("/read") && request.method === "PUT") {
        const { seq } = await request.json();
        return response({
          kind: "channel",
          conversation_id: "conversation",
          read_seq: seq,
          last_seq: 205,
          unread_count: 0,
          mention_count: 0,
          event_cursor: 405,
        });
      }
      if (path === "/api/v1/categories") return response({ categories: [] });
      if (path === "/api/v1/emojis")
        return response({
          emojis: [
            { id: "emoji-1", name: "wave", version: "v1", animated: false },
          ],
        });
      if (path === "/api/v1/users")
        return response({ users: [account(id).login.user] });
      if (path === "/api/v1/conversations")
        return response({
          conversations: empty ? [] : [{ id: "conversation", kind: "channel" }],
        });
      if (path.endsWith("/messages") && request.method === "GET") {
        const after = Number(url.searchParams.get("after"));
        const messages = Array.from(
          { length: Math.min(100, Math.max(0, 205 - after)) },
          (_, i) => message(String(after + i + 1), after + i + 1),
        );
        return response({
          messages,
          last_seq: 205,
          pruned_through: 0,
          event_cursor: 400 + after,
          gap: false,
        });
      }
      if (path.endsWith("/messages") && request.method === "POST") {
        if (failSend) throw new TypeError("offline");
        const body = await request.json();
        sentMessages.push(body);
        return response(
          {
            ...message("new", 206, body.body),
            request_id: body.request_id,
            reply_to_id: body.reply_to_id,
          },
          201,
        );
      }
      if (path === "/api/v1/auth/logout")
        return new Response(null, { status: 204 });
      return response({ error: "not_found" }, 404);
    }) as typeof fetch,
  };
  return {
    runtime,
    sockets,
    requests,
    sentMessages,
    revoke: () => {
      revoked = true;
    },
    identityChanged: () => {
      changedIdentity = true;
    },
    upgradeEmojis: () => {
      emojisAvailable = true;
    },
    failSend: (v: boolean) => {
      failSend = v;
    },
  };
}
const credentials = {
  username: "alice",
  password: "long passphrase",
  device_name: "test",
};
describe("transport and credential boundaries", () => {
  it("distinguishes rejected login credentials from an expired session", async () => {
    const f = fixture();
    const original = f.runtime.fetch;
    let loginRequest: Request | undefined;
    f.runtime.fetch = async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      if (new URL(request.url).pathname === "/api/v1/auth/login") {
        loginRequest = request;
        return response({ error: "unauthorized" }, 401);
      }
      return original(input, init);
    };
    const client = new Client(f.runtime, new MemoryStore(), new MemoryVault());
    let failure: unknown;
    try {
      await client.login("https://one.test", credentials);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ status: 401, code: "invalid_credentials" });
    expect(friendlyError(failure)).toBe(
      "The username or password is incorrect for this server.",
    );
    expect(loginRequest?.headers.has("Authorization")).toBe(false);
    expect(client.instances.size).toBe(0);
    expect(friendlyError(new APIError(401, "unauthorized"))).toBe(
      "Your session has ended. Sign in again.",
    );
  });

  it("normalizes origins and rejects insecure or decorated addresses", () => {
    expect(serverOrigin("chat.example.com")).toBe("https://chat.example.com");
    expect(serverOrigin("http://127.0.0.1:8181")).toContain(":8181");
    for (const value of [
      "http://example.com",
      "https://a.test/api",
      "https://user:pass@a.test",
      "https://a.test?token=x",
      "file:///tmp",
    ])
      expect(() => serverOrigin(value)).toThrow();
    expect(() =>
      socketURL("https://a.test", "//b.test/api/v1/events"),
    ).toThrow();
    expect(() =>
      socketURL("https://a.test", "/api/v1/events?token=x"),
    ).toThrow();
  });
  it("rejects redirect following and attempts to override the instance base URL", async () => {
    const fetch = vi.fn(async () => response({}));
    const http = api(
      "https://a.test",
      { fetch: fetch as typeof globalThis.fetch },
      "secret",
    );
    await http.GET("/api/v1/instance");
    expect(fetch.mock.calls[0]).toBeDefined();
    const request = (fetch.mock.calls as unknown as [Request][])[0][0];
    expect(request.redirect).toBe("error");
    expect(request.credentials).toBe("omit");
    await expect(
      http.GET("/api/v1/instance", { baseUrl: "https://b.test" }),
    ).rejects.toThrow("Cross-server");
  });
  it("validates installation identity before sending restored credentials", async () => {
    const f = fixture(),
      vault = new MemoryVault();
    await vault.put(account());
    f.identityChanged();
    const client = new Client(f.runtime, new MemoryStore(), vault);
    await client.restore();
    await vi.waitFor(() =>
      expect(client.instances.get("one")?.snapshot.status).toBe("signed-out"),
    );
    expect(f.requests.every((r) => !r.headers.has("Authorization"))).toBe(true);
    expect(await vault.list()).toHaveLength(0);
    client.stop();
  });
  it("loads an upgraded emoji catalog on the first metadata refresh", async () => {
    const f = fixture(),
      client = new Client(f.runtime, new MemoryStore(), new MemoryVault());
    const a = await client.login("https://one.test", credentials);
    expect(a.snapshot.emojis).toEqual([]);
    f.upgradeEmojis();
    await a.refreshAfterChange();
    expect(a.snapshot.emojis.map((e) => e.name)).toEqual(["wave"]);
    expect(
      f.requests.filter((r) => new URL(r.url).pathname === "/api/v1/emojis"),
    ).toHaveLength(1);
    client.stop();
  });
  it("keeps concurrent servers, tokens and logout independent", async () => {
    const f = fixture(),
      client = new Client(f.runtime, new MemoryStore(), new MemoryVault());
    const [a, b] = await Promise.all([
      client.login("https://one.test", credentials),
      client.login("https://two.test", credentials),
    ]);
    expect(a.snapshot.status).toBe("online");
    expect(b.snapshot.status).toBe("online");
    expect(f.sockets).toHaveLength(2);
    for (const r of f.requests.filter((r) => r.headers.has("Authorization")))
      expect(r.headers.get("Authorization")).toBe(
        `Bearer token-${new URL(r.url).hostname.split(".")[0]}`,
      );
    await client.logout("one");
    expect(b.snapshot.status).toBe("online");
    expect(f.sockets[1].readyState).toBe(1);
    client.stop();
  });
});
describe("durable messaging", () => {
  it("keeps readiness and local startup preparation advisory, and does not probe before sign-in", async () => {
    const f = fixture(),
      original = f.runtime.fetch;
    let resolveProbe!: (value: Response) => void;
    f.runtime.fetch = async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      if (new URL(request.url).pathname === "/readyz") {
        expect(request.headers.has("Authorization")).toBe(false);
        return new Promise<Response>((resolve) => {
          resolveProbe = resolve;
        });
      }
      if (new URL(request.url).pathname === "/api/v1/auth/login")
        expect(resolveProbe).toBeUndefined();
      return original(input, init);
    };
    let finishPreparation!: () => void;
    f.runtime.prepareConnection = () =>
      new Promise((resolve) => {
        finishPreparation = resolve;
      });
    const client = new Client(f.runtime, new MemoryStore(), new MemoryVault());
    try {
      const a = await client.login("https://one.test", credentials);
      expect(a.snapshot.status).toBe("online");
      resolveProbe(response({ status: "unavailable" }, 503));
      finishPreparation();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(a.snapshot.status).toBe("online");
      expect(a.snapshot.readiness).toBe("ready");
    } finally {
      client.stop();
    }
  });
  it("refreshes past an in-flight snapshot after a settings mutation", async () => {
    const f = fixture();
    const originalFetch = f.runtime.fetch;
    let pause = false,
      updated = false;
    let release!: () => void;
    let captured!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      captured = resolve;
    });
    f.runtime.fetch = async (...args) => {
      const result = await originalFetch(...args);
      const request =
        args[0] instanceof Request ? args[0] : new Request(args[0]);
      if (new URL(request.url).pathname !== "/api/v1/channels") return result;
      const data = await result.json();
      if (updated) data.channels[0].name = "renamed";
      if (pause) {
        pause = false;
        captured();
        await gate;
      }
      return response(data);
    };
    const client = new Client(f.runtime, new MemoryStore(), new MemoryVault());
    try {
      const a = await client.login("https://one.test", credentials);
      pause = true;
      const stale = a.refresh(false);
      await started;
      updated = true;
      const fresh = a.refreshAfterChange();
      release();
      await Promise.all([stale, fresh]);
      expect(a.snapshot.channels[0].name).toBe("renamed");
    } finally {
      release();
      client.stop();
    }
  });
  it("does not redownload live histories during a directory refresh", async () => {
    const f = fixture(),
      client = new Client(f.runtime, new MemoryStore(), new MemoryVault());
    const a = await client.login("https://one.test", credentials);
    const histories = () =>
      f.requests.filter((r) => new URL(r.url).pathname.endsWith("/messages"))
        .length;
    const count = histories();
    await a.refresh(false);
    expect(histories()).toBe(count);
    await a.refresh();
    expect(histories()).toBe(count + 3);
    client.stop();
  });
  it("uses the ready cursor when no conversations are visible", async () => {
    const f = fixture(true),
      client = new Client(f.runtime, new MemoryStore(), new MemoryVault());
    await client.login("https://one.test", credentials);
    expect(f.sockets[0].commands.at(-1)).toMatchObject({
      type: "subscribe",
      conversations: [],
      after_event: 400,
    });
    client.stop();
  });
  it("recovers an interrupted socket and hides revoked conversations", async () => {
    const f = fixture(),
      client = new Client(f.runtime, new MemoryStore(), new MemoryVault());
    const a = await client.login("https://one.test", credentials);
    f.sockets[0].close();
    expect(a.snapshot.status).toBe("offline");
    await a.connect();
    expect(a.snapshot.status).toBe("online");
    expect(f.sockets).toHaveLength(2);
    f.sockets[1].emit({
      type: "subscription.revoked",
      conversation_id: "conversation",
    });
    expect(a.snapshot.channels).toHaveLength(0);
    expect(a.snapshot.conversations).toHaveLength(0);
    expect(await a.messages("conversation")).toHaveLength(200);
    client.stop();
  });
  it("uses gateway presence without directory fetches, clears stale status and isolates servers", async () => {
    const f = fixture(false, true),
      client = new Client(f.runtime, new MemoryStore(), new MemoryVault());
    const a = await client.login("https://one.test", credentials);
    const b = await client.login("https://two.test", credentials);
    expect(f.sockets[0].commands).toContainEqual({ type: "presence.watch" });
    const requests = f.requests.length;
    f.sockets[0].emit({ type: "presence.snapshot", online_user_ids: ["user"] });
    expect(a.presence.status("user")).toBe("online");
    expect(b.presence.status("user")).toBe("unknown");
    expect(f.requests).toHaveLength(requests);
    f.sockets[0].close();
    expect(a.presence.status("user")).toBe("unknown");
    await a.connect();
    expect(f.sockets[2].commands).toContainEqual({ type: "presence.watch" });
    f.sockets[2].emit({ type: "presence.snapshot", online_user_ids: [] });
    expect(a.presence.status("user")).toBe("offline");
    client.stop();
    expect(a.presence.status("user")).toBe("unknown");
  });
  it("stops reconnecting and removes credentials after session revocation", async () => {
    const f = fixture(),
      vault = new MemoryVault(),
      client = new Client(f.runtime, new MemoryStore(), vault);
    const a = await client.login("https://one.test", credentials);
    f.revoke();
    await a.connect();
    expect(a.snapshot.status).toBe("signed-out");
    expect(await vault.list()).toHaveLength(0);
    expect(f.sockets[0].readyState).toBe(3);
    client.stop();
  });

  it("keeps simultaneous browser vault updates without losing an account", async () => {
    const entries = new Map<string, string>();
    const storage = {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => {
        entries.set(key, value);
      },
    } as Storage;
    const vault = new BrowserVault(storage);
    await Promise.all([vault.put(account("one")), vault.put(account("two"))]);
    expect(await vault.list()).toHaveLength(2);
    await Promise.all([vault.remove("one"), vault.put(account("three"))]);
    expect((await vault.list()).map((a) => a.instance.instance_id)).toEqual([
      "two",
      "three",
    ]);
  });

  for (const durable of [false, true])
    it(`${durable ? "IndexedDB" : "adapter"} preserves retention history, isolates accounts, and never resurrects deletions`, async () => {
      const store = durable
        ? new IndexedDBStore(`test-${crypto.randomUUID()}`)
        : new MemoryStore();
      await store.merge("one", [message("a", 1), message("b", 2)]);
      await store.merge("two", [message("a", 1, "private")]);
      await store.merge("one", [
        { ...message("b", 2, "changed"), edited_at: "2026-10-02T00:00:00Z" },
      ]);
      await store.merge("one", [message("b", 2)]);
      expect((await store.messages("one", "conversation"))[1].body).toBe(
        "changed",
      );
      await store.merge("one", [
        {
          ...message("b", 2, ""),
          deleted: true,
          edited_at: "2026-10-03T00:00:00Z",
        },
      ]);
      await store.merge("one", [message("b", 2, "stale")]);
      expect((await store.messages("one", "conversation"))[1].deleted).toBe(
        true,
      );
      expect((await store.messages("two", "conversation"))[0].body).toBe(
        "private",
      );
      expect(
        (await store.messages("one", "conversation", { limit: 1 }))[0].id,
      ).toBe("b");
      expect(
        (
          await store.messages("one", "conversation", { before: 2, limit: 1 })
        )[0].id,
      ).toBe("a");
      await store.clear("one");
      expect(await store.messages("one", "conversation")).toHaveLength(0);
      expect(await store.messages("two", "conversation")).toHaveLength(1);
      if (store instanceof IndexedDBStore) await store.close();
    });
  it("pages every retained message and subscribes from the earliest snapshot cursor", async () => {
    const f = fixture(),
      client = new Client(f.runtime, new MemoryStore(), new MemoryVault());
    const a = await client.login("https://one.test", credentials);
    expect(await a.messages("conversation", { limit: 300 })).toHaveLength(205);
    expect(f.sockets[0].commands.at(-1)).toMatchObject({
      type: "subscribe",
      after_event: 400,
    });
    f.sockets[0].emit({
      type: "history.pruned",
      id: 800,
      conversation_id: "conversation",
      data: { pruned_through: 100 },
    });
    await vi.waitFor(async () =>
      expect(await a.store.cursor(a.scope)).toBe(800),
    );
    expect(await a.messages("conversation", { limit: 300 })).toHaveLength(205);
    f.sockets[0].emit({
      type: "message.deleted",
      id: 801,
      conversation_id: "conversation",
      data: { ...message("1", 1, ""), deleted: true },
    });
    await vi.waitFor(async () =>
      expect(
        (await a.messages("conversation", { limit: 300 }))[0].deleted,
      ).toBe(true),
    );
    client.stop();
  });
  it("retries uncertain delivery with the original request id and blocks stale retries", async () => {
    const f = fixture(),
      client = new Client(f.runtime, new MemoryStore(), new MemoryVault());
    const a = await client.login("https://one.test", credentials);
    f.failSend(true);
    await expect(
      a.send("conversation", "a draft", [], "original-message"),
    ).rejects.toThrow();
    const [pending] = await a.pending();
    expect(pending.body).toBe("a draft");
    expect(pending.reply_to_id).toBe("original-message");
    f.failSend(false);
    const result = await a.retry(pending);
    expect(result?.request_id).toBe(pending.request_id);
    expect(result?.reply_to_id).toBe("original-message");
    expect(f.sentMessages.at(-1)).toMatchObject({
      reply_to_id: "original-message",
    });
    expect(await a.pending()).toHaveLength(0);
    await expect(
      a.retry({ ...pending, created_at: "2000-01-01T00:00:00Z" }),
    ).rejects.toThrow("too old");
    client.stop();
  });
  it("bounds socket commands and rejects waiters when stopped", async () => {
    const runtime: Runtime = {
      fetch,
      randomUUID: () => "",
      socket: () => new Socket("one"),
    };
    const events = new EventSocket(runtime, "wss://one.test/api/v1/events");
    await events.open("secret", "one");
    const pending = events.command({ type: "media.join" }, "media.joined");
    const rejected = expect(pending).rejects.toThrow();
    await Promise.resolve();
    events.close();
    await rejected;
  });
});
describe("encoded media framing", () => {
  it("round-trips publisher-prefixed packets using big endian fields", () => {
    const packet = {
      purpose: "camera" as const,
      revision: 42,
      sequence: 0xffffffff,
      timestamp: 2 ** 40,
      duration: 41667,
      key: true,
      data: new Uint8Array([7, 8, 9]),
    };
    const out = pack(packet),
      frame = new Uint8Array(out.length + 16);
    frame.fill(1, 0, 16);
    frame.set(out, 16);
    expect(unpack(frame.buffer)).toEqual({
      ...packet,
      publisher: "01010101-0101-0101-0101-010101010101",
    });
  });
  it("rejects malformed, oversized and unsafe-timestamp input", () => {
    const packet = {
      purpose: "audio" as const,
      revision: 1,
      sequence: 0,
      timestamp: 0,
      duration: 20000,
      key: true,
      data: new Uint8Array(2),
    };
    expect(() =>
      pack({ ...packet, timestamp: Number.MAX_SAFE_INTEGER + 1 }),
    ).toThrow();
    expect(() => pack({ ...packet, data: new Uint8Array(65536) })).toThrow();
    expect(() => unpack(new ArrayBuffer(40))).toThrow();
    const out = new Uint8Array(42);
    out[16] = 2;
    expect(() => unpack(out.buffer)).toThrow();
  });
});

describe("keyframe recovery pressure", () => {
  it("keeps a crowded room inside the media socket control budget", () => {
    vi.useFakeTimers();
    try {
      const send = vi.fn();
      const queue = new KeyframeRequests(send);
      for (let i = 0; i < 30; i++) {
        queue.request(String(i), "camera");
        queue.request(String(i), "camera");
      }
      vi.advanceTimersByTime(5000);
      expect(send.mock.calls.length).toBeGreaterThan(0);
      expect(send.mock.calls.length).toBeLessThanOrEqual(10);
      expect(new Set(send.mock.calls.map((c) => c[0])).size).toBe(
        send.mock.calls.length,
      );
      queue.remove("29");
      queue.satisfied("28", "camera");
      queue.close();
      const count = send.mock.calls.length;
      vi.advanceTimersByTime(30000);
      expect(send).toHaveBeenCalledTimes(count);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("notification history recovery", () => {
  it("only announces unseen creations during the current online session", async () => {
    const f = fixture(),
      store = new MemoryStore(),
      client = new Client(f.runtime, store, new MemoryVault());
    try {
      const a = await client.login("https://one.test", credentials);
      const received: WireEvent[] = [];
      a.onWire((event) => {
        if (event.type === "message.discovered") received.push(event);
      });
      const original = f.runtime.fetch;
      let rows = [
        { ...message("old-unseen", 206), author_id: "other" },
        {
          ...message("fresh", 207),
          author_id: "other",
          created_at: new Date(Date.now() + 1000).toISOString(),
        },
        {
          ...message("edited-unseen", 208),
          author_id: "other",
          created_at: new Date(Date.now() + 1000).toISOString(),
          edited_at: new Date().toISOString(),
        },
      ];
      f.runtime.fetch = async (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
        );
        if (url.pathname.endsWith("/messages"))
          return response({ messages: rows, event_cursor: 900 });
        return original(input, init);
      };
      await a.syncHistory("conversation");
      expect(received.map((e) => (e.data as Message).id)).toEqual(["fresh"]);
      await a.syncHistory("conversation");
      expect(received).toHaveLength(1);
      a.snapshot = { ...a.snapshot, status: "syncing" };
      rows = [
        {
          ...message("during-reconnect", 209),
          created_at: new Date(Date.now() + 1000).toISOString(),
        },
      ];
      await a.syncHistory("conversation");
      expect(received).toHaveLength(1);
    } finally {
      client.stop();
    }
  });
});

describe("lightweight account gateway", () => {
  it.each([true, false])(
    "restores the latest voice roster subscription when foreground becomes %s during sync",
    async (foreground) => {
      const f = fixture(false, true),
        client = new Client(f.runtime, new MemoryStore(), new MemoryVault());
      let release = () => {};
      try {
        const current = await client.login("https://one.test", credentials);
        current.setForeground(!foreground);
        const refresh = current.refresh.bind(current);
        let entered = () => {};
        const started = new Promise<void>((resolve) => {
          entered = resolve;
        });
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        vi.spyOn(current, "refresh").mockImplementationOnce(async () => {
          entered();
          await gate;
          return refresh();
        });
        const connecting = current.connect();
        await started;
        expect(current.snapshot.status).toBe("syncing");
        current.setForeground(foreground);
        release();
        await connecting;
        const commands = f.sockets
          .at(-1)!
          .commands.filter((c) => c.type === "voice.watch");
        expect(commands).toEqual(
          foreground ? [{ type: "voice.watch", enabled: true }] : [],
        );
        expect(current.snapshot.status).toBe("online");
      } finally {
        release();
        client.stop();
      }
    },
  );
  it("uses one socket per server, no background histories or periodic HTTP, and watches voice only for the foreground server", async () => {
    vi.useFakeTimers();
    const f = fixture(false, true),
      client = new Client(f.runtime, new MemoryStore(), new MemoryVault());
    try {
      const clients = await Promise.all(
        ["one", "two", "three", "four"].map(async (id) => {
          return client.login(`https://${id}.test`, credentials);
        }),
      );
      expect(f.sockets).toHaveLength(4);
      expect(
        f.requests.filter((r) => r.url.includes("/messages")),
      ).toHaveLength(0);
      for (const socket of f.sockets)
        expect(socket.commands.map((c) => c.type)).toEqual([
          "authenticate",
          "presence.watch",
          "events.watch",
        ]);
      const before = f.requests.length;
      await vi.advanceTimersByTimeAsync(120000);
      expect(f.requests).toHaveLength(before);
      clients[0].setForeground(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(f.sockets[0].commands.at(-1)).toMatchObject({
        type: "voice.watch",
        enabled: true,
      });
      clients[0].setForeground(false);
      await vi.advanceTimersByTimeAsync(0);
      expect(f.sockets[0].commands.at(-1)).toMatchObject({
        type: "voice.watch",
        enabled: false,
      });
      await clients[0].selectConversation("conversation");
      expect(
        f.requests.filter((r) => r.url.includes("/messages")),
      ).toHaveLength(3);
      expect(clients[0].snapshot.readStates.conversation.unread_count).toBe(7);
    } finally {
      client.stop();
      vi.useRealTimers();
    }
  });
  it("persists checkpoints after message writes, restores cursors and ignores stale read snapshots", async () => {
    const f = fixture(false, true),
      store = new MemoryStore(),
      client = new Client(f.runtime, store, new MemoryVault());
    try {
      const c = await client.login("https://one.test", credentials);
      f.sockets[0].emit({
        type: "message.created",
        id: 401,
        conversation_id: "conversation",
        data: message("fresh", 206),
      });
      f.sockets[0].emit({ type: "events.checkpoint", event_cursor: 405 });
      await vi.waitFor(async () =>
        expect(await store.cursor(c.scope)).toBe(405),
      );
      expect((await c.messages("conversation"))[0].id).toBe("fresh");
      const state = {
        ...c.snapshot.readStates.conversation,
        read_seq: 200,
        unread_count: 1,
        event_cursor: 405,
      };
      f.sockets[0].emit({ type: "read.state", states: [state] });
      f.sockets[0].emit({
        type: "read.state",
        states: [
          { ...state, read_seq: 0, unread_count: 99, event_cursor: 406 },
        ],
      });
      expect(c.snapshot.readStates.conversation.unread_count).toBe(1);
      await c.connect();
      expect(
        f.sockets[1].commands.find((c) => c.type === "events.watch")
          ?.after_event,
      ).toBe(405);
      expect(c.snapshot.readStates.conversation.read_seq).toBe(200);
    } finally {
      client.stop();
    }
  });
  it("coalesces viewed read acknowledgements without treating downloads as reads", async () => {
    vi.useFakeTimers();
    const f = fixture(false, true),
      client = new Client(f.runtime, new MemoryStore(), new MemoryVault());
    try {
      const c = await client.login("https://one.test", credentials);
      await c.selectConversation("conversation");
      expect(f.requests.filter((r) => r.method === "PUT")).toHaveLength(0);
      for (let seq = 1; seq <= 205; seq++) c.markRead("conversation", seq);
      await vi.advanceTimersByTimeAsync(501);
      const writes = f.requests.filter((r) => r.method === "PUT");
      expect(writes).toHaveLength(1);
      expect(c.snapshot.readStates.conversation.read_seq).toBe(205);
      expect(unreadSummary(c.snapshot.readStates)).toEqual({
        count: 0,
        unread: false,
      });
      c.markRead("conversation", 204);
      await vi.advanceTimersByTimeAsync(1000);
      expect(f.requests.filter((r) => r.method === "PUT")).toHaveLength(1);
    } finally {
      client.stop();
      vi.useRealTimers();
    }
  });
});
