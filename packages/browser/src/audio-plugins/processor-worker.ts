import {
  validatePlugin,
  validateWasmImports,
  validateWasmResources,
  MAX_MEMORY_PAGES,
  type AudioPlugin,
} from "./contract";
// This is trusted client code. Downloaded modules receive only inert WASI
// stubs, numbers and private linear memory; never JS objects, tokens or URLs.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage: (value: unknown) => void;
};
let heartbeat: ReturnType<typeof setInterval>;
scope.onmessage = async ({ data }) => {
  if (data.type !== "init") return;
  scope.onmessage = null;
  try {
    const plugin: AudioPlugin = validatePlugin(data.plugin),
      abi = plugin.manifest.abi;
    validateWasmResources(data.bytes);
    const module = await WebAssembly.compile(data.bytes);
    validateWasmImports(module);
    const instance = await WebAssembly.instantiate(module, {
      wasi_snapshot_preview1: {
        proc_exit: () => {
          throw Error("Plugin exited");
        },
        fd_write: () => 0,
        fd_close: () => 0,
        fd_seek: () => 0,
        clock_time_get: () => 0,
      },
    });
    const w = instance.exports,
      memory = w.memory;
    if (
      !(memory instanceof WebAssembly.Memory) ||
      memory.buffer.byteLength > MAX_MEMORY_PAGES * 65536
    )
      throw Error("Invalid plugin memory");
    const call = (name: string | undefined, ...args: number[]): number => {
      if (!name) return 0;
      const f = w[name];
      if (typeof f !== "function") throw Error("Missing plugin export");
      return f(...args) as number;
    };
    if (abi.initialize) call(abi.initialize);
    if (call(abi.create) !== 1) throw Error("Plugin initialization failed");
    const samples = abi.frame_samples;
    const input = new Float32Array(memory.buffer, call(abi.input), samples),
      output = new Float32Array(memory.buffer, call(abi.output), samples);
    const port: MessagePort = data.port;
    let values: Record<string, number> = {},
      epoch = 0;
    let frames = 0,
      diagnostics = !!data.diagnostics;
    const configure = (raw: Record<string, number>) => {
      for (const f of plugin.manifest.fields) {
        const candidate = raw[f.key];
        const value =
          (typeof candidate === "number" && Number.isFinite(candidate)
            ? Math.max(f.min, Math.min(f.max, candidate))
            : f.default) * f.scale;
        if (
          value !== values[f.key] &&
          f.export &&
          (!f.variants?.length || f.variants.includes(data.variant))
        )
          call(f.export, value);
        values[f.key] = value;
      }
    };
    configure(data.values);
    port.onmessage = ({ data: d }) => {
      try {
        if (d.type === "options") {
          diagnostics = !!d.diagnostics;
          configure(d.values);
          return;
        }
        if (d.type === "state") {
          epoch = d.epoch;
          call(abi.reset);
          input.fill(0);
          return;
        }
        if (
          d.type !== "frame" ||
          !(d.buffer instanceof ArrayBuffer) ||
          d.buffer.byteLength !== samples * 4
        )
          return;
        const frame = new Float32Array(d.buffer);
        if (d.epoch !== epoch) {
          port.postMessage(
            { type: "frame", buffer: d.buffer, epoch: d.epoch },
            [d.buffer],
          );
          return;
        }
        for (let i = 0; i < samples; i++)
          input[i] = Number.isFinite(frame[i])
            ? Math.max(-1, Math.min(1, frame[i]))
            : 0;
        if (
          call(
            abi.process,
            ...(abi.process_controls ?? []).map((k) => values[k]),
          ) !== 0
        )
          throw Error("Plugin processing failed");
        for (let i = 0; i < samples; i++) {
          if (!Number.isFinite(output[i]))
            throw Error("Plugin returned invalid audio");
          frame[i] = Math.max(-1, Math.min(1, output[i]));
        }
        if (diagnostics && ++frames >= 14) {
          frames = 0;
          const values: Record<string, number> = {};
          for (const item of plugin.manifest.diagnostics ?? []) {
            if (
              !item.variants?.length ||
              item.variants.includes(data.variant)
            ) {
              const score = call(item.export);
              if (Number.isFinite(score)) values[item.key] = score;
            }
          }
          scope.postMessage({ type: "scores", values });
        }
        port.postMessage({ type: "frame", buffer: d.buffer, epoch }, [
          d.buffer,
        ]);
      } catch {
        scope.postMessage({ type: "error" });
        port.close();
        clearInterval(heartbeat);
      }
    };
    port.start();
    heartbeat = setInterval(
      () => scope.postMessage({ type: "heartbeat" }),
      250,
    );
    scope.postMessage({ type: "ready" });
  } catch {
    scope.postMessage({ type: "error" });
  }
};
