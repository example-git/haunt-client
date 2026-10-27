import { IndexedDBStore } from "./storage";
import { exportTextArchive, importTextArchive } from "./text-archive-files";

import type { SearchOptions } from "@haunt/core";
self.onmessage = async ({
  data,
}: MessageEvent<{
  action: "export" | "import" | "prepare" | "search";
  scopes?: string[];
  file?: Blob;
  database?: string;
  scope?: string;
  conversation?: string;
  query?: string;
  options?: SearchOptions;
}>) => {
  const store = new IndexedDBStore(data.database);
  const allowed = data.scopes ? new Set(data.scopes) : undefined;
  const signal = new AbortController().signal;
  const progress = (phase: string) => (count: number) =>
    self.postMessage({ phase, count });
  try {
    if (data.action === "export") {
      const chunks = store.iterateTextArchiveChunks(
        allowed,
        signal,
        progress("Preparing"),
      );
      const file = await exportTextArchive(
        chunks,
        signal,
        progress("Compressing"),
      );
      self.postMessage({ done: true, file });
    } else if (data.action === "import") {
      if (!data.file) throw Error("Choose a message text archive.");
      const chunks = await importTextArchive(
        data.file,
        signal,
        allowed,
        progress("Reading"),
      );
      await store.restoreTextArchive(
        chunks,
        allowed,
        signal,
        progress("Restoring"),
      );
      self.postMessage({ done: true });
    } else if (data.action === "prepare") {
      const scopes = [...(await store.textArchiveScopes())].filter(
        (scope) => !allowed || allowed.has(scope),
      );
      await store.prepareTextArchive(
        new Set(scopes),
        signal,
        progress("Preparing"),
      );
      self.postMessage({ done: true, scopes });
    } else if (data.action === "search") {
      const result = await store.search(
        data.scope!,
        data.conversation!,
        data.query!,
        { ...data.options, signal, onProgress: progress("Indexing") },
      );
      self.postMessage({ done: true, result });
    } else throw Error("Unknown archive operation.");
  } catch (error) {
    self.postMessage({
      error:
        error instanceof Error ? error.message : "Archive operation failed.",
    });
  }
};
