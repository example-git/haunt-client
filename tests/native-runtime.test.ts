import { afterEach, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const { nativeRuntimeHash, releaseConfig } = await import(
  new URL("../scripts/update-runtime.mjs", import.meta.url).href
);

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await fs.rm(directory, { recursive: true, force: true });
});

it("identifies native library and plugin bytes independently of file timestamps", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "haunt-native-runtime-"),
  );
  directories.push(directory);
  await fs.mkdir(path.join(directory, "lib"));
  await fs.mkdir(path.join(directory, "plugins"));
  const library = path.join(directory, "lib/libgstreamer-1.0.so.0");
  await fs.writeFile(library, "runtime version one");
  const initial = await nativeRuntimeHash(directory);
  await fs.utimes(library, new Date(0), new Date(0));
  expect(await nativeRuntimeHash(directory)).toBe(initial);
  await fs.writeFile(library, "runtime version two");
  expect(await nativeRuntimeHash(directory)).not.toBe(initial);
  await fs.writeFile(library, "runtime version one");
  expect(await nativeRuntimeHash(directory)).toBe(initial);
  await fs.writeFile(path.join(directory, "plugins/libgstx264.so"), "encoder");
  expect(await nativeRuntimeHash(directory)).not.toBe(initial);
  await fs.rm(library);
  expect(await nativeRuntimeHash(directory)).not.toBe(initial);
});

it("loads signing metadata without requiring native build outputs on the manifest runner", async () => {
  const config = await releaseConfig();
  expect(config.version).toMatch(/^\d+\.\d+\.\d+$/);
  expect(config.repository).toBe("example-git/haunt-client");
  expect(config).not.toHaveProperty("runtime");
});
