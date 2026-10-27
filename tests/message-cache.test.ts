import "fake-indexeddb/auto";
import { openDB } from "idb";
import { expect, it, vi } from "vitest";
import {
  InstanceClient,
  MemoryStore,
  unpackTextChunk,
  MemoryVault,
  cachedMessage,
  type DMEncryption,
  type Message,
  type Runtime,
  type SavedAccount,
} from "@haunt/core";
import { IndexedDBStore } from "../packages/browser/src/storage";
import {
  DirectMessageDirectory,
  dmPreview,
} from "../packages/browser/src/direct-messages";

const wire =
  '!haunt-mls-v1!{"device":"device","revision":1,"data":"ciphertext"}';
const raw = (body = wire): Message => ({
  id: "message",
  conversation_id: "dm",
  author_id: "peer",
  request_id: "request",
  created_at: "2026-10-12T12:00:00Z",
  seq: 1,
  deleted: false,
  attachment_ids: ["image"],
  body,
});
for (const kind of ["memory", "indexeddb"]) {
  it(`${kind} resolves old replies by ID within the account and conversation, including encrypted edits and deletion`, async () => {
    const store =
      kind === "memory"
        ? new MemoryStore()
        : new IndexedDBStore(`reply-cache-${crypto.randomUUID()}`);
    const instance = client(store, async (message) => ({
      ...message,
      body: "Decrypted reply target",
      security: "encrypted",
    }));
    try {
      await store.merge(instance.scope, [
        raw(),
        ...Array.from({ length: 105 }, (_, i) => ({
          ...raw("Newer message"),
          id: `newer-${i}`,
          seq: i + 2,
        })),
      ]);
      expect(
        (await instance.messages("dm", { limit: 100 })).some(
          (message) => message.id === "message",
        ),
      ).toBe(false);
      expect(
        await instance.message("other-conversation", "message"),
      ).toBeUndefined();
      expect(
        await store.message("other-account", "dm", "message"),
      ).toBeUndefined();
      expect(await instance.message("dm", "message")).toMatchObject({
        body: "Decrypted reply target",
        security: "encrypted",
      });
      if (store instanceof IndexedDBStore)
        expect(
          (
            await Promise.all(
              (await store.textArchiveChunks()).map(unpackTextChunk),
            )
          )
            .flat()
            .find((m) => m.id === "message")?.body,
        ).toBe("Decrypted reply target");
      await store.merge(instance.scope, [
        { ...raw("Edited target"), edited_at: "2026-10-12T12:01:00Z" },
      ]);
      expect((await instance.message("dm", "message"))?.body).toBe(
        "Edited target",
      );
      await store.merge(instance.scope, [{ ...raw(), deleted: true }]);
      expect(await instance.message("dm", "message")).toMatchObject({
        deleted: true,
        body: "",
      });
    } finally {
      if (store instanceof IndexedDBStore) await store.close();
    }
  });
}
function client(
  store: MemoryStore | IndexedDBStore,
  decode: DMEncryption["decode"],
) {
  const account = {
    origin: "https://server.test",
    instance: {
      instance_id: "server",
      name: "Server",
      capabilities: ["dms.mls.v1"],
    },
    login: { user: { id: "me" }, token: "test" },
  } as SavedAccount;
  const runtime = {
    dmEncryption: () => ({ decode }),
    fetch: vi.fn(),
    socket: vi.fn(),
    randomUUID: () => crypto.randomUUID(),
  } as unknown as Runtime;
  const instance = new InstanceClient(
    account,
    runtime,
    store,
    new MemoryVault(),
  );
  instance.snapshot = {
    ...instance.snapshot,
    status: "online",
    conversations: [{ id: "dm", kind: "dm", members: ["me", "peer"] } as any],
    users: [{ id: "peer", username: "peer" } as any],
  };
  return instance;
}
async function seedOldCache(name: string, scope: string) {
  // Bypass today's merge rules, as an already-installed older client did.
  const db = await openDB(name);
  await db.put("messages", { ...raw(), scope });
  db.close();
}

