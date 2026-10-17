// Native CI only. Install two real releases into a private directory/profile.
// This tests full-installer replacement; the automatic ASAR restart is a separate
// qualification case and is never inferred from this result.
import { _electron as electron, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

if (process.env.CI !== "true")
  throw Error("Run this installer rehearsal on a disposable native CI runner");
const run = promisify(execFile);
const require = createRequire(import.meta.url);
const { verifyManifest } = require("../apps/desktop/updates.cjs");
const target = `${process.platform}-${process.arch}`;
assert(
  ["win32-x64", "linux-x64", "linux-arm64", "darwin-arm64"].includes(target),
);
const current = JSON.parse(
  await fs.readFile(`release/updates/${target}.json`, "utf8"),
);
const config = JSON.parse(await fs.readFile("static/updates.json", "utf8"));
config.publicKey = process.env.HAUNT_UPDATE_PUBLIC_KEY || config.publicKey;
const compare = (a, b) => {
  const x = a.split(".").map(Number),
    y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};
const { stdout } = await run("gh", [
  "release",
  "list",
  "--repo",
  config.repository,
  "--limit",
  "100",
  "--json",
  "tagName,isDraft,isPrerelease",
]);
const previousTag = JSON.parse(stdout)
  .filter(
    (release) =>
      !release.isDraft &&
      !release.isPrerelease &&
      /^client-v\d+\.\d+\.\d+$/.test(release.tagName),
  )
  .map((release) => release.tagName)
  .filter((tag) => compare(tag.slice(8), current.version) < 0)
  .sort((a, b) => compare(b.slice(8), a.slice(8)))[0];
assert(
  previousTag,
  "An earlier published installer is required; no upgrade is claimed without one",
);
const scratch = await fs.mkdtemp(
  path.join(os.tmpdir(), "haunt-installed-upgrade-"),
);
const downloads = path.join(scratch, "downloads");
const installed = path.join(scratch, "installed");
const profile = path.join(scratch, "profile");
await fs.mkdir(downloads);
await fs.mkdir(installed);
const marker = randomUUID();
let app;
const report = {
  target,
  from: previousTag.slice(8),
  to: current.version,
  kind: "full-installer",
  passed: false,
};
async function verifiedFile(directory, descriptor) {
  const filename = path.join(directory, descriptor.file);
  const bytes = await fs.readFile(filename);
  assert.equal(
    bytes.length,
    descriptor.size,
    "Installer size matches metadata",
  );
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    descriptor.sha256,
    "Installer checksum matches metadata",
  );
  return filename;
}
async function install(filename) {
  if (process.platform === "win32") {
    await run(filename, ["/S", `/D=${installed}`], { timeout: 180000 });
    return path.join(installed, "haunt.exe");
  }
  if (process.platform === "darwin") {
    const mount = path.join(scratch, "mounted");
    await fs.mkdir(mount, { recursive: true });
    await run("hdiutil", [
      "attach",
      "-readonly",
      "-nobrowse",
      "-mountpoint",
      mount,
      filename,
    ]);
    try {
      await fs.rm(path.join(installed, "Haunt.app"), {
        recursive: true,
        force: true,
      });
      await run("ditto", [
        path.join(mount, "Haunt.app"),
        path.join(installed, "Haunt.app"),
      ]);
    } finally {
      await run("hdiutil", ["detach", mount]);
    }
    return path.join(installed, "Haunt.app/Contents/MacOS/Haunt");
  }
  await fs.chmod(filename, 0o755);
  await fs.rm(path.join(installed, "squashfs-root"), {
    recursive: true,
    force: true,
  });
  await run(filename, ["--appimage-extract"], {
    cwd: installed,
    maxBuffer: 16 * 1024 * 1024,
  });
  return path.join(installed, "squashfs-root/haunt");
}
async function launch(executablePath, version, restore) {
  app = await electron.launch({
    executablePath,
    args: [
      `--user-data-dir=${profile}`,
      ...(process.platform === "linux" ? ["--no-sandbox"] : []),
    ],
    timeout: 60000,
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.locator(".app-titlebar")).toBeVisible({ timeout: 60000 });
  const state = await page.evaluate(() => window.hauntDesktop.updates.state());
  assert.equal(state.current, version);
  await page.evaluate(() => window.hauntDesktop.updates.healthy());
  if (restore)
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("haunt-upgrade-rehearsal"),
      ),
      marker,
    );
  else
    await page.evaluate(
      (value) => localStorage.setItem("haunt-upgrade-rehearsal", value),
      marker,
    );
  assert.deepEqual(errors, []);
  await app.close();
  app = undefined;
}
try {
  await run("gh", [
    "release",
    "download",
    previousTag,
    "--repo",
    config.repository,
    "--pattern",
    "haunt-updates.json",
    "--dir",
    downloads,
  ]);
  const prior = verifyManifest(
    JSON.parse(
      await fs.readFile(path.join(downloads, "haunt-updates.json"), "utf8"),
    ),
    config,
    process.platform,
    process.arch,
  );
  assert.equal(prior.version, report.from);
  await run("gh", [
    "release",
    "download",
    previousTag,
    "--repo",
    config.repository,
    "--pattern",
    prior.installer.file,
    "--dir",
    downloads,
  ]);
  await launch(
    await install(await verifiedFile(downloads, prior.installer)),
    prior.version,
    false,
  );
  await launch(
    await install(
      await verifiedFile(path.resolve("release/updates"), current.installer),
    ),
    current.version,
    true,
  );
  report.passed = true;
  report.privateProfilePreserved = true;
  console.log(
    `PASS ${target}: installed ${prior.version}, upgraded to ${current.version}, relaunched and preserved profile state`,
  );
} catch (error) {
  report.error = error.message;
  throw error;
} finally {
  await fs.mkdir("test-results", { recursive: true });
  await fs.writeFile(
    `test-results/installed-upgrade-${target}.json`,
    JSON.stringify(report, null, 2),
  );
  await app?.close();
  await fs.rm(scratch, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 300,
  });
}
