import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import { archiveChunkKey, packTextChunk, unpackTextChunk } from "@haunt/core";
import { IndexedDBStore } from "../packages/browser/src/storage";
import { syncTextArchive } from "../packages/browser/src/sync/text-archive";
import {
  SyncService,
  saveSession,
  forgetSession,
} from "../packages/browser/src/sync/service";
import {
  digest,
  proofKeys,
  random,
  serverScope,
} from "../packages/browser/src/sync/crypto";

const issuer = process.env.HAUNT_SYNC_TEST_ISSUER;
it.skipIf(!issuer)(
  "syncs more than 20 MiB incrementally and rotates more than 256 encrypted chunks",
  async () => {
    const service = new SyncService(issuer!, issuer!),
      keys = await proofKeys();
    const username = "archive-scale-" + random().slice(0, 12),
      password = random(),
      keyword = random();
    await service.register(username, password, keys, undefined, keyword);
    const session = await service.signIn(username, password, keys, keyword);
    await saveSession(session);
    const local = new IndexedDBStore(crypto.randomUUID()),
      restored = new IndexedDBStore(crypto.randomUUID());
    const scope = JSON.stringify(["scale-server", "member"]);
    const chunks = [];
    for (let i = 0; i < 400; i++) {
      const body = Buffer.from(
        crypto.getRandomValues(new Uint8Array(48_000)),
      ).toString("base64");
      chunks.push(
        await packTextChunk({ scope, conversation: "room", part: i }, [
          {
            id: String(i),
            seq: i * 100 + 1,
            conversation_id: "room",
            author_id: "author",
            body,
            created_at: "2026-10-26T00:00:00Z",
          },
        ]),
      );
    }
    const encodedBytes = new TextEncoder().encode(
      JSON.stringify(chunks),
    ).length;
    expect(encodedBytes).toBeGreaterThan(20 * 1024 * 1024);
    await local.restoreTextArchive(chunks);
    const originalFetch = globalThis.fetch;
    const requests: { path: string; method: string; bytes: number }[] = [];
    const capture = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url, init) => {
        requests.push({
          path: new URL(String(url)).pathname,
          method: init?.method ?? "GET",
          bytes:
            typeof init?.body === "string"
              ? new TextEncoder().encode(init.body).length
              : 0,
        });
        return originalFetch(url, init);
      });
    const chunkPuts = () =>
      requests.filter(
        (r) =>
          r.method === "PUT" &&
          decodeURIComponent(r.path).includes("/v1/vault/archive-chunk:"),
      );
    const chunkGets = () =>
      requests.filter(
        (r) =>
          r.method === "GET" &&
          decodeURIComponent(r.path).includes("/v1/vault/archive-chunk:"),
      );
    try {
      const start = performance.now();
      await syncTextArchive(session, local);
      const firstMs = performance.now() - start;
      const firstBytes = chunkPuts().reduce((sum, r) => sum + r.bytes, 0);
      expect(chunkPuts()).toHaveLength(400);
      expect(Math.max(...chunkPuts().map((r) => r.bytes))).toBeLessThan(
        128 * 1024,
      );
      requests.length = 0;
      await syncTextArchive(session, local);
      expect(chunkPuts()).toHaveLength(0);
      expect(chunkGets()).toHaveLength(0);
      const unchangedRequests = requests.length;
      const changed = await unpackTextChunk(chunks[203]);
      changed[0].body += " edited";
      changed[0].edited_at = "2026-10-26T01:00:00Z";
      chunks[203] = await packTextChunk(chunks[203], changed);
      await local.restoreTextArchive([chunks[203]]);
      requests.length = 0;
      await syncTextArchive(session, local);
      expect(chunkPuts()).toHaveLength(1);
      const changedBytes = chunkPuts()[0].bytes;
      expect(changedBytes).toBeLessThan(firstBytes / 100);
      requests.length = 0;
      await syncTextArchive(session, restored);
      expect(chunkGets()).toHaveLength(400);
      expect(chunkPuts()).toHaveLength(0);
      expect(
        await digest(
          JSON.stringify(
            (await restored.textArchiveChunks()).sort(
              (a, b) => a.part - b.part,
            ),
          ),
        ),
      ).toBe(
        await digest(
          JSON.stringify(
            (await local.textArchiveChunks()).sort((a, b) => a.part - b.part),
          ),
        ),
      );
      expect(await restored.messages(scope, "room")).toHaveLength(0);
      const list = await service.archiveChanges(session, 0);
      expect(list.entries).toHaveLength(200);
      const next = await service.archiveChanges(
        session,
        list.cursor,
        list.through,
      );
      expect(next.entries).toHaveLength(200);
      const end = await service.archiveChanges(
        session,
        next.cursor,
        list.through,
      );
      expect(end.entries).toHaveLength(0);
      expect(end.cursor).toBe(end.through);
      const otherScope = await serverScope("https://other.example.test");
      const denied = { ...session, scope: otherScope };
      expect((await service.archiveChanges(denied, 0)).entries).toEqual([]);
      requests.length = 0;
      const { session: rotated } = await new SyncService(
        issuer!,
        issuer!,
      ).changePassword(session, password, keyword, random(), random());
      expect(
        requests.filter(
          (r) => r.method === "PUT" && r.path.startsWith("/v1/recovery/"),
        ),
      ).toHaveLength(401);
      expect(
        requests.find((r) => r.path === "/v1/recovery/finish")!.bytes,
      ).toBeLessThan(16 * 1024);
      const chunkName =
        "archive-chunk:full:" + (await digest(archiveChunkKey(chunks[203])));
      expect((await service.read(rotated, chunkName)).value).toEqual(
        chunks[203],
      );
      await expect(
        service.read(rotated, chunkName, session.backupKey),
      ).rejects.toThrow();
      await expect(service.read(session, chunkName)).rejects.toMatchObject({
        status: 401,
      });
      await saveSession(rotated);
      requests.length = 0;
      await syncTextArchive(rotated, restored);
      expect(chunkPuts()).toHaveLength(0);
      expect(chunkGets()).toHaveLength(400);
      expect(
        await digest(
          JSON.stringify(
            (await restored.textArchiveChunks()).sort(
              (a, b) => a.part - b.part,
            ),
          ),
        ),
      ).toBe(
        await digest(
          JSON.stringify(
            (await local.textArchiveChunks()).sort((a, b) => a.part - b.part),
          ),
        ),
      );
      console.log(
        JSON.stringify({
          archiveScale: {
            chunks: 400,
            encodedBytes,
            firstBytes,
            firstMs,
            changedBytes,
            unchangedRequests,
            migrationVaults: 401,
          },
        }),
      );
      await service.logout(rotated);
    } finally {
      capture.mockRestore();
      await forgetSession();
      await local.close();
      await restored.close();
    }
  },
  240_000,
);
