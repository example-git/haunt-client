import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { execFileSync, spawn } from "node:child_process";

assert.equal(process.env.CI, "true", "Run this desktop check on remote CI");
const profile = await fs.mkdtemp(path.join(os.tmpdir(), "haunt-window-"));
const wm = spawn("openbox", [], { stdio: "ignore" });
let desktop;
const evidence = [];
const readShape = `
import ctypes as c, json, sys
x = c.CDLL('libX11.so.6')
s = c.CDLL('libXext.so.6')
x.XOpenDisplay.argtypes = [c.c_char_p]
x.XOpenDisplay.restype = c.c_void_p
class Rect(c.Structure):
    _fields_ = [('x',c.c_short),('y',c.c_short),('width',c.c_ushort),('height',c.c_ushort)]
s.XShapeGetRectangles.argtypes = [c.c_void_p,c.c_ulong,c.c_int,c.POINTER(c.c_int),c.POINTER(c.c_int)]
s.XShapeGetRectangles.restype = c.POINTER(Rect)
x.XFree.argtypes = [c.c_void_p]
x.XCloseDisplay.argtypes = [c.c_void_p]
d = x.XOpenDisplay(None)
assert d
count, order = c.c_int(), c.c_int()
r = s.XShapeGetRectangles(d,int(sys.argv[1]),0,c.byref(count),c.byref(order))
print(json.dumps([dict(x=r[i].x,y=r[i].y,width=r[i].width,height=r[i].height) for i in range(count.value)]))
x.XFree(r)
x.XCloseDisplay(d)
`;
try {
  await fs.mkdir("test-results", { recursive: true });
  await expect
    .poll(() =>
      execFileSync("xprop", ["-root", "_NET_SUPPORTING_WM_CHECK"], {
        encoding: "utf8",
      }).includes("window id"),
    )
    .toBe(true);
  desktop = await electron.launch({
    executablePath: (await import("electron")).default,
    args: [
      "--no-sandbox",
      "--password-store=basic",
      "--ozone-platform=x11",
      path.resolve("apps/desktop/main.cjs"),
    ],
    env: {
      ...process.env,
      HAUNT_DESKTOP_TEST: "1",
      HAUNT_DESKTOP_TEST_PROFILE: profile,
    },
    timeout: 60000,
  });
  const page = await desktop.firstWindow();
  await expect(page.locator("html")).toHaveAttribute(
    "data-native-window",
    "normal",
    { timeout: 30000 },
  );
  const shape = async (target, phase, rounded) => {
    await expect(async () => {
      const state = await desktop.evaluate(({ BrowserWindow }, target) => {
        const windows = BrowserWindow.getAllWindows();
        const win = windows.find((win) =>
          target === "call"
            ? win.webContents.getURL().endsWith("/call-window.html")
            : !win.webContents.getURL().endsWith("/call-window.html"),
        );
        return {
          id: win.getNativeWindowHandle().readUInt32LE(0),
          size: win.getSize(),
          maximized: win.isMaximized(),
          fullscreen: win.isFullScreen(),
        };
      }, target);
      const rects = JSON.parse(
        execFileSync("python3", ["-c", readShape, String(state.id)], {
          encoding: "utf8",
        }),
      );
      const contains = (x, y) =>
        rects.some(
          (r) =>
            x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height,
        );
      evidence.push({ target, phase, ...state, rects });
      assert.equal(
        contains(0, 0),
        !rounded,
        `${phase}: top-left native corner; ${JSON.stringify({ state, rects })}`,
      );
      assert.equal(
        contains(state.size[0] - 1, state.size[1] - 1),
        !rounded,
        `${phase}: bottom-right native corner`,
      );
      assert(
        contains(Math.floor(state.size[0] / 2), Math.floor(state.size[1] / 2)),
        `${phase}: native center`,
      );
    }).toPass({ timeout: 5000, intervals: [100, 250, 500] });
  };
  await shape("main", "normal", true);
  await page.screenshot({ path: "test-results/window-normal-renderer.png" });
  await page
    .getByRole("button", { name: "Maximize window", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-native-window",
    "maximized",
  );
  await shape("main", "maximized", false);
  await page
    .getByRole("button", { name: "Restore window", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-native-window",
    "normal",
  );
  await shape("main", "restored", true);
  await desktop.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(920, 650),
  );
  await expect
    .poll(() =>
      desktop.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].getSize(),
      ),
    )
    .toEqual([920, 650]);
  await shape("main", "resized", true);
  await desktop.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setFullScreen(true),
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-native-window",
    "maximized",
  );
  await shape("main", "fullscreen", false);
  await desktop.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setFullScreen(false),
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-native-window",
    "normal",
  );
  await shape("main", "leave-fullscreen", true);
  const opened = desktop.waitForEvent("window");
  await page.evaluate(() =>
    window.open(
      new URL("/call-window.html", location.href),
      "haunt-call",
      "width=960,height=640",
    ),
  );
  const popup = await opened;
  await popup.waitForURL("**/call-window.html");
  await shape("call", "popout", true);
  await page.evaluate(() =>
    window.hauntDesktop.windowControl("maximize", "call"),
  );
  await expect
    .poll(() =>
      page
        .evaluate(() => window.hauntDesktop.windowState("call"))
        .then((state) => state.maximized),
    )
    .toBe(true);
  await shape("call", "popout-maximized", false);
  await page.evaluate(() =>
    window.hauntDesktop.windowControl("maximize", "call"),
  );
  await expect
    .poll(() =>
      page
        .evaluate(() => window.hauntDesktop.windowState("call"))
        .then((state) => state.maximized),
    )
    .toBe(false);
  await shape("call", "popout-restored", true);
  await page.evaluate(() => window.hauntDesktop.windowControl("close", "call"));
  const screen = await desktop.evaluate(async ({ desktopCapturer }) => {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 1600, height: 1000 },
    });
    return sources[0].thumbnail.toPNG().toString("base64");
  });
  await fs.writeFile(
    "test-results/window-native-x11.png",
    Buffer.from(screen, "base64"),
  );
  console.log(
    "PASS native Linux/X11: normal, resized, maximized, fullscreen, restored and pop-out window regions",
  );
} finally {
  await fs.writeFile(
    "test-results/window-shapes.json",
    JSON.stringify(evidence, null, 2),
  );
  await desktop?.close();
  const stopped = once(wm, "exit");
  wm.kill();
  await stopped;
  await fs.rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 300,
  });
}
