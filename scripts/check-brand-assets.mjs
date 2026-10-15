import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("..", import.meta.url));
const kit = path.join(root, "branding/haunt");
const manifest = JSON.parse(
  await fs.readFile(path.join(kit, "asset-manifest.json"), "utf8"),
);
const hash = async (name) =>
  createHash("sha256")
    .update(await fs.readFile(name))
    .digest("hex");
assert.equal(
  await hash(path.join(kit, "source/logo-original.png")),
  manifest.source_sha256,
);
let checked = 0;
for (const asset of manifest.assets) {
  let target;
  if (asset.path.startsWith("web/") && asset.path !== "web/site.webmanifest")
    target = "apps/web/public/brand/" + path.basename(asset.path);
  else if (/^png\/logo-(32|48|64|96|128|256)\.png$/.test(asset.path))
    target = "apps/web/public/brand/" + path.basename(asset.path);
  else if (/^desktop\/icon\.(png|ico|icns)$/.test(asset.path))
    target = "static/" + path.basename(asset.path);
  else if (asset.path.startsWith("desktop/linux/"))
    target = "static/icons/" + path.basename(asset.path);
  if (target) {
    assert.equal(
      await hash(path.join(root, target)),
      asset.sha256,
      `Artwork differs from the kit: ${target}`,
    );
    checked++;
  }
}
assert(checked > 20);
console.log(
  `Haunt original and ${checked} installed icon exports match the supplied hashes.`,
);

const vector = await fs.readFile(
  path.join(root, "static/notification-mark.svg"),
  "utf8",
);
assert(vector.includes('fill="#fff"') && !/<image|data:|<script/i.test(vector));
assert.equal(
  await fs.readFile(
    path.join(root, "apps/web/public/brand/notification-mark.svg"),
    "utf8",
  ),
  vector,
);
