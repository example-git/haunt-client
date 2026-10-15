// Versioned, data-only interface. No manifest value is evaluated as code.
export const MAX_PLUGIN_BYTES = 50 * 1024 * 1024;
export const MAX_MEMORY_PAGES = 1024; // 64 MiB, including embedded model weights.
export interface PluginField {
  key: string;
  label: string;
  type: "range" | "number";
  default: number;
  min: number;
  max: number;
  step: number;
  scale: number;
  export?: string;
  help?: string;
  variants?: string[];
}
export interface PluginVariant {
  id: string;
  label: string;
  file: string;
  description?: string;
}
export interface PluginABI {
  initialize?: string;
  create: string;
  input: string;
  output: string;
  process: string;
  reset?: string;
  frame_samples: number;
  process_controls?: string[];
}
export interface AudioPlugin {
  manifest: {
    version: 1;
    id: string;
    name: string;
    description: string;
    default_variant: string;
    abi: PluginABI;
    variants: PluginVariant[];
    fields: PluginField[];
    diagnostics?: {
      key: string;
      label: string;
      export: string;
      variants?: string[];
    }[];
    legacy_preferences?: {
      variant_key: "noiseModel";
      fields: Record<
        string,
        "noiseStrength" | "noisePncInputGain" | "noiseCsdGate"
      >;
    };
  };
  digest: string;
  bytes: number;
  files: { name: string; bytes: number; sha256: string }[];
}
export interface PluginPreferences {
  id: string;
  variant: string;
  values: Record<string, number>;
}
export interface PluginSelection {
  plugin: AudioPlugin;
  variant: string;
  values: Record<string, number>;
  load: () => Promise<ArrayBuffer>;
}
const id = /^[a-z][a-z0-9_-]{0,63}$/;
const symbol = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/;
const hash = /^[a-f0-9]{64}$/;
const identifier = (v: unknown): v is string =>
  typeof v === "string" &&
  id.test(v) &&
  !["constructor", "prototype", "__proto__"].includes(v);
