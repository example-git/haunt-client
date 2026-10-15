// Explicit maintainer build; ordinary web/Electron builds use verified artifacts.
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
function run(command, args) {
  const r = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS || "2",
    },
  });
  if (r.error) throw r.error;
  if (r.status) throw Error(`${command} exited ${r.status}`);
}
run("cargo", [
  "build",
  "--release",
  "--locked",
  "--target",
  "wasm32-unknown-unknown",
  "--manifest-path",
  "native/dm-crypto/Cargo.toml",
]);
const local = path.resolve(root, "../var/tools/bin/wasm-bindgen");
const bindgen =
  process.env.WASM_BINDGEN ||
  (await fs.access(local).then(
    () => local,
    () => "wasm-bindgen",
  ));
run(bindgen, [
  "native/dm-crypto/target/wasm32-unknown-unknown/release/haunt_dm_crypto.wasm",
  "--target",
  "web",
  "--out-dir",
  "static/dm-crypto",
]);
const r = spawnSync(
  "cargo",
  [
    "metadata",
    "--locked",
    "--offline",
    "--filter-platform",
    "wasm32-unknown-unknown",
    "--format-version",
    "1",
    "--manifest-path",
    "native/dm-crypto/Cargo.toml",
  ],
  { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
);
if (r.status) throw Error(r.stderr);
let notices =
  "Haunt DM encryption uses OpenMLS 0.9.0 (MIT).\nhttps://github.com/openmls/openmls\n\n";
for (const pkg of JSON.parse(r.stdout).packages) {
  if (pkg.name === "haunt-dm-crypto") continue;
  const dir = path.dirname(pkg.manifest_path);
  notices += `${pkg.name} ${pkg.version} — ${pkg.license || "see source"}\n${pkg.repository || ""}\n`;
  for (const name of await fs.readdir(dir))
    if (/^(LICENSE|COPYING|NOTICE)([.-]|$)/i.test(name)) {
      const file = path.join(dir, name);
      if ((await fs.stat(file)).isFile())
        notices += (await fs.readFile(file, "utf8")) + "\n";
    }
  notices += "\n";
}
await fs.writeFile(
  path.join(root, "native/dm-crypto/THIRD-PARTY-NOTICES.txt"),
  notices,
);
process.argv.push("--write");
await import("./check-dm-crypto.mjs");
