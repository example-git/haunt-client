import fs from "node:fs/promises";
import path from "node:path";
import { createHash, createPublicKey } from "node:crypto";
import { fileURLToPath } from "node:url";
const root = new URL("../", import.meta.url);
export async function nativeRuntimeHash(directory) {
  const hash = createHash("sha256");
  async function visit(relative) {
    const entries = await fs.readdir(path.join(directory, relative), {
      withFileTypes: true,
    });
    for (const entry of entries.sort((a, b) =>
      a.name.localeCompare(b.name, "en"),
    )) {
      const name = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile()) {
        const bytes = await fs.readFile(path.join(directory, name));
        hash.update(JSON.stringify([name, bytes.length]));
        hash.update(bytes);
      } else throw Error(`Unsupported native runtime entry: ${name}`);
    }
  }
  await visit("");
  return hash.digest("hex");
}
export async function releaseConfig() {
  const pkg = JSON.parse(await fs.readFile(new URL("package.json", root)));
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-dev\.[1-9]\d*)?$/.test(
      pkg.version,
    )
  )
    throw Error("Expected a stable or development release version");
  const config = JSON.parse(
    await fs.readFile(new URL("static/updates.json", root)),
  );
  const publicKey = process.env.HAUNT_UPDATE_PUBLIC_KEY || config.publicKey;
  if (publicKey && createPublicKey(publicKey).asymmetricKeyType !== "ed25519")
    throw Error("An Ed25519 release key is required");
  return {
    ...config,
    publicKey,
    channel: pkg.version.includes("-dev.") ? "dev" : "stable",
    version: pkg.version,
  };
}
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
  const { version, ...config } = await releaseConfig();
  const nativeRuntime =
    platform === "linux"
      ? await nativeRuntimeHash(
          fileURLToPath(new URL("release/native/linux", root)),
        )
      : undefined;
  const hash = createHash("sha256");
  // Deliberately excludes mutable JS/UI and the release version. Changes to the
  // bootstrap, verifier, native helpers or platform settings require a new shell.
  hash.update(
    JSON.stringify({
      platform,
      arch,
      electron: pkg.devDependencies.electron,
      ...config,
      nativeRuntime,
    }),
  );
  const names = [
    "apps/desktop/bootstrap.cjs",
    "apps/desktop/profile.cjs",
    "apps/desktop/updates.cjs",
    "apps/desktop/mac-install.cjs",
    "electron-app/main.cjs",
    "electron-builder.config.json",
    "scripts/update-runtime.mjs",
  ];
  if (platform === "linux")
    names.push(
      "native/linux-audio.c",
      "native/linux-capture.c",
      "native/linux-capture-launcher/main.go",
      "native/linux-capture-launcher/go.mod",
      "vendor/selkies-gstreamer/manifest.json",
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
    ...(nativeRuntime ? { nativeRuntime } : {}),
    runtime: hash.digest("hex"),
    version,
    platform,
    arch,
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(await runtimeConfig()));
