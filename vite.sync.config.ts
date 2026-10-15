import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
const root = (path: string) => fileURLToPath(new URL(path, import.meta.url));
export default defineConfig({
  root: root("./apps/sync-portal"),
  resolve: {
    alias: {
      "@haunt/browser": root("./packages/browser/src"),
      "@haunt/core": root("./packages/core/src/index.ts"),
    },
  },
  build: {
    outDir: root("./dist-sync-portal"),
    emptyOutDir: true,
    target: "es2022",
  },
  server: {
    host: "127.0.0.1",
    port: 5194,
    strictPort: true,
    fs: { allow: [root(".")] },
  },
});
