import fs from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../", import.meta.url);
const native = new URL("static/native/mac/", root);
const manifest = JSON.parse(
  await fs.readFile(new URL("manifest.json", native), "utf8"),
);
for (const [name, hash] of Object.entries(manifest.binaries)) {
  const data = await fs.readFile(new URL(name, native));
  if (data.readUInt32LE(0) !== 0xfeedfacf || data.readUInt32LE(4) !== 0x100000c)
    throw Error(`${name} is not a macOS arm64 executable`);
  if (createHash("sha256").update(data).digest("hex") !== hash)
    throw Error(`${name} does not match its build manifest`);
}
for (const [name, hash] of Object.entries(manifest.sources)) {
  const data = await fs.readFile(new URL(name, root));
  if (createHash("sha256").update(data).digest("hex") !== hash)
    throw Error(
      "Native media publisher is stale. Run npm run build:native-media before packaging.",
    );
}
console.log("Native capture resources verified (macOS arm64).");
