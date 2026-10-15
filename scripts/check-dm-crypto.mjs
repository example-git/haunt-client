import fs from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../", import.meta.url);
const files = [
  "native/dm-crypto/Cargo.toml",
  "native/dm-crypto/Cargo.lock",
  "native/dm-crypto/src/lib.rs",
  "native/dm-crypto/THIRD-PARTY-NOTICES.txt",
  "static/dm-crypto/haunt_dm_crypto.js",
  "static/dm-crypto/haunt_dm_crypto_bg.wasm",
  "static/dm-crypto/haunt_dm_crypto.d.ts",
  "static/dm-crypto/haunt_dm_crypto_bg.wasm.d.ts",
];
const hashes = Object.fromEntries(
  await Promise.all(
    files.map(async (name) => [
      name,
      createHash("sha256")
        .update(await fs.readFile(new URL(name, root)))
        .digest("hex"),
    ]),
  ),
);
const manifest = new URL("static/dm-crypto/manifest.json", root);
if (process.argv.includes("--write"))
  await fs.writeFile(
    manifest,
    JSON.stringify(
      { openmls: "0.9.0", wasmBindgen: "0.2.105", hashes },
      null,
      2,
    ) + "\n",
  );
else {
  const saved = JSON.parse(await fs.readFile(manifest, "utf8"));
  for (const [name, hash] of Object.entries(hashes))
    if (saved.hashes[name] !== hash)
      throw Error(
        `DM crypto artifact/source mismatch: ${name}. Run npm run build:dm-crypto with Rust wasm32 and wasm-bindgen 0.2.105.`,
      );
  console.log("OpenMLS source and portable WebAssembly artifacts verified.");
}
