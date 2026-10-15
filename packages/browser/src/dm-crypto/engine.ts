// Bounded pool; MLS computations stay off the UI thread. State belongs to the
// caller's account transaction, never to a worker or a server response.
export interface EngineState {
  identity: string;
  signer: unknown;
  storage: unknown[];
}
export interface EngineResult {
  state: EngineState;
  key: number[];
  signature?: number[];
  packages?: number[][];
  commit?: number[];
  welcome?: number[];
  members?: { index: number; credential: number[]; key: number[] }[];
  epoch?: number;
  message?: number[];
  plaintext?: number[];
  sender?: number[];
  committed?: boolean;
}
type Job = {
  input: string;
  resolve: (v: EngineResult) => void;
  reject: (e: Error) => void;
};
const queue: Job[] = [];
const slots: {
  worker: Worker;
  job?: Job;
  timer?: ReturnType<typeof setTimeout>;
}[] = [];
function pump() {
  while (queue.length && slots.length < 2) {
    const slot: {
      worker: Worker;
      job?: Job;
      timer?: ReturnType<typeof setTimeout>;
    } = {
      worker: new Worker(new URL("./worker.ts", import.meta.url), {
        type: "module",
      }),
    };
    slot.worker.onmessage = (event) => {
      const job = slot.job;
      if (!job) return;
      clearTimeout(slot.timer);
      slot.job = undefined;
      try {
        if (event.data.error) throw Error(event.data.error);
        job.resolve(JSON.parse(event.data.result));
      } catch (e) {
        job.reject(e as Error);
      }
      pump();
    };
    slot.worker.onerror = () => {
      clearTimeout(slot.timer);
      slot.job?.reject(Error("Encryption worker failed"));
      slot.worker.terminate();
      slots.splice(slots.indexOf(slot), 1);
      pump();
    };
    slots.push(slot);
  }
  for (const slot of slots) {
    if (slot.job || !queue.length) continue;
    slot.job = queue.shift()!;
    slot.timer = setTimeout(() => {
      slot.job?.reject(Error("Encryption operation timed out"));
      slot.worker.terminate();
      slots.splice(slots.indexOf(slot), 1);
      pump();
    }, 30000);
    slot.worker.postMessage({ id: 1, input: slot.job.input });
  }
}
export function engine(input: Record<string, unknown>): Promise<EngineResult> {
  if (queue.length >= 128)
    return Promise.reject(Error("Encryption queue is busy"));
  return new Promise((resolve, reject) => {
    queue.push({ input: JSON.stringify(input), resolve, reject });
    pump();
  });
}
export const bytes64 = (bytes: ArrayLike<number>) => {
  let result = "";
  const values = Array.from(bytes);
  for (let offset = 0; offset < values.length; offset += 16384)
    result += String.fromCharCode(...values.slice(offset, offset + 16384));
  return btoa(result);
};
export const un64 = (value: string) =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
export const utf8 = (value: string) => new TextEncoder().encode(value);
export const text = (bytes: ArrayLike<number>) =>
  new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
