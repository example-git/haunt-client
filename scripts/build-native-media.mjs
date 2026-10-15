import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = new URL("../", import.meta.url);
const directory = new URL("static/native/mac/", root);
await fs.mkdir(directory, { recursive: true });
execFileSync(
  "go",
  [
    "build",
    "-trimpath",
    "-ldflags=-s -w",
    "-o",
    fileURLToPath(new URL("HauntMediaWorker", directory)),
    ".",
  ],
  {
    cwd: new URL("native/media-worker/", root),
    env: { ...process.env, CGO_ENABLED: "0", GOOS: "darwin", GOARCH: "arm64" },
    stdio: "inherit",
  },
);
const digest = async (path) =>
  createHash("sha256")
    .update(await fs.readFile(path))
    .digest("hex");
const binaries = {};
for (const name of ["SwiftCaptureWorker", "HauntMediaWorker"]) {
  const path = new URL(name, directory);
  await fs.chmod(path, 0o755);
  binaries[name] = await digest(path);
}
const sources = {};
for (const name of [
  "native/media-worker/main.go",
  "native/media-worker/go.mod",
  "native/media-worker/go.sum",
])
  sources[name] = await digest(new URL(name, root));
await fs.writeFile(
  new URL("manifest.json", directory),
  JSON.stringify(
    {
      platform: "darwin",
      arch: "arm64",
      swiftCaptureSource:
        "Owner-supplied watch-client/resources/swiftcapture/mac/SwiftCaptureWorker",
      binaries,
      sources,
    },
    null,
    2,
  ) + "\n",
);
let notices =
  "Haunt native media helpers\n\nSwiftCaptureWorker: owner-supplied prebuilt macOS arm64 helper from the watch client. Copied unchanged; no SRT/RTMP components are invoked by Haunt.\n\nHauntMediaWorker uses Pion WebRTC and the Go runtime.\n\n";
const modules = new Set(
  execFileSync(
    "go",
    ["list", "-deps", "-f", "{{if .Module}}{{.Module.Dir}}{{end}}", "."],
    { cwd: new URL("native/media-worker/", root), encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean),
);
modules.delete(fileURLToPath(new URL("../", root)).replace(/\/$/, ""));
modules.add(execFileSync("go", ["env", "GOROOT"], { encoding: "utf8" }).trim());
for (const directory of [...modules].sort()) {
  for (const name of ["LICENSE", "LICENSE.md", "LICENSE.txt"]) {
    try {
      notices += `${path.basename(directory)}\n${await fs.readFile(path.join(directory, name), "utf8")}\n\n`;
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}
await fs.writeFile(new URL("NOTICE.txt", directory), notices);
await import("./check-native-media.mjs");
