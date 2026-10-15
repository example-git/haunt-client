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
assert.equal(config.mac.notarize, false);
for (const target of config.mac.target)
  assert.deepEqual(target.arch, ["arm64"]);
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
const files = asar
  .listPackage(filename)
  .map((file) => file.replaceAll("\\", "/"));
for (const file of files)
  assert(
    /^\/(main\.cjs|package\.json|update-runtime\.json|apps(\/desktop(\/((main|bootstrap|updates|preload|network|media-cache|notifications|capture-preload|capture-picker|swiftcapture|native-media|native-publisher)\.cjs|capture-picker\.(html|js|css)))?)?|dist(\/.*)?|resources(\/icon\.png)?)$/.test(
      file,
    ),
    `Unexpected packaged file: ${file}`,
  );
for (const name of [
  "/main.cjs",
  "/update-runtime.json",
  "/apps/desktop/bootstrap.cjs",
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
