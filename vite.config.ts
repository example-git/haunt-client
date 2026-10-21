import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
const root = (path: string) => fileURLToPath(new URL(path, import.meta.url));
export default defineConfig(({ command, mode }) => {
  const buildID = command === "build" ? randomUUID() : "development";
  const standalone = mode === "standalone";
  const revision = Number(process.env.HAUNT_WEB_REVISION ?? Date.now());
  if (standalone && (!Number.isSafeInteger(revision) || revision <= 0))
    throw Error("HAUNT_WEB_REVISION must be a positive safe integer.");
  const release = JSON.parse(readFileSync(root("./package.json"), "utf8")).version as string;
  const marker = standalone
    ? { version: 2, id: buildID, release, revision }
    : { version: 1, id: buildID };
  return {
    define: {
      __HAUNT_BUILD_ID__: JSON.stringify(buildID),
      __HAUNT_WEB_BUILD__: JSON.stringify(marker),
    },
    plugins: [
      {
        name: "haunt-build-marker",
        generateBundle() {
          this.emitFile({
            type: "asset",
            fileName: "haunt-build.json",
            source: JSON.stringify(marker),
          });
        },
      },
    ],
    root: root("./apps/web"),
    resolve: {
      alias: {
        "@haunt/core": root("./packages/core/src/index.ts"),
        "@haunt/browser": root("./packages/browser/src"),
      },
    },
    build: {
      outDir: root(standalone ? "./dist-standalone" : "./dist"),
      emptyOutDir: true,
      assetsInlineLimit: 0,
      target: "es2022",
    },
    server: { port: 5173, strictPort: true, fs: { allow: [root(".")] } },
    test: { root: root("."), include: ["tests/*.test.ts"], maxWorkers: 2 },
  };
});
