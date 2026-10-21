import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export async function buildNotificationReplacement() {
  if (process.platform !== "darwin") return;
  assert.equal(process.arch, "arm64", "macOS packaging requires Apple Silicon");
  const root = fileURLToPath(new URL("../", import.meta.url));
  const include = path.resolve(
    path.dirname(process.execPath),
    "../include/node",
  );
  await fs.access(path.join(include, "node_api.h"));
  const directory = path.join(root, "release/native/mac");
  await fs.mkdir(directory, { recursive: true });
  await promisify(execFile)("xcrun", [
    "clang",
    "-arch",
    "arm64",
    "-mmacosx-version-min=12.0",
    "-bundle",
    "-undefined",
    "dynamic_lookup",
    "-fobjc-arc",
    "-O2",
    "-I",
    include,
    "-framework",
    "Foundation",
    "-framework",
    "UserNotifications",
    path.join(root, "native/mac-notifications/replacement.m"),
    "-o",
    path.join(directory, "notification-replacement.node"),
  ]);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await buildNotificationReplacement();
