import {
  archiveChunkKey,
  mergeTextChunks,
  validateTextChunk,
  unpackTextChunk,
  type TextArchiveChunk,
} from "@haunt/core";
import type { IndexedDBStore } from "../storage";
import { digest } from "./crypto";
import {
  loadSession,
  SyncError,
  SyncService,
  SyncSessionReplaced,
  type Session,
} from "./service";

interface ArchiveSnapshot {
  format: "haunt-text-archive";
  version: 1;
  scope: string;
  chunks: TextArchiveChunk[];
}
export async function mergeArchiveChunks(
  local: TextArchiveChunk[],
  remote: TextArchiveChunk[],
) {
  const chunks = new Map<string, TextArchiveChunk>();
  for (const raw of local) {
    const chunk = validateTextChunk(raw);
    chunks.set(archiveChunkKey(chunk), chunk);
  }
  for (const raw of remote) {
    const chunk = validateTextChunk(raw);
    const key = archiveChunkKey(chunk),
      old = chunks.get(key);
    if (!old) await unpackTextChunk(chunk);
    chunks.set(key, old ? await mergeTextChunks(old, chunk) : chunk);
  }
  return [...chunks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, value]) => value);
}
export async function syncTextArchive(
  session: Session,
  store: IndexedDBStore,
  scopes?: ReadonlySet<string>,
  force = false,
) {
  const checkSession = async () => {
    const active = await loadSession();
    if (
      !active ||
      active.device !== session.device ||
      active.token !== session.token ||
      active.account !== session.account ||
      active.issuer !== session.issuer
    )
      throw new SyncSessionReplaced();
  };
  const run = async () => {
    await checkSession();
    const service = new SyncService(session.issuer, session.portal);
    const name = "archive:" + session.scope;
    const checkpointKey = JSON.stringify([
      session.issuer,
      session.account,
      session.scope,
    ]);
    const cursorKey = checkpointKey + ":chunks";
    const observedKey = checkpointKey + ":observed";
    let observed = (await store.archiveSyncState(observedKey))?.revision ?? 0;
    const savedCursor = await store.archiveSyncState(cursorKey);
    let cursor = force ? 0 : (savedCursor?.revision ?? 0);
    const verified = force ? new Set<string>() : undefined;
    let page;
    try {
      page = await service.archiveChanges(session, cursor);
    } catch (error) {
      if (
        error instanceof SyncError &&
        (error.status === 404 || error.code === "invalid_vault_scope")
      )
        throw Error(
          "Update Haunt Sync to enable incremental message archives.",
        );
      if (
        error instanceof SyncError &&
        error.code === "archive_revision_rollback"
      )
        throw Error(
          "The synced text archive revision moved backwards. Restore the sync server backup before retrying.",
        );
      throw error;
    }
    if (page.through < observed)
      throw Error(
        "The synced text archive revision moved backwards. Restore the sync server backup before retrying.",
      );
    observed = Math.max(observed, page.through);
    const saveChunkState = async (
      name: string,
      revision: number,
      fingerprint: string,
      sequence?: number,
    ) => {
      if (!Number.isSafeInteger(sequence) || sequence! < 1)
        throw Error("Invalid archive write sequence.");
      observed = Math.max(observed, sequence!);
      await store.saveArchiveSyncStates([
        [checkpointKey + ":" + name, { revision, digest: fingerprint }],
        [observedKey, { revision: observed, digest: "" }],
      ]);
    };
    const checkpoint = await store.archiveSyncState(checkpointKey);
    const legacy = await service.read<
      ArchiveSnapshot | { format: string; version: 2; scope: string }
    >(session, name, session.backupKey, checkpoint?.revision);
    if (checkpoint && legacy.revision < checkpoint.revision)
      throw Error(
        "The synced text archive revision moved backwards. Restore the sync server backup before retrying.",
      );
    if (legacy.value) {
      const value = legacy.value;
      if (
        value.format !== "haunt-text-archive" ||
        value.scope !== session.scope ||
        (value.version !== 1 && value.version !== 2) ||
        (value.version === 1 && !Array.isArray(value.chunks))
      )
        throw Error("Invalid synced text archive.");
      if (value.version === 1) {
        await checkSession();
        await store.restoreTextArchive(value.chunks, scopes);
      }
    }
    const chunkName = async (chunk: TextArchiveChunk) =>
      "archive-chunk:" +
      session.scope +
      ":" +
      (await digest(archiveChunkKey(chunk)));
    const stateKey = (name: string) => checkpointKey + ":" + name;
    const receive = async (name: string, minimum: number, known?: number) => {
      const cloud = await service.read<TextArchiveChunk>(
        session,
        name,
        session.backupKey,
        known,
      );
      if (cloud.revision < minimum)
        throw Error(
          "The synced text archive revision moved backwards. Restore the sync server backup before retrying.",
        );
      if (cloud.unchanged) return;
      if (!cloud.value) throw Error("A synced archive chunk is missing.");
      const chunk = validateTextChunk(cloud.value);
      if ((await chunkName(chunk)) !== name)
        throw Error("Invalid synced archive chunk identity.");
      await checkSession();
      await store.restoreTextArchive([chunk], scopes);
      verified?.add(name);
      const merged = (await store.textArchiveChunk(chunk))!;
      const normalized = async (value: TextArchiveChunk) =>
        JSON.stringify(
          (await unpackTextChunk(value)).sort(
            (a, b) => a.seq - b.seq || a.id.localeCompare(b.id),
          ),
        );
      const same =
        merged.data === chunk.data ||
        (await normalized(merged)) === (await normalized(chunk));
      await saveChunkState(
        name,
        cloud.revision,
        await digest(same ? merged.data : chunk.data),
        cloud.sequence,
      );
      return merged;
    };
    const through = page.through;
    for (;;) {
      for (const entry of page.entries) {
        const known = await store.archiveSyncState(stateKey(entry.scope));
        verified?.add(entry.scope);
        if (force || !known || known.revision < entry.revision)
          await receive(
            entry.scope,
            Math.max(entry.revision, known?.revision ?? 0),
          );
      }
      cursor = page.cursor;
      if (cursor === through) break;
      page = await service.archiveChanges(session, cursor, through);
    }
    await checkSession();
    await store.saveArchiveSyncState(cursorKey, {
      revision: through,
      digest: "",
    });
    for await (const initial of store.iterateTextArchiveChunks(scopes)) {
      const name = await chunkName(initial);
      let chunk = initial;
      let complete = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        let known = await store.archiveSyncState(stateKey(name));
        if (known && verified && !verified.has(name)) {
          chunk = (await receive(name, known.revision))!;
          known = await store.archiveSyncState(stateKey(name));
        }
        const fingerprint = await digest(chunk.data);
        if (known?.digest === fingerprint) {
          complete = true;
          break;
        }
        await checkSession();
        try {
          const result = await service.write(
            session,
            chunk,
            known?.revision ?? 0,
            name,
          );
          if (result.revision !== (known?.revision ?? 0) + 1)
            throw Error("Invalid archive write revision.");
          await saveChunkState(
            name,
            result.revision,
            fingerprint,
            result.sequence,
          );
          complete = true;
          break;
        } catch (error) {
          if (!(error instanceof SyncError && error.status === 409))
            throw error;
          chunk = (await receive(name, known?.revision ?? 0))!;
        }
      }
      if (!complete)
        throw Error(
          "Another device keeps updating this archive chunk. Try syncing again.",
        );
    }
    await checkSession();
    let revision = legacy.revision;
    if (
      legacy.value?.version !== 2 &&
      !(legacy.unchanged && checkpoint?.digest === "chunks-v2")
    )
      revision = (
        await service.write(
          session,
          { format: "haunt-text-archive", version: 2, scope: session.scope },
          revision,
          name,
        )
      ).revision;
    await store.saveArchiveSyncState(checkpointKey, {
      revision,
      digest: "chunks-v2",
    });
  };
  if (globalThis.navigator?.locks)
    return navigator.locks.request(
      `haunt-archive-sync:${session.issuer}:${session.account}:${session.scope}`,
      run,
    );
  return run();
}
