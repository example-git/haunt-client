import { randomUUID } from "node:crypto";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
const root = (path: string) => fileURLToPath(new URL(path, import.meta.url));
export default defineConfig(({ command }) => {
  const buildID = command === "build" ? randomUUID() : "development";
  return {
    define: { __HAUNT_BUILD_ID__: JSON.stringify(buildID) },
    plugins: [
      {
        name: "haunt-build-marker",
        generateBundle() {
          this.emitFile({
            type: "asset",
            fileName: "haunt-build.json",
            source: JSON.stringify({ version: 1, id: buildID }),
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
      outDir: root("./dist"),
      emptyOutDir: true,
      assetsInlineLimit: 0,
      target: "es2022",
    },
    server: { port: 5173, strictPort: true, fs: { allow: [root(".")] } },
    test: { root: root("."), include: ["tests/*.test.ts"], maxWorkers: 2 },
  };
});