function record(value: unknown, keys: string[]) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k))
  )
    throw Error("Invalid plugin object");
}
export function validatePlugin(raw: unknown): AudioPlugin {
  record(raw, ["manifest", "digest", "bytes", "files"]);
  const p = raw as AudioPlugin,
    m = p?.manifest,
    a = m?.abi;
  record(m, [
    "version",
    "id",
    "name",
    "description",
    "default_variant",
    "abi",
    "variants",
    "fields",
    "diagnostics",
    "legacy_preferences",
  ]);
  record(a, [
    "initialize",
    "create",
    "input",
    "output",
    "process",
    "reset",
    "frame_samples",
    "process_controls",
  ]);
  const text = (s: unknown, max: number) =>
    typeof s === "string" && s.length <= max;
  if (
    !m ||
    m.version !== 1 ||
    !identifier(m.id) ||
    !text(m.name, 100) ||
    !m.name ||
    !text(m.description, 2000) ||
    typeof p.digest !== "string" ||
    !hash.test(p.digest) ||
    !Number.isSafeInteger(p.bytes) ||
    p.bytes < 8 ||
    p.bytes > MAX_PLUGIN_BYTES ||
    !a ||
    !Number.isInteger(a.frame_samples) ||
    a.frame_samples < 120 ||
    a.frame_samples > 960
  )
    throw Error("Unsupported audio plugin");
  for (const name of [a.create, a.input, a.output, a.process])
    if (typeof name !== "string" || !symbol.test(name))
      throw Error("Invalid audio ABI");
  for (const name of [a.initialize, a.reset])
    if (name !== undefined && (typeof name !== "string" || !symbol.test(name)))
      throw Error("Invalid audio ABI");
  if (
    !Array.isArray(m.variants) ||
    !m.variants.length ||
    m.variants.length > 16 ||
    !Array.isArray(m.fields) ||
    m.fields.length > 32 ||
    !Array.isArray(p.files) ||
    p.files.length !== m.variants.length
  )
    throw Error("Invalid plugin manifest");
  const variants = new Set<string>();
  let size = 0;
  for (const file of p.files) record(file, ["name", "bytes", "sha256"]);
  for (const v of m.variants) {
    record(v, ["id", "label", "file", "description"]);
    if (
      !identifier(v.id) ||
      variants.has(v.id) ||
      v.file !== v.id + ".wasm" ||
      !text(v.label, 150) ||
      !v.label ||
      (v.description !== undefined && !text(v.description, 2000))
    )
      throw Error("Invalid plugin variant");
    variants.add(v.id);
    const files = p.files.filter((f) => f.name === v.file);
    if (
      files.length !== 1 ||
      !hash.test(files[0].sha256) ||
      !Number.isSafeInteger(files[0].bytes) ||
      files[0].bytes < 8
    )
      throw Error("Invalid plugin integrity data");
    size += files[0].bytes;
  }
  if (
    size > p.bytes ||
    size > MAX_PLUGIN_BYTES ||
    !variants.has(m.default_variant)
  )
    throw Error("Audio plugin exceeds its size limit");
  const fields = new Set<string>();
  for (const f of m.fields) {
    record(f, [
      "key",
      "label",
      "type",
      "default",
      "min",
      "max",
      "step",
      "scale",
      "export",
      "help",
      "variants",
    ]);
    if (
      !identifier(f.key) ||
      ["constructor", "prototype", "__proto__"].includes(f.key) ||
      fields.has(f.key) ||
      !text(f.label, 100) ||
      !f.label ||
      !["number", "range"].includes(f.type) ||
      [f.min, f.max, f.default, f.step, f.scale].some(
        (n) => !Number.isFinite(n),
      ) ||
      f.min > f.default ||
      f.default > f.max ||
      f.step <= 0 ||
      f.scale <= 0 ||
      f.max - f.min > 1e6 ||
      !Number.isFinite(f.min * f.scale) ||
      !Number.isFinite(f.max * f.scale) ||
      (f.export !== undefined &&
        (typeof f.export !== "string" || !symbol.test(f.export))) ||
      (f.help !== undefined && !text(f.help, 2000))
    )
      throw Error("Invalid plugin controls");
    if (
      f.variants &&
      (!Array.isArray(f.variants) ||
        f.variants.length > 16 ||
        f.variants.some((v) => !variants.has(v)))
    )
      throw Error("Invalid plugin control condition");
    fields.add(f.key);
  }
  if (
    a.process_controls &&
    (!Array.isArray(a.process_controls) ||
      a.process_controls.length > 8 ||
      a.process_controls.some((k) => !fields.has(k)))
  )
    throw Error("Invalid process controls");
  if (m.diagnostics !== undefined) {
    if (!Array.isArray(m.diagnostics) || m.diagnostics.length > 8)
      throw Error("Invalid diagnostics");
    const diagnosticKeys = new Set<string>();
    for (const d of m.diagnostics) {
      record(d, ["key", "label", "export", "variants"]);
      if (
        !identifier(d.key) ||
        diagnosticKeys.has(d.key) ||
        ["__proto__", "constructor", "prototype"].includes(d.key) ||
        !text(d.label, 100) ||
        !d.label ||
        typeof d.export !== "string" ||
        !symbol.test(d.export) ||
        (d.variants &&
          (!Array.isArray(d.variants) ||
            d.variants.length > 16 ||
            d.variants.some((v) => !variants.has(v))))
      )
        throw Error("Invalid diagnostics");
      diagnosticKeys.add(d.key);
    }
  }
  if (m.legacy_preferences !== undefined) {
    const legacy = m.legacy_preferences;
    record(legacy, ["variant_key", "fields"]);
    record(legacy.fields, [...fields]);
    if (
      legacy.variant_key !== "noiseModel" ||
      !legacy.fields ||
      Object.keys(legacy.fields).length > 3 ||
      Object.entries(legacy.fields).some(
        ([k, v]) =>
          !fields.has(k) ||
          !["noiseStrength", "noisePncInputGain", "noiseCsdGate"].includes(v),
      )
    )
      throw Error("Invalid legacy preference mapping");
  }
  return p;
}
export function normalizePluginPreferences(
  p: AudioPlugin,
  raw?: Partial<PluginPreferences>,
): PluginPreferences {
  const values: Record<string, number> = {};
  for (const f of p.manifest.fields) {
    const value = raw?.values?.[f.key];
    values[f.key] =
      typeof value === "number" && Number.isFinite(value)
        ? Math.max(f.min, Math.min(f.max, value))
        : f.default;
  }
  return {
    id: p.manifest.id,
    variant: p.manifest.variants.some((v) => v.id === raw?.variant)
      ? raw!.variant!
      : p.manifest.default_variant,
    values,
  };
}
// Inspect resource declarations BEFORE compilation or instantiation. No shared
// memories, unbounded tables/memory, memory64, GC types, imports of host memory,
// start functions. Custom sections are inert data and are never evaluated.
export function validateWasmResources(buffer: ArrayBuffer) {
  const b = new Uint8Array(buffer);
  let pos = 8;
  if (
    b.length > MAX_PLUGIN_BYTES ||
    b.length < 8 ||
    [...b.slice(0, 8)].join() !== "0,97,115,109,1,0,0,0"
  )
    throw Error("Invalid Wasm module");
  const u32 = () => {
    let n = 0,
      shift = 0;
    for (let i = 0; i < 5; i++) {
      const v = b[pos++];
      if (v === undefined || (i === 4 && v > 15))
        throw Error("Invalid Wasm integer");
      n += (v & 127) * 2 ** shift;
      if (!(v & 128)) return n;
      shift += 7;
    }
    throw Error("Invalid Wasm integer");
  };
  const str = () => {
    const n = u32();
    pos += n;
    if (pos > b.length) throw Error("Invalid Wasm name");
  };
  const limit = (max: number) => {
    const flags = u32();
    if (flags !== 1)
      throw Error("Plugin resources must have a fixed upper bound");
    const min = u32(),
      cap = u32();
    if (min > cap || cap > max) throw Error("Plugin resource limit exceeded");
  };
  let memories = 0;
  while (pos < b.length) {
    const section = b[pos++],
      size = u32(),
      end = pos + size;
    if (end > b.length) throw Error("Invalid Wasm section");
    if (section === 1) {
      const count = u32();
      if (count > 2048) throw Error("Too many function types");
      for (let i = 0; i < count; i++) {
        if (b[pos++] !== 0x60)
          throw Error("GC/reference types are not supported");
        for (let side = 0; side < 2; side++) {
          const args = u32();
          if (args > 32) throw Error("Function signature too large");
          for (let j = 0; j < args; j++)
            if (![0x7f, 0x7e, 0x7d, 0x7c, 0x7b].includes(b[pos++]))
              throw Error("Only numeric function parameters are supported");
        }
      }
    }
    if (section === 8) throw Error("Wasm start functions are not allowed");
    if (section === 2) {
      const count = u32();
      if (count > 8) throw Error("Too many imports");
      for (let i = 0; i < count; i++) {
        str();
        str();
        if (b[pos++] !== 0)
          throw Error("Only allowlisted inert function imports are supported");
        u32();
      }
    }
    if (section === 4) {
      const count = u32();
      if (count > 1) throw Error("Too many tables");
      for (let i = 0; i < count; i++) {
        if (b[pos++] !== 0x70) throw Error("Unsupported reference type");
        limit(8192);
      }
    }
    if (section === 5) {
      if (memories) throw Error("Duplicate memory section");
      memories = u32();
      if (memories !== 1) throw Error("A plugin must own exactly one memory");
      limit(MAX_MEMORY_PAGES);
    }
    if (pos > end) throw Error("Invalid Wasm section length");
    pos = end;
  }
  if (memories !== 1) throw Error("Missing plugin memory");
}
export function validateWasmImports(module: WebAssembly.Module) {
  const inert = new Set([
    "proc_exit",
    "fd_write",
    "fd_close",
    "fd_seek",
    "clock_time_get",
  ]);
  for (const i of WebAssembly.Module.imports(module))
    if (
      i.kind !== "function" ||
      i.module !== "wasi_snapshot_preview1" ||
      !inert.has(i.name)
    )
      throw Error("Plugin requested a forbidden host capability");
}
