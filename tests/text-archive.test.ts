import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { openDB } from "idb";
import {
  archivedText,
  packTextChunk,
  unpackTextChunk,
  type Message,
} from "@haunt/core";
import { IndexedDBStore } from "../packages/browser/src/storage";
import {
  exportTextArchive,
  importTextArchive,
} from "../packages/browser/src/text-archive-files";
import { mergeArchiveChunks } from "../packages/browser/src/sync/text-archive";

const scope = JSON.stringify(["server", "user"]),
  other = JSON.stringify(["server", "other"]);
const stores: IndexedDBStore[] = [];
const store = (name = crypto.randomUUID()) => {
  const value = new IndexedDBStore(name);
  stores.push(value);
  return value;
};
const message = (seq = 1, body = "Downloaded text"): Message => ({
  id: `message-${seq}`,
  conversation_id: "room",
  author_id: "author",
  seq,
  body,
  attachment_ids: ["attachment"],
  request_id: `request-${seq}`,
  created_at: new Date(Date.UTC(2026, 9, 26, 0, 0, seq)).toISOString(),
  deleted: false,
});
const signal = () => new AbortController().signal;
afterEach(async () => {
  await Promise.all(stores.splice(0).map((s) => s.close()));
  vi.restoreAllMocks();
});

it("preserves downloaded text on live deletion without restoring live chat or search", async () => {
  const db = store();
  await db.merge(scope, [message()]);
  await db.merge(scope, [
    {
      ...message(1, "Edited downloaded text"),
      edited_at: "2026-10-26T00:02:00Z",
    },
  ]);
  await db.merge(scope, [message()]);
  await db.merge(scope, [{ ...message(), deleted: true }]);
  expect((await db.message(scope, "room", "message-1"))?.body).toBe("");
  expect((await db.search(scope, "room", "Downloaded")).messages).toHaveLength(
    0,
  );
  expect((await db.archivedMessages(scope)).messages[0].body).toBe(
    "Edited downloaded text",
  );
  expect((await db.archivedMessages(other)).messages).toHaveLength(0);
  const restored = store();
  await restored.restoreTextArchive(await db.textArchiveChunks());
  expect((await restored.archivedMessages(scope)).messages).toHaveLength(1);
  expect(await restored.messages(scope, "room")).toHaveLength(0);
});

it("exports only readable message metadata and text, including decoded DM text", async () => {
  const db = store();
  await db.merge(scope, [
    message(),
    {
      ...message(2, "Readable DM"),
      security: "encrypted",
      displayVersion: 1,
      wire: {
        body: "!haunt-mls-v1!secret-envelope",
        attachment_ids: ["private"],
      },
    },
    { ...message(3, "!haunt-mls-v1!unreadable") },
  ]);
  expect(
    archivedText({ ...message(), security: "unavailable" }),
  ).toBeUndefined();
  const chunks = await db.textArchiveChunks();
  const blob = await exportTextArchive(chunks, signal());
  const plaintext = await new Response(
    blob.stream().pipeThrough(new DecompressionStream("gzip")),
  ).text();
  expect(plaintext).toContain("Readable DM");
  for (const secret of [
    "wire",
    "attachment",
    "secret-envelope",
    "request_id",
    "unreadable",
  ])
    expect(plaintext).not.toContain(secret);
  const restored = store();
  await restored.restoreTextArchive(await importTextArchive(blob, signal()));
  expect(
    (await restored.archivedMessages(scope)).messages.map((m) => m.body),
  ).toEqual(["Readable DM", "Downloaded text"]);
  expect(await restored.messages(scope, "room")).toHaveLength(0);
});

it("keeps explicit archive deletions across stale import, history replay and device merging", async () => {
  const first = store(),
    second = store();
  await first.merge(scope, [message()]);
  const old = await first.textArchiveChunks();
  const file = await exportTextArchive(old, signal());
  await second.restoreTextArchive(old);
  await first.removeArchivedMessage(scope, "message-1");
  await first.merge(scope, [message()]);
  await first.restoreTextArchive(await importTextArchive(file, signal()));
  expect((await first.archivedMessages(scope)).messages).toHaveLength(0);
  const removed = await first.textArchiveChunks();
  await second.restoreTextArchive(await mergeArchiveChunks(old, removed));
  expect((await second.archivedMessages(scope)).messages).toHaveLength(0);
  expect((await unpackTextChunk(removed[0]))[0]).toMatchObject({
    removed: true,
    body: "",
  });
  const freshFile = await exportTextArchive(removed, signal());
  expect(await importTextArchive(freshFile, signal())).toHaveLength(0);
  expect((await first.message(scope, "room", "message-1"))?.body).toBe(
    "Downloaded text",
  );
});

