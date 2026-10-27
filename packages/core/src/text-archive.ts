import { cachedMessage } from "./message-content.js";
import type { Message } from "./types.js";

export interface ArchivedText {
  id: string;
  conversation_id: string;
  author_id: string;
  seq: number;
  body: string;
  created_at: string;
  edited_at?: string | null;
  reply_to_id?: string;
  removed?: true;
}
export interface TextArchiveChunk {
  scope: string;
  conversation: string;
  part: number;
  data: string;
}
export const archivePart = (seq: number) => Math.floor(seq / 100);
export const archiveChunkKey = (
  chunk: Pick<TextArchiveChunk, "scope" | "conversation" | "part">,
) => JSON.stringify([chunk.scope, chunk.conversation, chunk.part]);
const maxChunkBytes = 48 * 1024 * 1024;
const id = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 128;
export function validArchiveScope(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 512) return false;
  try {
    const scope = JSON.parse(value);
    return Array.isArray(scope) && scope.length === 2 && scope.every(id);
  } catch {
    return false;
  }
}
export function validateTextChunk(value: TextArchiveChunk): TextArchiveChunk {
  if (
    !value ||
    !validArchiveScope(value.scope) ||
    !id(value.conversation) ||
    !Number.isSafeInteger(value.part) ||
    value.part < 0 ||
    typeof value.data !== "string" ||
    !value.data.length ||
    value.data.length > 12 * 1024 * 1024 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value.data)
  )
    throw Error("Invalid text archive chunk.");
  return {
    scope: value.scope,
    conversation: value.conversation,
    part: value.part,
    data: value.data,
  };
}
export function archivedText(raw: Message): ArchivedText | undefined {
  const m = cachedMessage(raw);
  if (m.deleted || m.security === "pending" || m.security === "unavailable")
    return;
  return {
    id: m.id,
    conversation_id: m.conversation_id,
    author_id: m.author_id,
    seq: m.seq,
    body: m.body,
    created_at: m.created_at,
    ...(m.edited_at ? { edited_at: m.edited_at } : {}),
    ...(m.reply_to_id ? { reply_to_id: m.reply_to_id } : {}),
  };
}
export function mergeArchivedText(
  old: ArchivedText | undefined,
  next: ArchivedText,
) {
  if (!old) return next;
  if (old.removed) return old;
  if (next.removed) return { ...next, body: "" };
  const before = Date.parse(old.edited_at || old.created_at);
  const after = Date.parse(next.edited_at || next.created_at);
  return after > before ||
    (after === before && JSON.stringify(next) > JSON.stringify(old))
    ? next
    : old;
}
const bytes64 = (bytes: Uint8Array) => {
  let raw = "";
  for (let i = 0; i < bytes.length; i += 8192)
    raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(raw);
};
export async function packTextChunk(
  metadata: Omit<TextArchiveChunk, "data">,
  rows: ArchivedText[],
): Promise<TextArchiveChunk> {
  if (rows.length > 100) throw Error("Invalid text archive message group.");
  const text = JSON.stringify(
    rows.slice().sort((a, b) => a.seq - b.seq || a.id.localeCompare(b.id)),
  );
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > maxChunkBytes)
    throw Error("Text archive chunk exceeds 48 MiB.");
  const compressed = await new Response(
    new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip")),
  ).arrayBuffer();
  return { ...metadata, data: bytes64(new Uint8Array(compressed)) };
}
export async function unpackTextChunk(
  raw: TextArchiveChunk,
): Promise<ArchivedText[]> {
  const chunk = validateTextChunk(raw);
  const bytes = Uint8Array.from(atob(chunk.data), (c) => c.charCodeAt(0));
  const reader = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"))
    .getReader();
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > maxChunkBytes)
        throw Error("Text archive chunk exceeds 48 MiB.");
      parts.push(new Uint8Array(result.value));
    }
  } finally {
    await reader.cancel();
  }
  const rows = JSON.parse(await new Blob(parts).text()) as ArchivedText[];
  const seen = new Set<string>();
  if (!Array.isArray(rows) || rows.length > 100)
    throw Error("Invalid text archive messages.");
  for (const row of rows) {
    if (
      !row ||
      !id(row.id) ||
      !id(row.author_id) ||
      seen.has(row.id) ||
      row.conversation_id !== chunk.conversation ||
      !Number.isSafeInteger(row.seq) ||
      row.seq < 1 ||
      archivePart(row.seq) !== chunk.part ||
      typeof row.body !== "string" ||
      row.body.length > 65536 ||
      !Number.isFinite(Date.parse(row.created_at)) ||
      (row.edited_at != null && !Number.isFinite(Date.parse(row.edited_at))) ||
      (row.reply_to_id !== undefined && !id(row.reply_to_id)) ||
      (row.removed !== undefined && row.removed !== true) ||
      (row.removed && row.body !== "")
    )
      throw Error("Invalid text archive message.");
    seen.add(row.id);
  }
  return rows.map((row) => ({
    id: row.id,
    author_id: row.author_id,
    conversation_id: row.conversation_id,
    seq: row.seq,
    body: row.body,
    created_at: row.created_at,
    ...(row.edited_at ? { edited_at: row.edited_at } : {}),
    ...(row.reply_to_id ? { reply_to_id: row.reply_to_id } : {}),
    ...(row.removed ? { removed: true as const } : {}),
  }));
}
export async function mergeTextChunks(
  a: TextArchiveChunk,
  b: TextArchiveChunk,
) {
  if (archiveChunkKey(a) !== archiveChunkKey(b))
    throw Error("Text archive scope mismatch.");
  if (a.data === b.data) return a;
  const rows = new Map((await unpackTextChunk(a)).map((m) => [m.id, m]));
  for (const next of await unpackTextChunk(b))
    rows.set(next.id, mergeArchivedText(rows.get(next.id), next));
  return packTextChunk(
    { scope: a.scope, conversation: a.conversation, part: a.part },
    [...rows.values()],
  );
}
