export interface ArchivePolicy {
  automatic: boolean;
  bytesPerSecond: number;
  requestsPerMinute: number;
}

export const defaultArchivePolicy: ArchivePolicy = {
  automatic: true,
  bytesPerSecond: 64 * 1024,
  requestsPerMinute: 30,
};

export function validArchivePolicy(value: unknown): value is ArchivePolicy {
  if (!value || typeof value !== "object") return false;
  const p = value as ArchivePolicy;
  return (
    typeof p.automatic === "boolean" &&
    Number.isSafeInteger(p.bytesPerSecond) &&
    p.bytesPerSecond >= 1024 &&
    p.bytesPerSecond <= 4 * 1024 * 1024 &&
    Number.isSafeInteger(p.requestsPerMinute) &&
    p.requestsPerMinute >= 1 &&
    p.requestsPerMinute <= 120
  );
}

export function historyDelay(ms: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export class ArchiveBudget {
  private tail: Promise<unknown> = Promise.resolve();
  private nextRequest = 0;
  constructor(
    readonly policy: () => ArchivePolicy = () => defaultArchivePolicy,
  ) {}
  run<T>(
    signal: AbortSignal,
    allowed: () => boolean,
    task: () => Promise<{ value: T; bytes: number }>,
  ): Promise<T> {
    const run = async () => {
      for (;;) {
        signal.throwIfAborted();
        if (!validArchivePolicy(this.policy()))
          throw Error("Invalid archive download budget");
        const wait = this.nextRequest - Date.now();
        const available = allowed();
        if (available && wait <= 0) break;
        await historyDelay(
          available ? Math.min(1000, Math.max(50, wait)) : 1000,
          signal,
        );
      }
      const started = Date.now();
      const policy = this.policy();
      this.nextRequest = started + 60_000 / policy.requestsPerMinute;
      try {
        const result = await task();
        this.nextRequest = Math.max(
          this.nextRequest,
          started + (result.bytes * 1000) / policy.bytesPerSecond,
        );
        return result.value;
      } catch (error) {
        this.nextRequest = Math.max(this.nextRequest, Date.now() + 1000);
        throw error;
      }
    };
    const result = this.tail.then(run, run);
    this.tail = result.catch(() => {});
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      result.then(
        (value) => {
          signal.removeEventListener("abort", abort);
          resolve(value);
        },
        (error) => {
          signal.removeEventListener("abort", abort);
          reject(error);
        },
      );
    });
  }
}
