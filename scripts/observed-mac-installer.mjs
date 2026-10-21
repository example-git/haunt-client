import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { captureDesktop } from "./native-notification-ui.mjs";
import {
  prepareSigningKeychain,
  acceptSigningPermission,
} from "./mac-ci-keychain.mjs";

// Keep native permission prompts and signer failures observable even if a
// descendant holds the installer's pipes open after its parent times out.
export async function runMacInstaller(args) {
  await fs.mkdir("test-results", { recursive: true });
  const keychain = await prepareSigningKeychain();
  const log = await fs.open("test-results/mac-installer.log", "a");
  const child = spawn("/bin/bash", args, {
    detached: true,
    stdio: ["ignore", log.fd, log.fd],
  });
  let timedOut = false,
    force;
  let consentBusy = false,
    consentGranted = false;
  let consentError;
  const consent = setInterval(async () => {
    if (consentBusy || consentGranted || consentError) return;
    consentBusy = true;
    try {
      consentGranted = await acceptSigningPermission(keychain);
    } catch (error) {
      consentError = error;
    } finally {
      consentBusy = false;
    }
  }, 2000);
  const screenshots = setInterval(() => {
    void captureDesktop(
      "test-results/notification-mac-install-current.png",
    ).catch(() => {});
  }, 20000);
  const terminate = (signal) => {
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  const deadline = setTimeout(async () => {
    timedOut = true;
    await captureDesktop(
      "test-results/notification-mac-install-timeout.png",
    ).catch(() => {});
    terminate("SIGTERM");
    force = setTimeout(() => terminate("SIGKILL"), 2000);
  }, 180000);
  try {
    await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (code === 0 && !timedOut) resolve();
        else
          reject(
            Error(
              `Local installer ${timedOut ? "timed out" : `failed (${signal ?? code})`}; see mac-installer.log and the native desktop capture.`,
            ),
          );
      });
    });
  } finally {
    clearInterval(screenshots);
    clearInterval(consent);
    clearTimeout(deadline);
    clearTimeout(force);
    await captureDesktop(
      "test-results/notification-mac-install-current.png",
    ).catch(() => {});
    await log.close();
    if (consentError) throw consentError;
  }
}
