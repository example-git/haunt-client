import { describe, it, expect } from "vitest";
import fs from "node:fs";
import {
  validatePlugin,
  validateWasmResources,
  validateWasmImports,
  normalizePluginPreferences,
} from "../packages/browser/src/audio-plugins/contract";
import { createHash } from "node:crypto";
const raw = fs.readFileSync(
  new URL("fixtures/audio-plugin/default.wasm", import.meta.url),
);
const bytes = raw.buffer.slice(
  raw.byteOffset,
  raw.byteOffset + raw.byteLength,
) as ArrayBuffer;
const manifest = JSON.parse(
  fs.readFileSync(
    new URL("fixtures/audio-plugin/manifest.json", import.meta.url),
    "utf8",
  ),
);
const plugin = {
  manifest,
  digest: "a".repeat(64),
  bytes: raw.length + 1000,
  files: [
    {
      name: "default.wasm",
      bytes: raw.length,
      sha256: createHash("sha256").update(raw).digest("hex"),
    },
  ],
};
describe("audio plugin security and schema", () => {
  it("accepts the independent public ABI example and runs sample-preserving PCM", () => {
    validatePlugin(plugin);
    validateWasmResources(bytes);
    const module = new WebAssembly.Module(bytes);
    validateWasmImports(module);
    const w = new WebAssembly.Instance(module).exports as any;
    w._initialize();
    expect(w.audio_init()).toBe(1);
    const input = new Float32Array(w.memory.buffer, w.audio_input(), 720),
      output = new Float32Array(w.memory.buffer, w.audio_output(), 720);
    input.fill(0.25);
    expect(w.audio_process(0.5)).toBe(0);
    expect(output.every((v) => v === 0.125)).toBe(true);
  });
  it("rejects JS, unbounded or excessive memory, and start functions before executing anything", () => {
    const head = [0, 97, 115, 109, 1, 0, 0, 0];
    for (const section of [
      [5, 3, 1, 0, 1],
      [5, 5, 1, 1, 1, 0x81, 0x08],
      [8, 1, 0],
      [5, 4, 1, 3, 1, 1],
    ])
      expect(() =>
        validateWasmResources(new Uint8Array([...head, ...section]).buffer),
      ).toThrow();
    expect(() =>
      validateWasmResources(
        new TextEncoder().encode("fetch('https://evil.test')").buffer,
      ),
    ).toThrow();
    const importModule = new Uint8Array([
      ...head,
      1,
      4,
      1,
      0x60,
      0,
      0,
      2,
      13,
      1,
      3,
      101,
      110,
      118,
      5,
      102,
      101,
      116,
      99,
      104,
      0,
      0,
    ]);
    expect(() =>
      validateWasmImports(new WebAssembly.Module(importModule)),
    ).toThrow("forbidden host capability");
  });
  it("rejects oversized packages, unknown field types and invalid export bindings", () => {
    expect(() =>
      validatePlugin({ ...plugin, bytes: 50 * 1024 * 1024 + 1 }),
    ).toThrow();
    expect(() =>
      validatePlugin({
        ...plugin,
        manifest: {
          ...manifest,
          fields: [{ ...manifest.fields[0], type: "javascript" }],
        },
      }),
    ).toThrow();
    expect(() =>
      validatePlugin({
        ...plugin,
        manifest: {
          ...manifest,
          abi: { ...manifest.abi, process: "fetch(url)" },
        },
      }),
    ).toThrow();
    expect(
      normalizePluginPreferences(plugin as any, { values: { level: Infinity } })
        .values.level,
    ).toBe(100);
  });
});

it("rejects executable metadata, prototype keys, missing IDs and nonfinite scaling", () => {
  for (const replacement of [
    { ...manifest, id: undefined },
    { ...manifest, id: "constructor" },
    { ...manifest, script: "fetch('/api/v1/auth/session')" },
    { ...manifest, variants: [null] },
    { ...manifest, fields: [{ ...manifest.fields[0], key: "prototype" }] },
    { ...manifest, fields: [{ ...manifest.fields[0], scale: 1e308 }] },
    {
      ...manifest,
      diagnostics: [{ key: "constructor", label: "Score", export: "score" }],
    },
    {
      ...manifest,
      legacy_preferences: {
        variant_key: "noiseModel",
        fields: { level: "password" },
      },
    },
  ])
    expect(() =>
      validatePlugin({ ...plugin, manifest: replacement }),
    ).toThrow();
});
