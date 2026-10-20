import { spawn } from "node:child_process";
import { once } from "node:events";

// Each mode provisions disposable databases and owns its private Chrome process.
// None of these modes starts Electron or uses a developer's saved sessions.
for (const mode of [
  "signin-browser",
  "secure-dm",
  "source-audio",
  "narrator",
  "ui-refresh",
  "notifications",
  "public-downloads",
  "web-updates",
]) {
  console.log(`Browser regression: ${mode}`);
  const child = spawn(process.execPath, ["scripts/test-integration.mjs"], {
    stdio: "inherit",
    env: { ...process.env, HAUNT_CLIENT_CHECK: mode },
  });
  const [code, signal] = await once(child, "exit");
  if (code !== 0) throw Error(`${mode} failed (${signal ?? code})`);
}
