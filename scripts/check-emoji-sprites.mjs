import fs from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../", import.meta.url);
const files = JSON.parse(
  await fs.readFile(new URL("vendor/twemoji/sprites.json", root), "utf8"),
);
for (const [path, expected] of Object.entries(files)) {
  const actual = createHash("sha256")
    .update(await fs.readFile(new URL(path, root)))
    .digest("hex");
  if (actual !== expected)
    throw Error(`Emoji sprite checksum mismatch: ${path}`);
}
console.log("Twemoji sprite checksums verified.");
