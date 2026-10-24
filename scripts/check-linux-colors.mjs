import { _electron as electron, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

assert.equal(process.env.GITHUB_ACTIONS, "true", "Run on remote GitHub Actions");
const run = promisify(execFile);
const results = path.resolve("test-results/linux-colors");
await fs.mkdir(results, { recursive: true });
if (process.argv[2] === "prepare") {
  const html = path.resolve("apps/web/ci-colors.html");
  const entry = path.resolve("apps/web/ci-colors.tsx");
  await fs.writeFile(html, '<!doctype html><html><body><div id="root"></div><script type="module" src="/ci-colors.tsx"></script></body></html>');
  await fs.writeFile(entry, `import React from "react";
import { createRoot } from "react-dom/client";
import { ImagePreview } from "./src/ImageViewer";
import "./src/style.css";
const fixture = new URLSearchParams(location.search).get("fixture");
if (!["untagged", "srgb"].includes(fixture)) throw Error("Invalid color fixture");
const response = await fetch("/ci-colors-" + fixture + ".png");
if (!response.ok) throw Error("Color fixture unavailable");
const src = URL.createObjectURL(await response.blob());
createRoot(document.getElementById("root")).render(<ImagePreview className="attachment-picture" label="Enlarge color fixture"><img src={src} alt="Color fixture" /></ImagePreview>);
`);
  try {
    const { build } = await import("vite");
    await build({ build: { emptyOutDir: false, target: "esnext", rollupOptions: { input: html } } });
  } finally {
    await fs.rm(html);
    await fs.rm(entry);
  }
  process.exit(0);
}

const modes = [
  { name: "default", args: [] },
  { name: "no-wayland-cm", args: ["--disable-features=WaylandWpColorManagerV1"] },
  { name: "x11", args: ["--ozone-platform=x11"] },
  { name: "forced-srgb", args: ["--force-color-profile=srgb"] },
  { name: "no-gpu", args: ["--disable-gpu"] },
];
const report = {
  sourceSha: process.env.HAUNT_COLOR_SOURCE_SHA,
  environment: Object.fromEntries(["DISPLAY", "WAYLAND_DISPLAY", "XDG_SESSION_TYPE", "HAUNT_COLOR_OUTER_DISPLAY", "LIBGL_ALWAYS_SOFTWARE"].map((key) => [key, process.env[key]])),
  modes: modes.map((mode) => mode.name),
  captures: [],
  diagnostics: [],
  completed: false,
};
const save = () => fs.writeFile(path.join(results, "run.json"), JSON.stringify(report, null, 2));
const showFullscreen = async (desktop, page) => {
  const window = await desktop.browserWindow(page);
  await window.evaluate((win) => { win.show(); win.setFullScreen(true); win.focus(); });
  await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([1280, 900]);
};
const capture = async (page, mode, fixture, view, selector) => {
  const image = page.locator(selector);
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((img) => img.complete && img.naturalWidth)).toBe(512);
  const box = await image.boundingBox();
  assert.equal(box.width, 512);
  assert.equal(box.height, 384);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const stem = `${mode}-${fixture}-${view}`;
  const pageFile = `${stem}-page.png`;
  const outputFile = `${stem}-output.png`;
  await page.screenshot({ path: path.join(results, pageFile), animations: "disabled" });
  await run("import", ["-display", process.env.HAUNT_COLOR_OUTER_DISPLAY, "-window", "root", path.join(results, outputFile)], {
    timeout: 15000,
    env: { ...process.env, XAUTHORITY: process.env.HAUNT_COLOR_OUTER_XAUTHORITY },
  });
  const css = await image.evaluate((img) => {
    const css = getComputedStyle(img);
    return { filter: css.filter, opacity: css.opacity, mixBlendMode: css.mixBlendMode, width: img.naturalWidth, height: img.naturalHeight };
  });
  report.captures.push({ mode, fixture, view, box, css, pageFile, outputFile });
  await save();
};

