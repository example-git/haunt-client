import fs from "node:fs/promises";
import { createHash, createPublicKey } from "node:crypto";
import { fileURLToPath } from "node:url";
const root = new URL("../", import.meta.url);
export async function runtimeConfig(
  platform = process.platform,
  arch = process.arch,
) {
  if (
    !["win32-x64", "linux-x64", "linux-arm64", "darwin-arm64"].includes(
      `${platform}-${arch}`,
    )
  )
    throw Error("Unsupported desktop target");
  const pkg = JSON.parse(await fs.readFile(new URL("package.json", root)));
  const config = JSON.parse(
    await fs.readFile(new URL("static/updates.json", root)),
  );
  const publicKey = process.env.HAUNT_UPDATE_PUBLIC_KEY || config.publicKey;
  if (publicKey && createPublicKey(publicKey).asymmetricKeyType !== "ed25519")
    throw Error("An Ed25519 release key is required");
  const hash = createHash("sha256");
  // Deliberately excludes mutable JS/UI and the release version. Changes to the
  // bootstrap, verifier, native helpers or platform settings require a new shell.
  hash.update(
    JSON.stringify({
      platform,
      arch,
      electron: pkg.devDependencies.electron,
      ...config,
      publicKey,
    }),
  );
  const names = [
    "apps/desktop/bootstrap.cjs",
    "apps/desktop/profile.cjs",
    "apps/desktop/updates.cjs",
    "apps/desktop/mac-install.cjs",
    "electron-app/main.cjs",
    "electron-builder.config.json",
  ];
  if (platform === "linux")
    names.push(
      "native/linux-audio.c",
      "native/linux-capture.c",
      "native/media-worker/main.go",
      "native/media-worker/go.mod",
      "native/media-worker/go.sum",
      "scripts/build-linux-capture.mjs",
      "native/linux-shortcuts.c",
      "scripts/build-linux-audio.mjs",
      "static/linux/package-type",
      "static/linux/rpm-after-remove.sh",
      "static/linux/rpm-after-install.sh",
      "static/linux/rpm-before-install.sh",
      "static/linux/rpm-after-transaction.sh",
    );
  if (platform === "darwin")
    names.push(
      "native/mac-notifications/replacement.m",
      "scripts/build-notification-replacement.mjs",
      "electron-app/entitlements.mac.plist",
      "electron-app/entitlements.mac.inherit.plist",
      "static/mac/Install Haunt.command",
      "static/mac/finish-update.sh",
      "static/mac/commit-install.sh",
      "static/native/mac/SwiftCaptureWorker",
      "static/native/mac/HauntMediaWorker",
    );
  for (const name of names) {
    hash.update(name);
    hash.update(await fs.readFile(new URL(name, root)));
  }
  return {
    ...config,
    publicKey,
    runtime: hash.digest("hex"),
    version: pkg.version,
    platform,
    arch,
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(await runtimeConfig()));
