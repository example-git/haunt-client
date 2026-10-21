// Native macOS CI: exercise the actual post-download Update app IPC, signing,
// replacement and relaunch. The signed input describes the real candidate DMG;
// this same-version reinstall does not claim to test update discovery/download.
import { _electron as electron, chromium, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { generateKeyPairSync, sign, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { captureDesktop } from "./native-notification-ui.mjs";

assert(
  process.env.CI === "true" &&
    process.platform === "darwin" &&
    process.arch === "arm64",
);
const run = promisify(execFile);
const metadata = JSON.parse(
  await fs.readFile("release/updates/darwin-arm64.json", "utf8"),
);
const config = JSON.parse(await fs.readFile("static/updates.json", "utf8"));
const filename = path.resolve("release/updates", metadata.installer.file);
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "haunt-local-update-"));
const profile = path.join(scratch, "profile");
const destination = path.join(scratch, "Haunt.app");
const mount = path.join(scratch, "mounted");
const marker = randomUUID();
const report = {
  kind: "same-version post-download native reinstall",
  version: metadata.version,
  passed: false,
};
let mounted = false,
  app,
  browser,
  replacementPid;
await fs.mkdir("test-results", { recursive: true });
const requirement = async () => {
  const result = await run("codesign", ["-d", "-r-", destination]);
  const value = `${result.stdout}\n${result.stderr}`
    .split("\n")
    .find((line) => line.startsWith("designated =>"));
  assert(value?.includes("certificate leaf"));
  return value;
};
try {
  await fs.mkdir(mount);
  await run("hdiutil", [
    "attach",
    "-readonly",
    "-nobrowse",
    "-mountpoint",
    mount,
    filename,
  ]);
  mounted = true;
  await run(
    "/bin/bash",
    [
      path.resolve("static/mac/Install Haunt.command"),
      "--accept-local-signing",
      "--no-open",
      "--destination",
      destination,
      path.join(mount, "Haunt.app"),
    ],
    { timeout: 300000, maxBuffer: 2 * 1024 * 1024 },
  );
  await run("hdiutil", ["detach", mount]);
  mounted = false;
  report.beforeRequirement = await requirement();
  const beforeInode = (await fs.stat(destination)).ino;
  app = await electron.launch({
    executablePath: path.join(destination, "Contents/MacOS/Haunt"),
    args: [`--user-data-dir=${profile}`],
    timeout: 60000,
  });
  const page = await app.firstWindow();
  await expect(page.locator(".app-titlebar")).toBeVisible({ timeout: 60000 });
  const originalPid = app.process().pid;
  await page.evaluate(
    (value) => localStorage.setItem("haunt-local-update-check", value),
    marker,
  );
  // Only test input/trust data changes. The real verifier, IPC handler, installer,
  // filesystem, codesign, progress events, quit and relaunch remain untouched.
  const keys = generateKeyPairSync("ed25519");
  const payload = Buffer.from(
    JSON.stringify({
      schema: 1,
      repository: config.repository,
      version: metadata.version,
      notes: "Native installer verification",
      targets: { "darwin-arm64": metadata },
    }),
  );
  const envelope = {
    schema: 1,
    payload: payload.toString("base64"),
    signature: sign(null, payload, keys.privateKey).toString("base64"),
  };
  const progressLog = path.join(scratch, "progress.jsonl");
  await app.evaluate(
    ({ app }, input) => {
      const updater = global[Symbol.for("haunt.updater")].updater;
      updater.config.publicKey = input.publicKey;
      updater.downloaded = {
        filename: input.filename,
        envelope: input.envelope,
        kind: "installer",
      };
      updater.on("status", (state) =>
        process
          .getBuiltinModule("fs")
          .appendFileSync(input.progressLog, JSON.stringify(state) + "\n"),
      );
      updater.set({
        phase: "installer-ready",
        kind: "installer",
        available: input.version,
        localSigning: true,
        message: "",
      });
    },
    {
      publicKey: keys.publicKey.export({ type: "spki", format: "pem" }),
      filename,
      envelope,
      version: metadata.version,
      progressLog,
    },
  );
  await page
    .getByRole("button", { name: "Update app", exact: true })
    .first()
    .click();
  await expect(
    page
      .getByRole("progressbar", { name: "Update installation", exact: true })
      .first(),
  ).toBeVisible({ timeout: 30000 });
  await page.screenshot({
    path: "test-results/notification-mac-installer-progress.png",
  });
  await expect
    .poll(() => app.process().exitCode, { timeout: 300000 })
    .not.toBeNull();
  report.progress = (await fs.readFile(progressLog, "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert(
    report.progress.some(
      (state) =>
        state.phase === "installing" &&
        state.progress > 0 &&
        state.progress < 1,
    ),
    "Real signing component progress was published",
  );
  const processes = async () => {
    const { stdout } = await run("ps", ["-axo", "pid=,command="]);
    return stdout
      .split("\n")
      .filter(
        (line) =>
          line.includes(`${destination}/Contents/MacOS/Haunt`) &&
          line.includes(`--user-data-dir=${profile}`) &&
          !line.includes("--type="),
      );
  };
  await expect
    .poll(
      async () => {
        const lines = await processes();
        replacementPid = Number(lines[0]?.trim().split(/\s+/)[0]);
        return lines.length === 1 && replacementPid !== originalPid;
      },
      { timeout: 90000 },
    )
    .toBe(true);
  let endpoint;
  await expect
    .poll(
      async () => {
        try {
          const port = Number(
            (
              await fs.readFile(
                path.join(profile, "DevToolsActivePort"),
                "utf8",
              )
            ).split("\n")[0],
          );
          const response = await fetch(`http://127.0.0.1:${port}/json/version`);
          endpoint = (await response.json()).webSocketDebuggerUrl;
          return Boolean(endpoint);
        } catch {
          return false;
        }
      },
      { timeout: 60000 },
    )
    .toBe(true);
  browser = await chromium.connectOverCDP(endpoint);
  const relaunched = browser.contexts()[0].pages()[0];
  await expect(relaunched.locator(".app-titlebar")).toBeVisible({
    timeout: 60000,
  });
  assert.equal(
    await relaunched.evaluate(() =>
      localStorage.getItem("haunt-local-update-check"),
    ),
    marker,
  );
  assert.equal(
    (await relaunched.evaluate(() => window.hauntDesktop.updates.state()))
      .current,
    metadata.version,
  );
  assert.notEqual(
    (await fs.stat(destination)).ino,
    beforeInode,
    "The bundle was replaced at its original path",
  );
  await run("codesign", ["--verify", "--deep", "--strict", destination]);
  await run("codesign", [
    "--verify",
    "--deep",
    "--strict",
    destination.replace(/\.app$/, ".previous.app"),
  ]);
  report.afterRequirement = await requirement();
  assert.equal(report.afterRequirement, report.beforeRequirement);
  report.originalPid = originalPid;
  report.replacementPid = replacementPid;
  report.profilePreserved = true;
  report.passed = true;
} catch (error) {
  report.error = error.stack;
  await captureDesktop(
    "test-results/notification-mac-installer-failure.png",
  ).catch(() => {});
  throw error;
} finally {
  await fs.writeFile(
    "test-results/mac-local-update.json",
    JSON.stringify(report, null, 2),
  );
  await browser?.close();
  if (replacementPid) {
    try {
      process.kill(replacementPid, "SIGTERM");
    } catch {}
  }
  if (app && app.process().exitCode === null) await app.close();
  if (mounted) await run("hdiutil", ["detach", mount]);
  await fs.rm(scratch, { recursive: true, force: true });
}
