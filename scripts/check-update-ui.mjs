// Browser-only UI verification. Own a private Chrome profile and process group.
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import os from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
const { createUpdateInstaller, updateActivityScript } = createRequire(
  import.meta.url,
)("../apps/desktop/updates.cjs");
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import { build } from "vite";
import { chromium, expect } from "@playwright/test";
const scratch = await fs.mkdtemp(path.resolve("test-results/update-ui-"));
const profile = await fs.mkdtemp(path.join(os.tmpdir(), "haunt-update-ui-"));
const keys = generateKeyPairSync("ed25519");
const config = {
  repository: "example-git/haunt-client",
  publicKey: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
};
const bytes = Buffer.from("Verified installer fixture, never executed.");
const target = "linux-x64";
const payload = Buffer.from(
  JSON.stringify({
    schema: 1,
    repository: config.repository,
    version: "0.2.0",
    targets: {
      [target]: {
        installer: {
          file: "Haunt.AppImage",
          size: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
      },
    },
  }),
);
const manifest = {
  schema: 1,
  payload: payload.toString("base64"),
  signature: sign(null, payload, keys.privateKey).toString("base64"),
};
await fs.writeFile(path.join(scratch, "updates.json"), JSON.stringify(config));
await fs.writeFile(
  path.join(scratch, "index.html"),
  '<div id="root"></div><script type="module" src="/entry.tsx"></script>',
);
await fs.writeFile(
  path.join(scratch, "entry.tsx"),
  `
import {createRoot} from 'react-dom/client';
import {DesktopUpdates,DesktopUpdateNotice,DesktopRuntimeNotice} from '../../apps/web/src/DesktopUpdates';
import {DesktopDownload} from '../../apps/web/src/DesktopDownload';
import {ToastStack} from '../../apps/web/src/ToastStack';
const listeners=new Set();let state={phase:'idle',current:'0.1.0'};
const update=(value)=>{state={...state,...value};listeners.forEach(f=>f(state));return state}; window.testUpdate=update;
if(location.search!=='?browser')window.hauntDesktop={platform:'linux',updates:{state:async()=>state,subscribe:(f)=>{listeners.add(f);return()=>listeners.delete(f)},check:async()=>update({phase:'available',available:'0.2.0'}),download:async()=>{update({phase:'downloading',progress:.5});setTimeout(()=>update({phase:state.kind==='installer'?'installer-ready':'ready'}),500)},apply:()=>window.applyUpdate()}};
const snapshot={status:'online'};const instance={subscribe:()=>()=>{},getSnapshot:()=>snapshot,scope:'test',account:{origin:'https://mirror.example.test',login:{token:'test-session'},instance:{client_updates:{installers:true}}}};
createRoot(document.getElementById('root')).render(location.search==='?browser'?<DesktopDownload instance={instance}/>:<><DesktopUpdateNotice onOpen={()=>{}}/><dialog open><DesktopUpdates/></dialog><ToastStack><DesktopRuntimeNotice/></ToastStack></>);
`,
);
await build({
  configFile: false,
  root: scratch,
  logLevel: "error",
  resolve: {
    alias: [
      {
        find: "../../../static/updates.json",
        replacement: path.join(scratch, "updates.json"),
      },
    ],
  },
  build: { outDir: path.join(scratch, "dist"), emptyOutDir: true },
});
const server = http.createServer(async (req, res) => {
  try {
    const name = new URL(req.url, "http://localhost").pathname;
    const file = path.join(scratch, "dist", name === "/" ? "index.html" : name);
    const data = await fs.readFile(file);
    res.setHeader(
      "Content-Type",
      file.endsWith(".js") ? "text/javascript" : "text/html",
    );
    res.end(data);
  } catch {
    res.writeHead(404).end();
  }
});
let processHandle, browser;
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  processHandle = spawn(
    process.env.HAUNT_TEST_CHROME || "/usr/bin/google-chrome",
    [
      "--headless=new",
      "--disable-gpu",
      "--no-proxy-server",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--disable-extensions",
      "--disable-background-networking",
      "--renderer-process-limit=2",
      "--no-sandbox",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { detached: true, stdio: ["ignore", "ignore", "pipe"] },
  );
  let browserErrors = "";
  processHandle.stderr.on("data", (chunk) => {
    browserErrors = (browserErrors + chunk.toString()).slice(-6000);
  });
  let port;
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      port = (
        await fs.readFile(path.join(profile, "DevToolsActivePort"), "utf8")
      ).split("\n")[0];
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  if (!port) throw Error("Private browser did not start");
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = await browser.newContext({ serviceWorkers: "block" }),
    page = await context.newPage();
  const url = `http://127.0.0.1:${server.address().port}`;
  page.on("pageerror", (error) => console.error("page error:", error.message));
  let restarted = 0,
    quit = 0,
    applies = 0;
  const install = createUpdateInstaller({
    updater: { verifyReady: async () => ({ kind: "asar" }), set: () => {} },
    readActivity: () => page.evaluate(updateActivityScript),
    confirm: (detail) => page.evaluate((text) => window.confirm(text), detail),
    app: { relaunch: () => restarted++, quit: () => quit++ },
    shell: {},
  });
  page.setDefaultTimeout(15000);
  await page.exposeFunction("applyUpdate", async () => {
    try {
      await install();
    } finally {
      applies++;
    }
  });
  const clickApply = async () => {
    const next = applies + 1;
    await page.getByRole("button", { name: "Restart to update" }).click();
    await expect.poll(() => applies).toBe(next);
  };
  try {
    await page.goto(url);
  } catch (error) {
    console.error(browserErrors);
    throw error;
  }
  await page.getByRole("button", { name: "Check for updates" }).click();
  await expect(
    page.getByRole("button", { name: "Client update available" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Download update", exact: true })
    .click();
  await expect(page.getByRole("progressbar")).toHaveAttribute("value", "0.5");
  await expect(
    page.getByRole("button", { name: "Restart to update" }),
  ).toBeVisible();
  await clickApply();
  if (restarted !== 1 || quit !== 1)
    throw Error("An open settings dialog blocked idle restart");
  await page.evaluate(() => (document.body.dataset.activeCall = "true"));
  page.once("dialog", (dialog) => dialog.dismiss());
  await clickApply();
  if (restarted !== 1) throw Error("Cancelled restart ended a call");
  page.once("dialog", (dialog) => {
    if (!dialog.message().includes("voice call"))
      throw Error("Missing call warning");
    return dialog.accept();
  });
  await clickApply();
  await expect.poll(() => restarted).toBe(2);
  await page.evaluate(() => {
    document.body.dataset.activeCall = "false";
    document.body.dataset.updateDraft = "true";
  });
  page.once("dialog", (dialog) => {
    if (
      !dialog.message().includes("Unsent") ||
      dialog.message().includes("Unfinished uploads")
    )
      throw Error("Completed attachment incorrectly counted as upload");
    return dialog.accept();
  });
  await clickApply();
  await expect.poll(() => restarted).toBe(3);
  await page.evaluate(() => {
    document.body.dataset.updateUpload = "true";
  });
  page.once("dialog", (dialog) => {
    if (!dialog.message().includes("Unfinished uploads"))
      throw Error("Missing upload warning");
    return dialog.dismiss();
  });
  await clickApply();
  if (restarted !== 3) throw Error("Cancelled upload restart was applied");
  const full = page.getByRole("complementary", {
    name: "Full app update required",
  });
  for (const platform of ["darwin", "win32", "linux"]) {
    await page.evaluate((platform) => {
      window.hauntDesktop.platform = platform;
      window.testUpdate({
        phase: "runtime-required",
        kind: "installer",
        available: "0.3." + ["darwin", "win32", "linux"].indexOf(platform),
      });
    }, platform);
    await expect(full).toBeVisible();
    await expect(full).toContainText(
      platform === "darwin"
        ? "DMG"
        : platform === "win32"
          ? "existing installation"
          : "AppImage",
    );
    await full
      .getByRole("button", { name: "Dismiss full app update notice" })
      .click();
    await page.evaluate(() => window.testUpdate({ phase: "runtime-required" }));
    await expect(full).toHaveCount(0);
  }
  await page.evaluate(() => {
    window.testUpdate({
      phase: "runtime-required",
      kind: "installer",
      available: "0.4.0",
    });
  });
  await full.getByRole("button", { name: "Download full app" }).click();
  await expect(full.getByRole("progressbar")).toHaveAttribute("value", "0.5");
  await expect(
    full.getByRole("button", { name: "Install and restart" }),
  ).toBeVisible();
  await page.route("https://mirror.example.test/**", async (route) => {
    if (route.request().headers().authorization !== "Bearer test-session")
      throw Error("Missing authenticated download");
    await route.fulfill({
      status: 200,
      contentType: route.request().url().endsWith("installers")
        ? "application/json"
        : "application/octet-stream",
      body: route.request().url().endsWith("installers")
        ? JSON.stringify({ manifest, available: [target] })
        : bytes,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Authorization",
      },
    });
  });
  await page.goto(url + "?browser");
  await expect(page.getByRole("button", { name: "Desktop app" })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Desktop app" }).click();
  const result = await download;
  if (result.suggestedFilename() !== "Haunt.AppImage")
    throw Error("Unexpected download");
  const saved = await fs.readFile(await result.path());
  if (!saved.equals(bytes)) throw Error("Wrong installer bytes");
  console.log(
    "Browser UI: update availability, progress, restart/cancel, runtime notices on all platforms, and authenticated verified installer download passed.",
  );
} finally {
  await browser?.close().catch(() => {});
  if (
    processHandle &&
    processHandle.exitCode === null &&
    processHandle.signalCode === null
  ) {
    try {
      process.kill(-processHandle.pid, "SIGTERM");
    } catch {}
    await Promise.race([
      once(processHandle, "exit"),
      new Promise((r) => setTimeout(r, 2000)),
    ]);
    if (processHandle.exitCode === null && processHandle.signalCode === null) {
      try {
        process.kill(-processHandle.pid, "SIGKILL");
      } catch {}
    }
  }
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(profile, { recursive: true, force: true });
  await fs.rm(scratch, { recursive: true, force: true });
}