it("never renders an old IndexedDB wire row and repairs it from the DM preview without clearing history", async () => {
  const name = `message-cache-${crypto.randomUUID()}`;
  let store = new IndexedDBStore(name);
  await store.close();
  const scope = JSON.stringify(["server", "me"]);
  await seedOldCache(name, scope);
  store = new IndexedDBStore(name);
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const decode = vi.fn(async (message: Message): Promise<Message> => {
    await gate;
    expect(message.body).toBe(wire);
    expect(message.attachment_ids).toEqual(["image"]);
    return { ...message, body: "Readable text", security: "encrypted" };
  });
  const instance = client(store, decode);
  expect((await store.messages(scope, "dm"))[0]).toMatchObject({
    body: "Decrypting message…",
    security: "pending",
    attachment_ids: [],
  });
  expect(dmPreview(raw())).toBe("Decrypting message…");
  const directory = new DirectMessageDirectory();
  const stop = directory.start([instance], store);
  try {
    await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(1));
    expect(
      directory
        .getSnapshot()
        .some((entry) => entry.latest?.body.includes("ciphertext")),
    ).toBe(false);
    finish();
    await vi.waitFor(() =>
      expect(directory.getSnapshot()[0].latest?.body).toBe("Readable text"),
    );
    expect((await instance.messages("dm"))[0].security).toBe("encrypted");
    await store.close();
    const reopened = new IndexedDBStore(name);
    expect((await reopened.messages(scope, "dm"))[0].body).toBe(
      "Readable text",
    );
    await reopened.close();
    expect(decode).toHaveBeenCalledTimes(1);
  } finally {
    finish();
    stop();
    await store.close();
  }
});

it("preserves decoded text against equal-revision replay and failed decoding but accepts real edits and tombstones", async () => {
  const store = new MemoryStore();
  const instance = client(store, async (m) => ({
    ...m,
    body: "Decoded",
    security: "encrypted",
  }));
  await store.merge(instance.scope, [raw()]);
  expect((await instance.messages("dm"))[0].body).toBe("Decoded");
  await store.merge(instance.scope, [
    raw(),
    { ...raw("Unavailable"), security: "unavailable", displayVersion: 1 },
  ]);
  expect((await instance.messages("dm"))[0].body).toBe("Decoded");
  const edited = {
    ...raw('!haunt-mls-v1!{"data":"edited"}'),
    edited_at: "2026-10-12T12:01:00Z",
  };
  await store.merge(instance.scope, [edited]);
  expect((await store.messages(instance.scope, "dm"))[0].security).toBe(
    "pending",
  );
  expect((await instance.messages("dm"))[0].body).toBe("Decoded");
  await store.merge(instance.scope, [{ ...edited, deleted: true }]);
  await store.merge(instance.scope, [edited]);
  expect((await instance.messages("dm"))[0]).toMatchObject({
    body: "",
    deleted: true,
    attachment_ids: [],
  });
});

it("does not let a slow cache decrypt overwrite an edit that arrived during it", async () => {
  const store = new MemoryStore();
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const instance = client(store, async (m) => {
    await gate;
    return { ...m, body: "Old decoded text", security: "encrypted" };
  });
  await store.merge(instance.scope, [raw()]);
  const read = instance.messages("dm");
  await store.merge(instance.scope, [
    {
      ...raw("New decoded edit"),
      edited_at: "2026-10-12T12:01:00Z",
      security: "encrypted",
      displayVersion: 1,
    },
  ]);
  finish();
  expect((await read)[0].body).toBe("New decoded edit");
});

it("keeps unavailable and unknown formats out of plaintext while preserving genuine legacy text and quoted envelopes", async () => {
  const store = new MemoryStore();
  const decode = vi.fn(async (m: Message): Promise<Message> => ({
    ...m,
    body: "Encrypted message unavailable on this device",
    attachment_ids: [],
    security: "unavailable",
  }));
  const instance = client(store, decode);
  await store.merge(instance.scope, [raw()]);
  expect((await instance.messages("dm"))[0].security).toBe("unavailable");
  await store.merge(instance.scope, [raw()]);
  expect((await instance.messages("dm"))[0].body).not.toContain("ciphertext");
  expect(decode).toHaveBeenCalledTimes(1);
  await store.merge(instance.scope, [
    { ...raw('!haunt-mls-v9!{"data":"future"}'), id: "future", seq: 2 },
  ]);
  expect((await instance.messages("dm"))[1].body).toMatch(/Update your client/);
  expect(decode).toHaveBeenCalledTimes(1);
  expect(cachedMessage(raw("Old plaintext")).body).toBe("Old plaintext");
  expect(cachedMessage({ ...raw(), security: "encrypted" }).body).toBe(wire); // actual decrypted user text
  expect(
    cachedMessage({
      ...raw("stale projection"),
      wire: { body: wire, attachment_ids: [] },
      displayVersion: 99,
    }).body,
  ).toMatch(/Update your client/);
});
