import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import { releaseConfig, runtimeConfig } from "./update-runtime.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const { verifyManifest } = require("../apps/desktop/updates.cjs");
const command = process.argv[2];
const directory = path.resolve(
  process.argv[3] || path.join(root, "release/updates"),
);
if (command === "keygen") {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.writeFile(
    path.join(directory, "update-private.pem"),
    privateKey.export({ type: "pkcs8", format: "pem" }),
    { flag: "wx", mode: 0o600 },
  );
  await fs.writeFile(
    path.join(directory, "update-public.pem"),
    publicKey.export({ type: "spki", format: "pem" }),
    { flag: "wx" },
  );
  console.log(
    "Created update-private.pem and update-public.pem. Keep the private key out of source control.",
  );
} else if (command === "pack") {
  const config = await runtimeConfig();
  if (!config.publicKey)
    throw Error("Configure HAUNT_UPDATE_PUBLIC_KEY before making a release");
  const stage = path.join(root, "electron-app");
  const staged = JSON.parse(
    await fs.readFile(path.join(stage, "update-runtime.json")),
  );
  if (staged.runtime !== config.runtime || staged.version !== config.version)
    throw Error("Restage the desktop application before publishing");
  await fs.mkdir(directory, { recursive: true });
  const key = `${config.platform}-${config.arch}`;
  const file = `Haunt-${config.version}-${key}.asar`;
  const builder = path.join(root, "release/builder");
  const packed =
    config.platform === "darwin"
      ? `mac-arm64/${config.channel === "dev" ? "Haunt Dev" : "Haunt"}.app/Contents/Resources/app.asar`
      : config.platform === "win32"
        ? "win-unpacked/resources/app.asar"
        : `linux${config.arch === "arm64" ? "-arm64" : ""}-unpacked/resources/app.asar`;
  // Distribute the exact archive inspected in the baseline package, with the
  // builder's allowlist applied, rather than repacking the working directory.
  await fs.copyFile(path.join(builder, packed), path.join(directory, file));
  const ext =
    config.platform === "win32"
      ? ".exe"
      : config.platform === "darwin"
        ? ".dmg"
        : ".AppImage";
  const expected =
    config.platform === "win32"
      ? `Haunt-Setup-${config.version}-${config.arch}${ext}`
      : `Haunt-${config.version}-${config.platform === "darwin" ? "mac" : "linux"}-${config.arch}${ext}`;
  const builtName =
    config.platform === "linux" && config.arch === "x64"
      ? expected.replace("-x64.AppImage", "-x86_64.AppImage")
      : expected;
  await fs.copyFile(
    path.join(builder, builtName),
    path.join(directory, expected),
  );
  let rpm;
  if (config.platform === "linux" && config.channel === "stable") {
    rpm = `Haunt-${config.version}-linux-${config.arch}.rpm`;
    const builtRPM = rpm.replace(
      `-${config.arch}.rpm`,
      `-${config.arch === "x64" ? "x86_64" : "aarch64"}.rpm`,
    );
    await fs.copyFile(path.join(builder, builtRPM), path.join(directory, rpm));
  }
  const describe = async (file) => {
    const bytes = await fs.readFile(path.join(directory, file));
    return {
      file,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  };
  await fs.writeFile(
    path.join(directory, `${key}.json`),
    JSON.stringify(
      {
        version: config.version,
        repository: config.repository,
        target: key,
        runtime: config.runtime,
        asar: await describe(file),
        installer: await describe(expected),
        ...(rpm ? { rpm: await describe(rpm) } : {}),
      },
      null,
      2,
    ),
  );
  console.log(`Prepared ${key} payload and baseline installer.`);
} else if (command === "manifest") {
  const config = await releaseConfig();
  if (config.channel !== "stable")
    throw Error("Development builds cannot publish a stable update manifest");
  const key = createPrivateKey(
    process.env.HAUNT_UPDATE_PRIVATE_KEY ||
      (await fs.readFile(process.env.HAUNT_UPDATE_PRIVATE_KEY_FILE)),
  );
  if (
    key.asymmetricKeyType !== "ed25519" ||
    createPublicKey(key)
      .export({ type: "spki", format: "pem" })
      .toString()
      .trim() !== config.publicKey?.trim()
  )
    throw Error("Release private key does not match the client public key");
  const targets = {};
  for (const target of [
    "win32-x64",
    "linux-x64",
    "linux-arm64",
    "darwin-arm64",
  ]) {
    const entry = JSON.parse(
      await fs.readFile(path.join(directory, `${target}.json`)),
    );
    if (
      entry.version !== config.version ||
      entry.repository !== config.repository ||
      entry.target !== target
    )
      throw Error(`Mismatched release artifact: ${target}`);
    if (target.startsWith("linux-") && !entry.rpm)
      throw Error(`Missing Fedora installer: ${target}`);
    for (const artifact of [
      entry.asar,
      entry.installer,
      ...(entry.rpm ? [entry.rpm] : []),
    ]) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,160}$/.test(artifact.file))
        throw Error("Invalid artifact path");
      const bytes = await fs.readFile(path.join(directory, artifact.file));
      if (
        bytes.length !== artifact.size ||
        createHash("sha256").update(bytes).digest("hex") !== artifact.sha256
      )
        throw Error("Release artifact checksum mismatch");
    }
    targets[target] = {
      runtime: entry.runtime,
      asar: entry.asar,
      installer: entry.installer,
      ...(entry.rpm ? { rpm: entry.rpm } : {}),
    };
  }
  const notes = process.env.HAUNT_RELEASE_NOTES || `Haunt ${config.version}`;
  const bytes = Buffer.from(
    JSON.stringify({
      schema: 1,
      repository: config.repository,
      version: config.version,
      notes,
      targets,
    }),
  );
  const envelope = {
    schema: 1,
    payload: bytes.toString("base64"),
    signature: sign(null, bytes, key).toString("base64"),
  };
  for (const target of Object.keys(targets))
    verifyManifest(envelope, config, ...target.split("-"));
  await fs.writeFile(
    path.join(directory, "haunt-updates.json"),
    JSON.stringify(envelope),
  );
  console.log("All four target artifacts verified; release manifest signed.");
} else
  throw Error("Usage: release-client.mjs keygen|pack|manifest [directory]");
