import { chromium } from "@playwright/test";
import { createServer } from "vite";
import path from "node:path";
import fs from "node:fs/promises";
const project = process.cwd();
const server = await createServer({
  configFile: path.join(project, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    headless: true,
  });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  const report = await page.evaluate(async (project) => {
    const { IndexedDBStore } = await import(
      `/@fs/${project}/packages/browser/src/storage.ts`
    );
    const { exportTextArchive, importTextArchive } = await import(
      `/@fs/${project}/packages/browser/src/text-archive-files.ts`
    );
    const store = new IndexedDBStore("text-scale"),
      scope = JSON.stringify(["scale-server", "scale-user"]),
      total = 100000;
    const start = performance.now();
    for (let offset = 0; offset < total; offset += 500) {
      await store.merge(
        scope,
        Array.from({ length: 500 }, (_, n) => {
          const seq = offset + n + 1;
          return {
            id: String(seq),
            seq,
            conversation_id: "scale-room",
            author_id: "author",
            request_id: String(seq),
            created_at: "2026-10-26T00:00:00Z",
            deleted: false,
            attachment_ids: [],
            body: `Message ${seq}: representative channel discussion about history downloads and cache reuse${seq % 100 === 0 ? " needle" : ""}`,
          };
        }),
      );
    }
    const indexed = performance.now();
    let reindexed = 0;
    const result = await store.search(scope, "scale-room", "needle history", {
      onProgress: (n) => (reindexed += n),
    });
    const searched = performance.now();
    const older = await store.search(scope, "scale-room", "needle history", {
      before: result.messages.at(-1).seq,
    });
    const paged = performance.now();
    if (
      result.messages.length !== 50 ||
      result.messages[0].seq !== total ||
      older.messages[0].seq !== 95000 ||
      reindexed !== 0
    )
      throw Error("Local search failed");
    const chunks = await store.textArchiveChunks();
    const compressed = performance.now();
    const cached = await store.textArchiveChunks();
    const reused = performance.now();
    if (JSON.stringify(chunks) !== JSON.stringify(cached))
      throw Error("Unchanged chunks changed");
    const file = await exportTextArchive(chunks, new AbortController().signal);
    const exported = performance.now();
    const imported = await importTextArchive(
      file,
      new AbortController().signal,
    );
    const parsed = performance.now();
    if (imported.length !== chunks.length)
      throw Error("Archive chunk count changed");
    const count =
      (
        await new Response(
          file.stream().pipeThrough(new DecompressionStream("gzip")),
        ).text()
      )
        .trim()
        .split("\n").length - 1;
    if (count !== total)
      throw Error(`Expected ${total} saved messages; got ${count}`);
    await store.close();
    return {
      messages: total,
      indexing_ms: indexed - start,
      search_ms: searched - indexed,
      older_page_ms: paged - searched,
      reindexed,
      compression_ms: compressed - paged,
      cached_chunks_ms: reused - compressed,
      export_ms: exported - reused,
      parse_ms: parsed - exported,
      gzip_bytes: file.size,
      chunk_count: chunks.length,
    };
  }, project);
  console.log(JSON.stringify(report));
  if (process.env.HAUNT_ARCHIVE_REPORT)
    await fs.writeFile(
      process.env.HAUNT_ARCHIVE_REPORT,
      JSON.stringify(report, null, 2),
    );
} finally {
  await browser?.close();
  await server.close();
}
