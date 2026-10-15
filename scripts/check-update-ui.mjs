// Browser-only UI verification. Own a private Chrome profile and process group.
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import os from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
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
import {DesktopUpdates,DesktopUpdateNotice} from '../../apps/web/src/DesktopUpdates';
import {DesktopDownload} from '../../apps/web/src/DesktopDownload';
const listeners=new Set();let state={phase:'idle',current:'0.1.0'};
const update=(value)=>{state={...state,...value};listeners.forEach(f=>f(state));return state};
if(location.search!=='?browser')window.hauntDesktop={platform:'linux',updates:{state:async()=>state,subscribe:(f)=>{listeners.add(f);return()=>listeners.delete(f)},check:async()=>update({phase:'available',available:'0.2.0'}),download:async()=>{update({phase:'downloading',progress:.5});setTimeout(()=>update({phase:'ready'}),500)},apply:async()=>{throw Error('Finish the call or upload before installing this update.')}}};
const snapshot={status:'online'};const instance={subscribe:()=>()=>{},getSnapshot:()=>snapshot,scope:'test',account:{origin:'https://mirror.example.test',login:{token:'test-session'},instance:{client_updates:{installers:true}}}};
createRoot(document.getElementById('root')).render(location.search==='?browser'?<DesktopDownload instance={instance}/>:<><DesktopUpdateNotice onOpen={()=>{}}/><DesktopUpdates/></>);
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
      "--no-sandbox",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { detached: true, stdio: "ignore" },
  );
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
  const context = browser.contexts()[0],
    page = await context.newPage();
  const url = `http://127.0.0.1:${server.address().port}`;
  await page.goto(url);
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
  await page.getByRole("button", { name: "Restart to update" }).click();
  await expect(page.getByRole("alert")).toContainText("Finish the call");
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
    "Browser UI: update availability, progress, ready/error states and authenticated verified installer download passed.",
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
