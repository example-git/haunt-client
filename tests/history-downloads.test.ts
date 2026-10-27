import "fake-indexeddb/auto";
import { openDB } from "idb";
import { expect, it, vi } from "vitest";
import {
  ArchiveBudget,
  InstanceClient,
  MemoryStore,
  MemoryVault,
  type Message,
  type SavedAccount,
} from "@haunt/core";
import { IndexedDBStore } from "../packages/browser/src/storage";

const message = (id: string, seq: number, body: string): Message => ({
  id,
  seq,
  body,
  conversation_id: "room",
  author_id: "author",
  request_id: id,
  attachment_ids: [],
  created_at: "2026-10-26T00:00:00Z",
  deleted: false,
});

it("paces archive bytes and request count across jobs and recovers after cancellation", async () => {
  vi.useFakeTimers();
  try {
    const budget = new ArchiveBudget(() => ({
      automatic: true,
      bytesPerSecond: 1024,
      requestsPerMinute: 120,
    }));
    const starts: number[] = [];
    const task = (bytes: number) => async () => {
      starts.push(Date.now());
      return { value: true, bytes };
    };
    await budget.run(new AbortController().signal, () => true, task(4096));
    const cancelled = new AbortController();
    const second = budget.run(cancelled.signal, () => true, task(1));
    const rejection = expect(second).rejects.toMatchObject({
      name: "AbortError",
    });
    cancelled.abort();
    await rejection;
    const third = budget.run(new AbortController().signal, () => true, task(1));
    await vi.advanceTimersByTimeAsync(3999);
    expect(starts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await third;
    expect(starts[1] - starts[0]).toBe(4000);
    const fourth = budget.run(
      new AbortController().signal,
      () => true,
      task(1),
    );
    await vi.advanceTimersByTimeAsync(500);
    await fourth;
    expect(starts[2] - starts[1]).toBe(500);
  } finally {
    vi.useRealTimers();
  }
});

for (const durable of [false, true])
  it(`${durable ? "IndexedDB" : "memory"} searches local words with account isolation, pagination, edits and deletion`, async () => {
    const store = durable
      ? new IndexedDBStore(`search-${crypto.randomUUID()}`)
      : new MemoryStore();
    try {
      await store.merge("account", [
        message("1", 1, "Café launch plan"),
        message("2", 2, "LAUNCH plan"),
        message("3", 3, "launch other"),
        { ...message("4", 4, "secret launch plan"), conversation_id: "other" },
        { ...message("5", 5, "launch plan"), security: "pending" },
      ]);
      await store.merge("other-account", [message("6", 6, "launch plan")]);
      const page = await store.search("account", "room", "launch plan", {
        limit: 1,
      });
      expect(page.messages.map((m) => m.id)).toEqual(["2"]);
      expect(page.hasMore).toBe(true);
      expect(
        (
          await store.search("account", "room", "launch plan", { before: 2 })
        ).messages.map((m) => m.id),
      ).toEqual(["1"]);
      expect(
        (await store.search("account", "room", "Cafe\u0301")).messages.map(
          (m) => m.id,
        ),
      ).toEqual(["1"]);
      await store.merge("account", [
        {
          ...message("2", 2, "replacement"),
          edited_at: "2026-10-26T01:00:00Z",
        },
        { ...message("1", 1, "launch plan"), deleted: true },
      ]);
      expect(
        (await store.search("account", "room", "launch plan")).messages,
      ).toEqual([]);
      expect(
        (await store.search("account", "room", "replacement")).messages.map(
          (m) => m.id,
        ),
      ).toEqual(["2"]);
      await store.clear("account");
      expect(
        (await store.search("account", "room", "replacement")).messages,
      ).toEqual([]);
      expect(
        (await store.search("other-account", "room", "launch plan")).messages,
      ).toHaveLength(1);
    } finally {
      if (store instanceof IndexedDBStore) await store.close();
    }
  });

it("indexes an existing version-one archive without redownloading and persists that index", async () => {
  const name = `old-search-${crypto.randomUUID()}`;
  const db = await openDB(name, 1, {
    upgrade(db) {
      const messages = db.createObjectStore("messages", {
        keyPath: ["scope", "id"],
      });
      messages.createIndex("conversation", ["scope", "conversation_id", "seq"]);
      messages.createIndex("scope", "scope");
      db.createObjectStore("cursors");
      db.createObjectStore("pending", {
        keyPath: ["scope", "request_id"],
      }).createIndex("scope", "scope");
    },
  });
  await db.put("messages", {
    ...message("old", 20, "Archived discovery"),
    scope: "account",
  });
  db.close();
  let store = new IndexedDBStore(name);
  expect(
    (await store.search("account", "room", "discovery")).messages.map(
      (m) => m.id,
    ),
  ).toEqual(["old"]);
  await store.close();
  store = new IndexedDBStore(name);
  const progress = vi.fn();
  expect(
    (
      await store.search("account", "room", "discovery", {
        onProgress: progress,
      })
    ).messages,
  ).toHaveLength(1);
  expect(progress).toHaveBeenLastCalledWith(0);
  await store.close();
});

it("reuses a previously downloaded history range instead of fetching it again", async () => {
  const fetch = vi.fn(async () =>
    Response.json({
      messages: Array.from({ length: 100 }, (_, i) =>
        message(String(i + 100), i + 100, "local"),
      ),
      has_more: true,
      last_seq: 500,
      event_cursor: 500,
      next_change: 500,
      pruned_through: 0,
      gap: false,
    }),
  );
  const client = new InstanceClient(
    {
      origin: "https://server.test",
      instance: {
        instance_id: "instance",
        capabilities: ["messages.history_pages.v1"],
      },
      login: { token: "test", user: { id: "me" } },
    } as SavedAccount,
    { fetch, socket: vi.fn(), randomUUID: () => crypto.randomUUID() },
    new MemoryStore(),
    new MemoryVault(),
  );
  const merge = vi.spyOn(client.store, "merge");
  merge.mockRejectedValueOnce(Error("Storage full"));
  await expect(client.loadOlder("room", 200)).rejects.toThrow("Storage full");
  await client.loadOlder("room", 200);
  await client.loadOlder("room", 200);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(
    (await client.messages("room", { before: 200 })).map((m) => m.seq),
  ).toHaveLength(100);
  await client.store.clear(client.scope);
  await client.loadOlder("room", 200);
  expect(fetch).toHaveBeenCalledTimes(3);
  client.stop();
});

for (const durable of [false, true])
  it(`${durable ? "IndexedDB" : "memory"} retains newer cached history when downloading an uncached older page`, async () => {
    const store = durable
      ? new IndexedDBStore(`history-ranges-${crypto.randomUUID()}`)
      : new MemoryStore();
    const fetch = vi.fn(async (request: RequestInfo | URL) => {
      const url = request instanceof Request ? request.url : String(request);
      const before = Number(new URL(url).searchParams.get("before"));
      return Response.json({
        messages: Array.from({ length: 100 }, (_, i) =>
          message(String(before - 100 + i), before - 100 + i, "local"),
        ),
        has_more: true,
        last_seq: 299,
        event_cursor: 0,
        next_change: 0,
        pruned_through: 0,
        gap: false,
      });
    });
    const client = new InstanceClient(
      {
        origin: "https://server.test",
        instance: {
          instance_id: "instance",
          capabilities: ["messages.history_pages.v1"],
        },
        login: { token: "test", user: { id: "me" } },
      } as SavedAccount,
      { fetch, socket: vi.fn(), randomUUID: () => crypto.randomUUID() },
      store,
      new MemoryVault(),
    );
    try {
      await client.loadOlder("room", 300);
      await client.loadOlder("room", 200);
      expect(fetch).toHaveBeenCalledTimes(2);
      const page = await client.loadOlder("room", 300);
      expect(page?.messages.map((m) => m.seq)).toEqual(
        Array.from({ length: 100 }, (_, i) => i + 200),
      );
      expect(fetch).toHaveBeenCalledTimes(2);
      await store.clear(client.scope);
      await client.loadOlder("room", 300);
      expect(fetch).toHaveBeenCalledTimes(3);
    } finally {
      client.stop();
      if (store instanceof IndexedDBStore) await store.close();
    }
  });

it("cancels queued archive work while another download waits for availability", async () => {
  const budget = new ArchiveBudget();
  const first = new AbortController(),
    second = new AbortController();
  const task = vi.fn(async () => ({ value: true, bytes: 1 }));
  const waiting = budget.run(first.signal, () => false, task);
  const waitingRejection = expect(waiting).rejects.toMatchObject({
    name: "AbortError",
  });
  const queued = budget.run(second.signal, () => true, task);
  const queuedRejection = expect(queued).rejects.toMatchObject({
    name: "AbortError",
  });
  second.abort();
  await queuedRejection;
  expect(task).not.toHaveBeenCalled();
  first.abort();
  await waitingRejection;
});

it("charges server-busy archive retries to the request budget and pauses them", async () => {
  vi.useFakeTimers();
  const starts: number[] = [];
  let client: InstanceClient | undefined;
  try {
    const fetch = vi.fn(async () => {
      starts.push(Date.now());
      return Response.json(
        { error: "busy" },
        { status: 503, headers: { "Retry-After": "1" } },
      );
    });
    client = new InstanceClient(
      {
        origin: "https://server.test",
        instance: {
          instance_id: "instance",
          capabilities: ["messages.history_pages.v1"],
        },
        login: { token: "test", user: { id: "me" } },
      } as SavedAccount,
      {
        fetch,
        socket: vi.fn(),
        randomUUID: () => crypto.randomUUID(),
        archiveBudget: new ArchiveBudget(() => ({
          automatic: true,
          bytesPerSecond: 65536,
          requestsPerMinute: 6,
        })),
      },
      new MemoryStore(),
      new MemoryVault(),
    );
    await client.selectConversation("room");
    client.snapshot = {
      ...client.snapshot,
      status: "online",
      readStates: { room: { last_seq: 500 } as never },
    };
    await client.resumeArchive("room");
    await vi.advanceTimersByTimeAsync(9999);
    expect(starts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(starts).toHaveLength(2);
    expect(starts[1] - starts[0]).toBe(10000);
    await client.pauseArchive("room");
    await vi.advanceTimersByTimeAsync(20000);
    expect(starts).toHaveLength(2);
    expect(client.snapshot.archives?.room.state).toBe("paused");
  } finally {
    client?.stop();
    vi.useRealTimers();
  }
});
