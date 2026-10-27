import {
  archiveChunkKey,
  archivePart,
  packTextChunk,
  unpackTextChunk,
  validArchiveScope,
  type ArchivedText,
  type TextArchiveChunk,
} from "@haunt/core";

export async function exportTextArchive(
  chunks: Iterable<TextArchiveChunk> | AsyncIterable<TextArchiveChunk>,
  signal: AbortSignal,
  progress?: (count: number) => void,
): Promise<Blob> {
  async function* lines() {
    yield JSON.stringify({
      format: "haunt-text-archive",
      version: 1,
      created_at: new Date().toISOString(),
    }) + "\n";
    let count = 0;
    for await (const chunk of chunks) {
      signal.throwIfAborted();
      const rows = await unpackTextChunk(chunk);
      progress?.((count += rows.length));
      yield rows
        .filter((m) => !m.removed)
        .map((message) => JSON.stringify({ scope: chunk.scope, message }))
        .join("\n") + "\n";
    }
  }
  const source = lines(),
    encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
    async pull(controller) {
      try {
        signal.throwIfAborted();
        const item = await source.next();
        if (item.done) controller.close();
        else controller.enqueue(encoder.encode(item.value));
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await source.return();
    },
  });
  return new Response(stream.pipeThrough(new CompressionStream("gzip"))).blob();
}

export async function importTextArchive(
  file: Blob,
  signal: AbortSignal,
  allowed?: ReadonlySet<string>,
  progress?: (count: number) => void,
): Promise<TextArchiveChunk[]> {
  if (!file.size || file.size > 512 * 1024 * 1024)
    throw Error("Choose a compressed text archive up to 512 MiB.");
  const reader = file
    .stream()
    .pipeThrough(new DecompressionStream("gzip"))
    .pipeThrough(new TextDecoderStream("utf-8", { fatal: true }))
    .getReader();
  let pending = "",
    header = false;
  let group: Omit<TextArchiveChunk, "data"> | undefined;
  let messages: ArchivedText[] = [];
  const chunks: TextArchiveChunk[] = [];
  let count = 0;
  const flush = async () => {
    if (!group || !messages.length) return;
    const chunk = await packTextChunk(group, messages);
    await unpackTextChunk(chunk);
    chunks.push(chunk);
    progress?.((count += messages.length));
    messages = [];
  };
  const line = async (text: string) => {
    if (!text.trim()) return;
    if (text.length > 512 * 1024)
      throw Error("Text archive line is too large.");
    const value = JSON.parse(text);
    if (!header) {
      if (value?.format !== "haunt-text-archive" || value.version !== 1)
        throw Error("Unsupported text archive format.");
      header = true;
      return;
    }
    if (
      !validArchiveScope(value.scope) ||
      !value.message ||
      (allowed && !allowed.has(value.scope))
    )
      throw Error("Text archive belongs to another account or server.");
    const next = {
      scope: value.scope,
      conversation: value.message.conversation_id,
      part: archivePart(value.message.seq),
    };
    if (group && archiveChunkKey(group) !== archiveChunkKey(next))
      await flush();
    group = next;
    messages.push(value.message);
    if (messages.length > 100)
      throw Error("Invalid text archive message group.");
  };
  try {
    for (;;) {
      signal.throwIfAborted();
      const result = await reader.read();
      if (result.done) break;
      pending += result.value;
      let end: number;
      while ((end = pending.indexOf("\n")) >= 0) {
        await line(pending.slice(0, end));
        pending = pending.slice(end + 1);
      }
      if (pending.length > 512 * 1024)
        throw Error("Text archive line is too large.");
    }
    if (pending.trim()) await line(pending);
    await flush();
    if (!header) throw Error("Empty text archive.");
    return chunks;
  } finally {
    await reader.cancel();
  }
}
