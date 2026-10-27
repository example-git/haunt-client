import type { Message, SearchOptions } from "@haunt/core";
function workerRequest<T>(
  request: object,
  signal: AbortSignal,
  progress: (phase: string, count: number) => void,
): Promise<T> {
  signal.throwIfAborted();
  const worker = new Worker(new URL("./archive-worker.ts", import.meta.url), {
    type: "module",
  });
  return new Promise((resolve, reject) => {
    const close = () => {
      signal.removeEventListener("abort", abort);
      worker.terminate();
    };
    const abort = () => {
      close();
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    worker.onerror = (event) => {
      close();
      reject(Error(event.message || "Archive worker failed."));
    };
    worker.onmessage = ({ data }) => {
      if (data.error) {
        close();
        reject(Error(data.error));
      } else if (data.done) {
        close();
        resolve(data);
      } else progress(data.phase, data.count);
    };
    worker.postMessage(request);
  });
}
export async function archiveSearch(
  database: string,
  scope: string,
  conversation: string,
  query: string,
  options: SearchOptions,
) {
  const { result } = await workerRequest<{
    result: { messages: Message[]; hasMore: boolean };
  }>(
    {
      action: "search",
      database,
      scope,
      conversation,
      query,
      options: { before: options.before, limit: options.limit },
    },
    options.signal ?? new AbortController().signal,
    (_phase, count) => options.onProgress?.(count),
  );
  return result;
}
export function archiveJob(
  action: "export" | "import" | "prepare",
  scopes: ReadonlySet<string> | undefined,
  signal: AbortSignal,
  progress: (phase: string, count: number) => void,
  file?: Blob,
): Promise<{ file?: Blob; scopes?: string[] }> {
  return workerRequest(
    { action, scopes: scopes ? [...scopes] : undefined, file },
    signal,
    progress,
  );
}
