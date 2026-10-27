import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { IndexedDBStore } from "../packages/browser/src/storage";
import { syncTextArchive } from "../packages/browser/src/sync/text-archive";
import { digest } from "../packages/browser/src/sync/crypto";
import {
  loadSession,
  SyncError,
  SyncService,
  type Session,
} from "../packages/browser/src/sync/service";
import {
  archiveChunkKey,
  unpackTextChunk,
  type TextArchiveChunk,
} from "@haunt/core";
vi.mock("../packages/browser/src/sync/service", async (original) => ({
  ...(await original<typeof import("../packages/browser/src/sync/service")>()),
  loadSession: vi.fn(),
}));
const session = {
  issuer: "https://sync.example.test",
  portal: "https://sync.example.test",
  scope: "full",
  account: "account",
  device: "device",
  token: "token",
} as Session;
const scope = JSON.stringify(["server", "user"]);
const stores: IndexedDBStore[] = [];
async function stored(...seqs: number[]) {
  const store = new IndexedDBStore(crypto.randomUUID());
  stores.push(store);
  await store.merge(
    scope,
    seqs.map((seq) => ({
      id: String(seq),
      seq,
      conversation_id: "room",
      author_id: "author",
      request_id: String(seq),
      body: "Text " + seq,
      created_at: "2026-10-26T00:00:00Z",
      attachment_ids: [],
      deleted: false,
    })),
  );
  vi.mocked(loadSession).mockResolvedValue(session);
  return store;
}
async function name(chunk: TextArchiveChunk) {
  return "archive-chunk:full:" + (await digest(archiveChunkKey(chunk)));
}
function cloud() {
  let sequence = 0;
  const values = new Map<
    string,
    { revision: number; sequence: number; value: unknown }
  >();
  const put = (key: string, value: unknown) => {
    const revision = (values.get(key)?.revision ?? 0) + 1;
    values.set(key, { revision, sequence: ++sequence, value });
    return { revision, sequence };
  };
  const read = vi
    .spyOn(SyncService.prototype, "read")
    .mockImplementation(async (_session, key = "full", _key, known) => {
      const found = values.get(key);
      if (!found) return { revision: 0 };
      return found.revision === known
        ? { revision: known, unchanged: true }
        : {
            revision: found.revision,
            value: found.value,
            sequence: found.sequence,
          };
    });
  const write = vi
    .spyOn(SyncService.prototype, "write")
    .mockImplementation(async (_session, value, expected, key = "full") => {
      if ((values.get(key)?.revision ?? 0) !== expected)
        throw new SyncError(409, "revision_conflict");
      return put(key, value);
    });
  const changes = vi
    .spyOn(SyncService.prototype, "archiveChanges")
    .mockImplementation(async (_session, after, through = sequence) => {
      const entries = [...values]
        .filter(
          ([key, value]) =>
            key.startsWith("archive-chunk:") &&
            value.sequence > after &&
            value.sequence <= through,
        )
        .map(([scope, value]) => ({
          scope,
          revision: value.revision,
          sequence: value.sequence,
        }))
        .sort((a, b) => a.sequence - b.sequence)
        .slice(0, 200);
      return {
        entries,
        cursor: entries.length === 200 ? entries.at(-1)!.sequence : through,
        through,
      };
    });
  return { values, put, read, write, changes };
}
afterEach(async () => {
  await Promise.all(stores.splice(0).map((s) => s.close()));
  vi.restoreAllMocks();
});
it("retries a conflicting chunk and merges both devices", async () => {
  const local = await stored(1),
    remote = await stored(2),
    server = cloud();
  const chunk = (await remote.textArchiveChunks())[0];
  server.write.mockImplementationOnce(async () => {
    server.put(await name(chunk), chunk);
    throw new SyncError(409, "revision_conflict");
  });
  await syncTextArchive(session, local);
  const saved = server.values.get(await name(chunk))!.value as TextArchiveChunk;
  expect((await unpackTextChunk(saved)).map((m) => m.seq)).toEqual([1, 2]);
  expect((await local.archivedMessages(scope)).messages).toHaveLength(2);
});
it("transfers no unchanged chunks and uploads only the chunk containing a local deletion", async () => {
  const local = await stored(1, 101),
    server = cloud();
  await syncTextArchive(session, local);
  server.write.mockClear();
  server.read.mockClear();
  await syncTextArchive(session, local);
  expect(server.write).not.toHaveBeenCalled();
  expect(server.read.mock.calls.every((c) => c[1] === "archive:full")).toBe(
    true,
  );
  await local.removeArchivedMessage(scope, "1");
  await syncTextArchive(session, local);
  expect(server.write).toHaveBeenCalledTimes(1);
  expect(
    (
      await unpackTextChunk(server.write.mock.calls[0][1] as TextArchiveChunk)
    )[0],
  ).toMatchObject({ removed: true, body: "" });
});
it("rejects a rolled-back legacy revision without overwriting local text", async () => {
  const local = await stored(1),
    server = cloud();
  await local.saveArchiveSyncState(
    JSON.stringify([session.issuer, session.account, session.scope]),
    { revision: 4, digest: "old" },
  );
  server.put("archive:full", {
    format: "haunt-text-archive",
    version: 1,
    scope: "full",
    chunks: [],
  });
  await expect(syncTextArchive(session, local)).rejects.toThrow(
    "moved backwards",
  );
  expect(server.write).not.toHaveBeenCalled();
  expect((await local.archivedMessages(scope)).messages).toHaveLength(1);
});
it("stops before upload when the active account changes", async () => {
  const local = await stored(1),
    server = cloud();
  server.read.mockImplementation(async () => {
    vi.mocked(loadSession).mockResolvedValue({ ...session, account: "other" });
    return { revision: 0 };
  });
  await expect(syncTextArchive(session, local)).rejects.toThrow(
    "session changed",
  );
  expect(server.write).not.toHaveBeenCalled();
});
it("reports missing server support without dropping text", async () => {
  const local = await stored(1),
    server = cloud();
  server.changes.mockRejectedValue(new SyncError(404, "not_found"));
  await expect(syncTextArchive(session, local)).rejects.toThrow(
    "Update Haunt Sync",
  );
  expect((await local.archivedMessages(scope)).messages).toHaveLength(1);
});
it("migrates legacy snapshots after uploading every chunk and preserves deletions", async () => {
  const local = await stored(1),
    remote = await stored(1, 101),
    server = cloud();
  await remote.removeArchivedMessage(scope, "1");
  server.put("archive:full", {
    format: "haunt-text-archive",
    version: 1,
    scope: "full",
    chunks: await remote.textArchiveChunks(),
  });
  server.write.mockRejectedValueOnce(Error("connection lost"));
  await expect(syncTextArchive(session, local)).rejects.toThrow(
    "connection lost",
  );
  expect(server.values.get("archive:full")!.value).toMatchObject({
    version: 1,
  });
  await syncTextArchive(session, local);
  expect(server.values.get("archive:full")!.value).toEqual({
    format: "haunt-text-archive",
    version: 2,
    scope: "full",
  });
  expect(
    (await local.archivedMessages(scope)).messages.map((m) => m.seq),
  ).toEqual([101]);
  expect(await local.messages(scope, "room")).toHaveLength(1);
});
it("resumes an interrupted upload without resending completed chunks", async () => {
  const local = await stored(1, 101, 201),
    server = cloud();
  const write = server.write.getMockImplementation()!;
  let attempts = 0;
  server.write.mockImplementation(async (...args) => {
    if (++attempts === 2) throw Error("offline");
    return write(...args);
  });
  await expect(syncTextArchive(session, local)).rejects.toThrow("offline");
  server.write.mockImplementation(write);
  server.write.mockClear();
  await syncTextArchive(session, local);
  expect(
    server.write.mock.calls.filter((c) => c[3]?.startsWith("archive-chunk:")),
  ).toHaveLength(2);
  expect([...server.values.values()].every((v) => v.revision === 1)).toBe(true);
});
it("rejects chunks whose encrypted identity does not match their remote name", async () => {
  const local = await stored(1),
    remote = await stored(101),
    server = cloud();
  server.put(
    await name((await local.textArchiveChunks())[0]),
    (await remote.textArchiveChunks())[0],
  );
  await expect(syncTextArchive(session, local)).rejects.toThrow("identity");
  expect(server.write).not.toHaveBeenCalled();
});
it("does not upload equivalent text compressed with different gzip headers", async () => {
  const local = await stored(1),
    server = cloud();
  await syncTextArchive(session, local);
  const chunk = (await local.textArchiveChunks())[0];
  const bytes = Uint8Array.from(atob(chunk.data), (c) => c.charCodeAt(0));
  bytes[9] ^= 255;
  server.put(await name(chunk), {
    ...chunk,
    data: btoa(String.fromCharCode(...bytes)),
  });
  server.write.mockClear();
  await syncTextArchive(session, local);
  await syncTextArchive(session, local);
  expect(server.write).not.toHaveBeenCalled();
});
it("rejects rollback of an acknowledged chunk even before the scan cursor advances", async () => {
  const local = await stored(1, 101),
    server = cloud();
  const write = server.write.getMockImplementation()!;
  let count = 0;
  server.write.mockImplementation(async (...args) => {
    if (++count === 2) throw Error("offline");
    return write(...args);
  });
  await expect(syncTextArchive(session, local)).rejects.toThrow("offline");
  server.changes.mockResolvedValue({ entries: [], cursor: 0, through: 0 });
  server.write.mockClear();
  await expect(syncTextArchive(session, local)).rejects.toThrow(
    "moved backwards",
  );
  expect(server.write).not.toHaveBeenCalled();
});
it("reconciles a lost upload acknowledgement without uploading the same chunk again", async () => {
  const local = await stored(1),
    server = cloud();
  const write = server.write.getMockImplementation()!;
  server.write.mockImplementationOnce(async (...args) => {
    await write(...args);
    throw Error("lost acknowledgement");
  });
  await expect(syncTextArchive(session, local)).rejects.toThrow(
    "lost acknowledgement",
  );
  server.write.mockClear();
  await syncTextArchive(session, local);
  expect(
    server.write.mock.calls.filter((c) => c[3]?.startsWith("archive-chunk:")),
  ).toHaveLength(0);
  expect([...server.values.values()].every((v) => v.revision === 1)).toBe(true);
});
it("fully reconciles a forced resync without uploading unchanged chunks", async () => {
  const local = await stored(1, 101),
    server = cloud();
  await syncTextArchive(session, local);
  server.write.mockClear();
  server.read.mockClear();
  await syncTextArchive(session, local, undefined, true);
  expect(server.write).not.toHaveBeenCalled();
  expect(
    server.read.mock.calls.filter((c) => c[1]?.startsWith("archive-chunk:")),
  ).toHaveLength(2);
});
