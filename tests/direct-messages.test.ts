import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import {
  type InstanceClient,
  type Message,
  type Snapshot,
  encryptBackup,
  decryptBackup,
} from "@haunt/core";
import { IndexedDBStore } from "../packages/browser/src/storage";
import {
  DirectMessageDirectory,
  dmKey,
  dmPreview,
  sortDMs,
} from "../packages/browser/src/direct-messages";

const message = (body: string, seq = 1): Message => ({
  id: `m${seq}`,
  conversation_id: "dm",
  author_id: "peer",
  body,
  seq,
  created_at: `2026-10-12T12:00:0${seq}Z`,
  request_id: `r${seq}`,
  attachment_ids: [],
  deleted: false,
});
function account(server: string, owner = "me") {
  const listeners = new Set<() => void>();
  const instance = {
    scope: JSON.stringify([server, owner]),
    origin: `https://${server}.test`,
    account: {
      instance: { name: server, instance_id: server },
      login: { user: { id: owner } },
    },
    snapshot: {
      status: "online",
      conversations: [{ id: "dm", kind: "dm", members: [owner, "peer"] }],
      users: [{ id: "peer", username: "alice", display_name: "Alice" }],
      readStates: {},
      voiceRooms: {},
      revision: 0,
    } as unknown as Snapshot,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  } as unknown as InstanceClient;
  return {
    instance,
    change: (patch: Partial<Snapshot>) => {
      instance.snapshot = { ...instance.snapshot, ...patch };
      listeners.forEach((fn) => fn());
    },
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("uses scoped cached previews, updates edits/deletions after commit, and survives reopening IndexedDB", async () => {
  const name = `dm-${crypto.randomUUID()}`;
  let store = new IndexedDBStore(name);
  const a = account("one"),
    b = account("two"),
    c = account("one", "another-account");
  await store.merge(a.instance.scope, [message("first"), message("newest", 2)]);
  await store.merge(b.instance.scope, [message("other server")]);
  await store.merge(c.instance.scope, [message("other account")]);
  await store.close();
  store = new IndexedDBStore(name);
  const directory = new DirectMessageDirectory();
  const lookup = vi.spyOn(store, "latestMessages");
  const stop = directory.start([a.instance, b.instance, c.instance], store);
  try {
    await vi.waitFor(() =>
      expect(directory.getSnapshot().map((e) => e.latest?.body)).toEqual([
        "newest",
        "other server",
        "other account",
      ]),
    );
    expect(new Set(directory.getSnapshot().map((e) => e.key)).size).toBe(3);
    expect(directory.getSnapshot()[0].address).toBe("alice@one.test");
    const reads = lookup.mock.calls.length;
    a.change({ revision: 500, voiceRooms: {} });
    await new Promise((r) => setTimeout(r, 10));
    expect(lookup).toHaveBeenCalledTimes(reads);
    await store.merge(a.instance.scope, [
      { ...message("edited", 2), edited_at: "2026-10-12T13:00:00Z" },
    ]);
    await vi.waitFor(() =>
      expect(directory.getSnapshot()[0].latest?.body).toBe("edited"),
    );
    await store.merge(a.instance.scope, [{ ...message("", 2), deleted: true }]);
    await store.merge(a.instance.scope, [message("stale", 2)]);
    await vi.waitFor(() =>
      expect(dmPreview(directory.getSnapshot()[0].latest)).toBe(
        "Message deleted",
      ),
    );
    await store.clear(a.instance.scope);
    await vi.waitFor(() =>
      expect(directory.getSnapshot()[0].latest).toBeUndefined(),
    );
    expect(directory.getSnapshot()[1].latest?.body).toBe("other server");
    a.change({ users: [] });
    expect(directory.getSnapshot().some((e) => e.instance === a.instance)).toBe(
      false,
    );
    b.change({ status: "signed-out" });
    expect(directory.getSnapshot().map((e) => e.instance)).toEqual([
      c.instance,
    ]);
  } finally {
    stop();
    await store.close();
  }
});

it("does not resurrect a removed conversation when an outstanding cache lookup finishes", async () => {
  const a = account("one");
  let finish!: (value: Map<string, Message>) => void;
  const directory = new DirectMessageDirectory();
  const stop = directory.start([a.instance], {
    subscribeMessages: () => () => {},
    latestMessages: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  await vi.waitFor(() => expect(finish).toBeDefined());
  a.change({ conversations: [] });
  finish(new Map([["dm", message("private")]]));
  await new Promise((r) => setTimeout(r, 10));
  expect(directory.getSnapshot()).toEqual([]);
  stop();
});

it("favorites are account scoped, ordered first, persisted and included in encrypted settings backups", async () => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
  });
  const prefs = await import("../packages/browser/src/preferences");
  const a = account("one"),
    b = account("two");
  const directory = new DirectMessageDirectory();
  const store = new IndexedDBStore(`dm-${crypto.randomUUID()}`);
  await store.merge(a.instance.scope, [message("new", 2)]);
  await store.merge(b.instance.scope, [message("old", 1)]);
  const stop = directory.start([a.instance, b.instance], store);
  try {
    await vi.waitFor(() =>
      expect(directory.getSnapshot().every((e) => e.latest)).toBe(true),
    );
    const key = dmKey(b.instance.scope, "dm");
    prefs.setPreferences({ dmFavorites: { [key]: true } });
    expect(
      sortDMs(directory.getSnapshot(), prefs.getPreferences().dmFavorites)[0]
        .instance,
    ).toBe(b.instance);
    const backup = {
      version: 1 as const,
      createdAt: new Date().toISOString(),
      accounts: [],
      servers: [],
      preferences: Object.fromEntries(storage),
    };
    const restored = await decryptBackup(
      await encryptBackup(backup, "backup passphrase"),
      "backup passphrase",
    );
    expect(
      JSON.parse(restored.preferences["chatxo-client-preferences-v1"])
        .dmFavorites,
    ).toEqual({ [key]: true });
    vi.resetModules();
    const reopened = await import("../packages/browser/src/preferences");
    expect(reopened.getPreferences().dmFavorites).toEqual({ [key]: true });
    expect(dmPreview({ ...message(""), attachment_ids: ["file"] })).toBe(
      "Attachment",
    );
  } finally {
    stop();
    await store.close();
  }
});