try {
  const protocols = await run("wayland-info", [], { timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
  await fs.writeFile(path.join(results, "wayland-info.txt"), protocols.stdout + protocols.stderr);
  report.colorManagerAdvertised = protocols.stdout.includes("wp_color_manager_v1");
  assert(report.colorManagerAdvertised, "KWin must expose wp_color_manager_v1");
  for (const mode of modes) {
    let desktop;
    const log = createWriteStream(path.join(results, `${mode.name}-electron.log`));
    try {
      desktop = await electron.launch({
        args: ["--no-sandbox", "--password-store=basic", ...mode.args, path.resolve("electron-app/main.cjs")],
        env: {
          ...process.env,
          QT_QPA_PLATFORM: "wayland",
          WAYLAND_DEBUG: "1",
          ELECTRON_ENABLE_LOGGING: "1",
          HAUNT_DESKTOP_TEST: "1",
          HAUNT_DESKTOP_TEST_PROFILE: path.join(results, "profiles", mode.name),
        },
        timeout: 60000,
      });
      desktop.process().stderr.on("data", (data) => log.write(data));
      desktop.process().stdout.on("data", (data) => log.write(data));
      const page = await desktop.firstWindow();
      await page.waitForLoadState("domcontentloaded");
      const diagnostics = await desktop.evaluate(async ({ app, screen }) => ({
        versions: process.versions,
        argv: process.argv,
        hardwareAcceleration: app.isHardwareAccelerationEnabled(),
        gpuFeatures: app.getGPUFeatureStatus(),
        gpu: await app.getGPUInfo("complete"),
        displays: screen.getAllDisplays(),
      }));
      report.diagnostics.push({ mode: mode.name, ...diagnostics });
      const gpuPageReady = desktop.waitForEvent("window");
      await desktop.evaluate(async ({ BrowserWindow }) => {
        globalThis.colorGpuWindow = new BrowserWindow({ show: false });
        await globalThis.colorGpuWindow.loadURL("chrome://gpu");
      });
      const gpuPage = await gpuPageReady;
      await expect(gpuPage.getByText("Graphics Feature Status", { exact: true })).toBeAttached();
      const gpuText = await gpuPage.evaluate(() => {
        const walk = (node) => {
          let text = node.nodeType === Node.TEXT_NODE ? node.textContent + "\n" : "";
          for (const child of node.childNodes) text += walk(child);
          if (node.shadowRoot) text += walk(node.shadowRoot);
          return text;
        };
        return walk(document.body);
      });
      await fs.writeFile(path.join(results, `${mode.name}-chrome-gpu.txt`), gpuText);
      if (mode.name === "default") assert(/Ozone platform\s*:?\s*wayland/i.test(gpuText), "Default launch must use native Wayland");
      if (mode.name === "x11") assert(/Ozone platform\s*:?\s*x11/i.test(gpuText), "X11 comparison must use X11");
      await desktop.evaluate(() => globalThis.colorGpuWindow.destroy());
      for (const fixture of ["untagged", "srgb"]) {
        await showFullscreen(desktop, page);
        await page.goto(`https://app.chatxo.local/ci-colors.html?fixture=${fixture}`);
        await page.getByRole("button", { name: "Enlarge color fixture" }).click();
        await capture(page, mode.name, fixture, "haunt-viewer", ".viewer-image");
        const mainWindow = await desktop.browserWindow(page);
        await mainWindow.evaluate((win) => win.hide());
        const bytes = await fs.readFile(path.join(results, `${fixture}.png`));
        const plainReady = desktop.waitForEvent("window");
        await desktop.evaluate(async ({ BrowserWindow }, png) => {
          globalThis.colorPlainWindow = new BrowserWindow({ width: 1280, height: 900, frame: false, backgroundColor: "#161616", webPreferences: { sandbox: true, contextIsolation: true } });
          const html = '<!doctype html><body style="margin:0;background:#161616;display:grid;place-items:center;height:100vh"><img width="512" height="384" src="data:image/png;base64,' + png + '">';
          await globalThis.colorPlainWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
        }, bytes.toString("base64"));
        const plain = await plainReady;
        await showFullscreen(desktop, plain);
        await capture(plain, mode.name, fixture, "plain-electron", "img");
        await desktop.evaluate(() => globalThis.colorPlainWindow.destroy());
      }
    } finally {
      await desktop?.close();
      await new Promise((resolve) => log.end(resolve));
    }
  }
  report.completed = true;
} catch (error) {
  report.error = error.stack;
  console.error(error);
  process.exitCode = 1;
} finally {
  await save();
  await fs.rm(path.join(results, "profiles"), { recursive: true, force: true });
}
