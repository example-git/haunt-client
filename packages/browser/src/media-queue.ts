// Visible messages share a small queue; background servers never enqueue work.
const waiting: Array<() => void> = [];
let active = 0;
export function mediaTask<T>(
  job: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted)
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  if (waiting.length >= 96) return Promise.reject(Error("Preview queue full"));
  return new Promise((resolve, reject) => {
    const abort = () => {
      const index = waiting.indexOf(run);
      if (index >= 0) {
        waiting.splice(index, 1);
        reject(new DOMException("Aborted", "AbortError"));
      }
    };
    const run = () => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        waiting.shift()?.();
        return;
      }
      active++;
      void Promise.resolve()
        .then(job)
        .then(resolve, reject)
        .finally(() => {
          active--;
          waiting.shift()?.();
        });
    };
    signal.addEventListener("abort", abort, { once: true });
    if (active < 4) run();
    else waiting.push(run);
  });
}
