import { desktopFiles } from "./desktop-files.mjs";
import { nativeRuntimeHash } from "./update-runtime.mjs";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const {
  validateConfiguration,
} = require("app-builder-lib/out/util/config/config.js");
const { DebugLogger } = require("builder-util");
const asar = createRequire(require.resolve("app-builder-lib"))(
  "@electron/asar",
);
const root = fileURLToPath(new URL("..", import.meta.url));
const config = JSON.parse(
  await fs.readFile(path.join(root, "electron-builder.config.json"), "utf8"),
);
await validateConfiguration(config, new DebugLogger(false));
assert.equal(config.directories.app, "electron-app");
assert.equal(config.mac.hardenedRuntime, true);
assert.equal(config.mac.identity, null);
assert.equal(config.dmg.sign, false);
assert.equal(config.mac.notarize, false);
for (const target of config.mac.target)
  assert.deepEqual(target.arch, ["arm64"]);
assert.equal(config.linux.syncDesktopName, true);
assert.equal(config.nsis.perMachine, false);
assert.equal(config.nsis.allowToChangeInstallationDirectory, true);
for (const platform of ["mac", "win", "linux"])
  assert(config[platform].target.length);
for (const name of [config.mac.entitlements, config.mac.entitlementsInherit]) {
  const text = await fs.readFile(path.join(root, name), "utf8");
  assert(text.includes("com.apple.security.cs.allow-jit"));
}
const defaultArchive =
  process.platform === "darwin"
    ? `mac-arm64/${config.productName}.app/Contents/Resources/app.asar`
    : process.platform === "win32"
      ? "win-unpacked/resources/app.asar"
      : `linux${process.arch === "arm64" ? "-arm64" : ""}-unpacked/resources/app.asar`;
const filename = path.resolve(
  root,
  process.argv[2] ?? path.join(config.directories.output, defaultArchive),
);
if (process.platform === "darwin") {
  const native = path.join(
    path.dirname(filename),
    "native/mac/notification-replacement.node",
  );
  const bytes = await fs.readFile(native);
  assert.equal(
    bytes.readUInt32LE(0),
    0xfeedfacf,
    "Notification replacement is a Mach-O binary",
  );
  assert.equal(
    bytes.readUInt32LE(4),
    0x100000c,
    "Notification replacement targets Apple Silicon",
  );
}
if (process.platform === "linux") {
  const directory = path.join(path.dirname(filename), "native/linux");
  const runtime = JSON.parse(asar.extractFile(filename, "update-runtime.json"));
  assert.equal(
    await nativeRuntimeHash(directory),
    runtime.nativeRuntime,
    "The installer supplies the native libraries identified by the updater",
  );
  for (const name of [
    "HauntAudioWorker",
    "HauntShortcutWorker",
    "HauntCaptureWorker",
    "HauntMediaWorker",
  ]) {
    const helper = path.join(path.dirname(filename), "native/linux", name);
    const bytes = await fs.readFile(helper);
    assert.equal(
      bytes.subarray(0, 4).toString("hex"),
      "7f454c46",
      `${name} is ELF`,
    );
    assert.equal(bytes[4], 2, `${name} is 64-bit`);
    assert.equal(bytes[5], 1, `${name} is little-endian`);
    assert.equal(
      bytes.readUInt16LE(18),
      process.arch === "arm64" ? 183 : 62,
      `${name} targets the package architecture`,
    );
    assert((await fs.stat(helper)).mode & 0o111, `${name} is executable`);
  }
}
const packagedIdentity = JSON.parse(
  asar.extractFile(filename, "package.json").toString(),
);
assert.equal(packagedIdentity.desktopName, `${config.appId}.desktop`);
const files = asar
  .listPackage(filename)
  .map((file) => file.replaceAll("\\", "/"));
const allowedDesktopFiles = new Set(
  desktopFiles.map((name) => `/apps/desktop/${name}`),
);
for (const file of files)
  assert(
    allowedDesktopFiles.has(file) ||
      /^\/(main\.cjs|package\.json|update-runtime\.json|apps(\/desktop)?|dist(\/.*)?|resources(\/icon\.png)?)$/.test(
        file,
      ),
    `Unexpected packaged file: ${file}`,
  );
for (const name of [
  "/main.cjs",
  "/update-runtime.json",
  ...desktopFiles.map((name) => `/apps/desktop/${name}`),
  "/apps/desktop/updates.cjs",
  "/package.json",
  "/dist/index.html",
  "/dist/THIRD-PARTY-NOTICES.txt",
  "/apps/desktop/main.cjs",
  "/apps/desktop/preload.cjs",
  "/apps/desktop/media-cache.cjs",
  "/apps/desktop/capture-picker.cjs",
  "/apps/desktop/capture-preload.cjs",
  "/apps/desktop/capture-picker.html",
  "/apps/desktop/capture-picker.js",
  "/apps/desktop/capture-picker.css",
  "/apps/desktop/native-media.cjs",
  "/apps/desktop/native-publisher.cjs",
  "/apps/desktop/swiftcapture.cjs",
  "/resources/icon.png",
  "/dist/brand/trayTemplate.png",
  "/dist/brand/trayTemplate@2x.png",
])
  assert(files.includes(name), `Missing ${name}`);
assert(
  !files.some(
    (file) =>
      /\.(wasm|onnx|tflite)$/i.test(file) &&
      !/^\/dist\/(assets\/haunt_dm_crypto_bg-[A-Za-z0-9_-]+\.wasm|dm-crypto\/haunt_dm_crypto_bg\.wasm)$/.test(
        file,
      ),
  ),
  "Audio models must come from authenticated server packages, not the app bundle",
);
assert(
  files.some((file) => /^\/dist\/assets\/processor-worker-.*\.js$/.test(file)),
  "Missing trusted audio worker host",
);
assert(
  files.some((file) => /^\/dist\/assets\/bridge-worklet-.*\.js$/.test(file)),
  "Missing trusted audio worklet bridge",
);
const pkg = JSON.parse(asar.extractFile(filename, "package.json").toString());
assert.equal(pkg.name, "haunt");
assert.equal(pkg.main, "main.cjs");
assert.equal(pkg.productName, config.productName);
assert.equal(pkg.desktopAppId, config.appId);
assert.deepEqual(
  asar.extractFile(filename, path.join("resources", "icon.png")),
  await fs.readFile(path.join(root, "static/icon.png")),
);
assert.deepEqual(
  asar.extractFile(filename, path.join("dist", "brand", "favicon-32.png")),
  await fs.readFile(path.join(root, "branding/haunt/web/favicon-32.png")),
);
assert.equal(
  pkg.version,
  JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"))
    .version,
);
assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0);
console.log(
  `Builder config validated for Windows, macOS and Linux. Inspected ${files.length} ASAR entries: built UI, licenses, icon and Electron shell and capture picker only.`,
);
