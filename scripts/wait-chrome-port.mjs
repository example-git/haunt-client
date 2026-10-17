import fs from "node:fs/promises";
import path from "node:path";

// Chrome can create this file before writing its port. Keep waiting until the
// first line is complete; file existence alone does not mean CDP is ready.
export async function waitForChromePort(profile, child, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw Error(
        `Owned Chrome exited before readiness (${child.exitCode ?? child.signalCode})`,
      );
    try {
      const contents = await fs.readFile(
        path.join(profile, "DevToolsActivePort"),
        "utf8",
      );
      const port = /^([1-9]\d{0,4})\r?\n/.exec(contents)?.[1];
      if (port && Number(port) <= 65535) return port;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw Error(
    `Owned Chrome did not publish a valid debugging port: ${child.diagnostics || "no diagnostics"}`,
  );
}
