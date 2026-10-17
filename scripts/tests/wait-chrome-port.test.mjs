import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { waitForChromePort } from "../wait-chrome-port.mjs";

test("waits through Chrome's empty port file until the writer publishes a port", async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "haunt-port-race-"));
  const file = path.join(profile, "DevToolsActivePort");
  await fs.writeFile(file, "");
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });
  let pending;
  try {
    pending = waitForChromePort(profile, child, 3000);
    // Give the reader a chance to observe the same empty file seen in CI.
    await new Promise((resolve) => setTimeout(resolve, 150));
    await fs.writeFile(file, "39981\n/devtools/browser/test\n");
    assert.equal(await pending, "39981");
  } finally {
    child.kill();
    await once(child, "exit");
    await pending?.catch(() => {});
    await fs.rm(profile, { recursive: true, force: true });
  }
});

test("an exited owned process fails visibly instead of waiting for a file", async () => {
  const child = spawn(process.execPath, ["-e", "process.exit(7)"], {
    stdio: "ignore",
  });
  await once(child, "exit");
  await assert.rejects(
    waitForChromePort("unused-profile", child),
    /exited before readiness \(7\)/,
  );
});

test("an empty file that never becomes ready times out visibly", async () => {
  const profile = await fs.mkdtemp(
    path.join(os.tmpdir(), "haunt-port-timeout-"),
  );
  await fs.writeFile(path.join(profile, "DevToolsActivePort"), "");
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });
  try {
    await assert.rejects(
      waitForChromePort(profile, child, 150),
      /did not publish a valid debugging port/,
    );
  } finally {
    child.kill();
    await once(child, "exit");
    await fs.rm(profile, { recursive: true, force: true });
  }
});
