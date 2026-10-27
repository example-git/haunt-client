import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const manifests = [
  "package.json",
  "package-lock.json",
  "electron-app/package.json",
  "packages/core/package.json",
];
export function validateVersion(version) {
  if (
    !/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})(?:-dev\.[1-9]\d{0,14})?$/.test(
      version ?? "",
    )
  )
    throw Error("Expected X.Y.Z or X.Y.Z-dev.N");
  return version;
}
export async function writeVersions(cwd, version) {
  validateVersion(version);
  const updates = [];
  for (const name of manifests) {
    const filename = path.join(cwd, name);
    const value = JSON.parse(await fs.readFile(filename, "utf8"));
    value.version = version;
    if (name === "package-lock.json") {
      if (!value.packages?.[""] || !value.packages["packages/core"])
        throw Error("Missing workspace lockfile entries");
      value.packages[""].version = version;
      value.packages["packages/core"].version = version;
    }
    updates.push([filename, value]);
  }
  for (const [filename, value] of updates)
    await fs.writeFile(filename, `${JSON.stringify(value, null, 2)}\n`);
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [version, directory] = process.argv.slice(2);
  if (!version)
    throw Error("Usage: version-main.mjs VERSION [client-directory]");
  await writeVersions(
    directory
      ? path.resolve(directory)
      : fileURLToPath(new URL("../", import.meta.url)),
    version,
  );
}
