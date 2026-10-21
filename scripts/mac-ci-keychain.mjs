import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { captureDesktop } from "./native-notification-ui.mjs";

const run = promisify(execFile);
const stateFile = () =>
  path.join(process.env.RUNNER_TEMP, "haunt-ci-keychain.json");
const requireRunner = () =>
  assert(
    process.env.CI === "true" &&
      process.platform === "darwin" &&
      process.env.RUNNER_TEMP,
  );

// The production installer creates and imports its own identity. A private,
// real keychain supplies a known password for the native permission dialog.
export async function prepareSigningKeychain() {
  requireRunner();
  try {
    return JSON.parse(await fs.readFile(stateFile(), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const previousDefault = (
    await run("security", ["default-keychain", "-d", "user"])
  ).stdout
    .trim()
    .replace(/^"|"$/g, "");
  const previous = [
    ...(
      await run("security", ["list-keychains", "-d", "user"])
    ).stdout.matchAll(/"([^"\n]+)"/g),
  ].map((match) => match[1]);
  const keychain = path.join(
    process.env.RUNNER_TEMP,
    "haunt-ci-signing.keychain-db",
  );
  const password = randomUUID();
  await run("security", ["create-keychain", "-p", password, keychain]);
  const state = { keychain, password, previous, previousDefault };
  await fs.writeFile(stateFile(), JSON.stringify(state), { mode: 0o600 });
  await run("security", ["unlock-keychain", "-p", password, keychain]);
  await run("security", ["set-keychain-settings", "-lut", "3600", keychain]);
  await run("security", [
    "list-keychains",
    "-d",
    "user",
    "-s",
    keychain,
    ...previous,
  ]);
  await run("security", ["default-keychain", "-d", "user", "-s", keychain]);
  return state;
}

export async function acceptSigningPermission(state) {
  const filename = "test-results/notification-mac-keychain-permission.png";
  await captureDesktop(filename);
  const { stdout } = await run("tesseract", [filename, "stdout", "tsv"]);
  const words = stdout
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => {
      const parts = line.split("\t");
      return {
        x: Number(parts[6]),
        y: Number(parts[7]),
        width: Number(parts[8]),
        height: Number(parts[9]),
        text: parts.slice(11).join("\t"),
      };
    })
    .filter((word) => word.text);
  const text = words.map((word) => word.text).join(" ");
  if (
    !text.includes("codesign wants to access key") ||
    !text.includes("haunt-ci-signing")
  )
    return false;
  const password = words.find((word) => word.text.startsWith("Password"));
  const always = words.find(
    (word, index) =>
      word.text === "Always" && words[index + 1]?.text === "Allow",
  );
  assert(
    password && always,
    "The real codesign permission dialog exposes its password field and Always Allow button",
  );
  const factor = Number(
    (
      await run("osascript", [
        "-l",
        "JavaScript",
        "-e",
        "ObjC.import('AppKit'); $.NSScreen.mainScreen.backingScaleFactor",
      ])
    ).stdout.trim(),
  );
  assert(factor > 0 && factor <= 3);
  const point = (x, y) =>
    `c:${Math.round(x / factor)},${Math.round(y / factor)}`;
  await run("cliclick", [
    point(password.x + password.width + 120, password.y + password.height / 2),
    `t:${state.password}`,
    point(always.x + always.width / 2, always.y + always.height / 2),
  ]);
  await fs.writeFile(
    "test-results/mac-keychain-consent.json",
    JSON.stringify(
      {
        keychain: path.basename(state.keychain),
        method:
          "Entered the disposable keychain password and clicked Always Allow in the real codesign permission dialog",
        screenshot: filename,
      },
      null,
      2,
    ),
  );
  return true;
}

export async function cleanSigningKeychain() {
  requireRunner();
  let state;
  try {
    state = JSON.parse(await fs.readFile(stateFile(), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  await run("security", [
    "default-keychain",
    "-d",
    "user",
    "-s",
    state.previousDefault,
  ]);
  await run("security", [
    "list-keychains",
    "-d",
    "user",
    "-s",
    ...state.previous,
  ]);
  await run("security", ["delete-keychain", state.keychain]);
  await fs.rm(stateFile());
}

if (process.argv[2] === "cleanup") await cleanSigningKeychain();
