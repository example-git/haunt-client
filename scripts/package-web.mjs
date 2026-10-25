import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = process.argv[2]
  ? path.resolve(process.argv[2])
  : fileURLToPath(new URL("../dist-standalone/", import.meta.url));
const build = JSON.parse(
  await fs.readFile(path.join(root, "haunt-build.json"), "utf8"),
);
if (
  build.version !== 2 ||
  !Number.isSafeInteger(build.revision) ||
  build.revision <= 0
)
  throw Error("A standalone build with an ordered revision is required.");
const files = [];
async function collect(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(filename);
    else if (
      entry.isFile() &&
      !["haunt-build.json", "haunt-sw.js", "_headers", "_redirects"].includes(
        entry.name,
      )
    ) {
      const data = await fs.readFile(filename);
      files.push({
        path: path
          .relative(root, filename)
          .split(path.sep)
          .map(encodeURIComponent)
          .join("/"),
        sha256: createHash("sha256").update(data).digest("hex"),
      });
    }
  }
}
await collect(root);
files.sort((left, right) => left.path.localeCompare(right.path));
if (!files.some((file) => file.path === "index.html"))
  throw Error("Missing application entry point.");
const worker = await fs.readFile(
  new URL("../apps/web/service-worker.js", import.meta.url),
  "utf8",
);
await fs.writeFile(
  path.join(root, "haunt-sw.js"),
  `self.HAUNT_BUILD=${JSON.stringify(build)};\nself.HAUNT_FILES=${JSON.stringify(files)};\n${worker}`,
);
await fs.writeFile(
  path.join(root, "_headers"),
  `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: same-origin
  X-Frame-Options: DENY
  Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' https: http: data: blob:; media-src 'self' https: http: blob:; connect-src 'self' https: wss: http: ws:; worker-src 'self' blob:; manifest-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-src https://www.youtube-nocookie.com; frame-ancestors 'none'; form-action 'none'
/assets/*
  Cache-Control: public, max-age=31536000, immutable
/haunt-build.json
  Cache-Control: no-store
/haunt-sw.js
  Cache-Control: no-store
/index.html
  Cache-Control: no-cache
/
  Cache-Control: no-cache
`,
);
console.log(
  `Packaged standalone web ${build.release}, revision ${build.revision}, ${files.length} cached assets.`,
);