it("caches compressed chunks and invalidates only changed ranges", async () => {
  const db = store();
  await db.merge(scope, [message(), message(100)]);
  const first = await db.textArchiveChunks();
  const compression = vi.spyOn(globalThis, "CompressionStream");
  expect(await db.textArchiveChunks()).toEqual(first);
  expect(compression).not.toHaveBeenCalled();
  await db.merge(scope, [
    { ...message(1, "New edit"), edited_at: "2026-10-26T00:04:00Z" },
  ]);
  const next = await db.textArchiveChunks();
  expect(compression).toHaveBeenCalledTimes(1);
  expect(next.find((c) => c.part === 1)).toEqual(
    first.find((c) => c.part === 1),
  );
});

it("migrates existing messages once and retains archive copies after cache clearing", async () => {
  const name = crypto.randomUUID();
  const legacy = await openDB(name, 1, {
    upgrade(db) {
      const messages = db.createObjectStore("messages", {
        keyPath: ["scope", "id"],
      });
      messages.createIndex("scope", "scope");
      messages.createIndex("conversation", ["scope", "conversation_id", "seq"]);
      db.createObjectStore("cursors");
      db.createObjectStore("pending", {
        keyPath: ["scope", "request_id"],
      }).createIndex("scope", "scope");
    },
  });
  await legacy.put("messages", { ...message(), scope });
  await legacy.put("messages", { ...message(2), scope: other });
  legacy.close();
  const db = store(name),
    progress = vi.fn();
  const chunks = await db.textArchiveChunks(
    new Set([scope]),
    signal(),
    progress,
  );
  expect(chunks).toHaveLength(1);
  expect(progress).toHaveBeenCalledWith(1);
  progress.mockClear();
  await db.textArchiveChunks(new Set([scope]), signal(), progress);
  expect(progress).not.toHaveBeenCalled();
  await db.clear(scope);
  expect((await db.archivedMessages(scope)).messages).toHaveLength(1);
});

it("rejects corrupt, oversized and foreign archives before import", async () => {
  const db = store();
  await db.merge(scope, [message()]);
  const file = await exportTextArchive(await db.textArchiveChunks(), signal());
  await expect(
    importTextArchive(file, signal(), new Set([other])),
  ).rejects.toThrow("another account");
  await expect(
    importTextArchive(new Blob(["not gzip"]), signal()),
  ).rejects.toThrow();
  const invalid = await packTextChunk(
    { scope, conversation: "room", part: 0 },
    [{ ...archivedText(message())!, seq: 101 }],
  );
  await expect(unpackTextChunk(invalid)).rejects.toThrow(
    "Invalid text archive message",
  );
  const oversized = await new Response(
    new Blob(["a".repeat(49 * 1024 * 1024)])
      .stream()
      .pipeThrough(new CompressionStream("gzip")),
  ).arrayBuffer();
  await expect(
    unpackTextChunk({
      ...invalid,
      data: Buffer.from(oversized).toString("base64"),
    }),
  ).rejects.toThrow("48 MiB");
});

it("pages saved text chronologically without duplicate or missing records", async () => {
  const db = store();
  await db.merge(
    scope,
    Array.from({ length: 105 }, (_, n) => message(n + 1)),
  );
  const first = await db.archivedMessages(scope),
    second = await db.archivedMessages(scope, first.before),
    third = await db.archivedMessages(scope, second.before);
  expect(
    [...first.messages, ...second.messages, ...third.messages].map(
      (m) => m.seq,
    ),
  ).toEqual(Array.from({ length: 105 }, (_, n) => 105 - n));
  expect(third.before).toBeUndefined();
});

it("cancels restore before writing a chunk", async () => {
  const source = store(),
    target = store();
  await source.merge(scope, [message()]);
  const chunks = await source.textArchiveChunks();
  const abort = new AbortController();
  abort.abort();
  await expect(
    target.restoreTextArchive(chunks, undefined, abort.signal),
  ).rejects.toThrow();
  expect((await target.archivedMessages(scope)).messages).toHaveLength(0);
});
