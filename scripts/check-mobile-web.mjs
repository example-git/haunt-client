import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fillSignin } from "./signin-fields.mjs";

export async function checkMobileWeb(browser, fixtures) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const session = await context.newCDPSession(page);
  const touch = (type, points) =>
    session.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points.map(([x, y, id = 1]) => ({ x, y, id })),
    });
  const swipe = async (from, to) => {
    await touch("touchStart", [from]);
    for (let i = 1; i <= 8; i++) {
      await touch("touchMove", [
        [
          from[0] + ((to[0] - from[0]) * i) / 8,
          from[1] + ((to[1] - from[1]) * i) / 8,
        ],
      ]);
      await page.waitForTimeout(20);
    }
    await touch("touchEnd", []);
  };
  const report = {};
  try {
    await page.goto("http://127.0.0.1:5173");
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
      "content",
      "#202020",
    );
    await expect(
      page.getByRole("dialog", { name: "Connect to a server", exact: true }),
    ).toBeVisible();
    await fillSignin(page, fixtures.rtc.url, "alice");
    await page.getByLabel("Password", { exact: true }).fill(fixtures.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator(".connection")).toHaveText("Connected");
    const hideNavigation = page.getByRole("button", {
      name: "Hide channels",
      exact: true,
    });
    if (await hideNavigation.isVisible()) await hideNavigation.click();
    const rail = page.locator(".server-rail");
    const members = page.getByRole("complementary", { name: "Member list" });
    await expect(rail).toBeHidden();
    await expect(members).toBeHidden();
    await touch("touchStart", [[4, 350]]);
    await touch("touchMove", [[90, 350]]);
    await expect(page.locator(".app")).toHaveAttribute(
      "data-mobile-drag",
      "navigation",
    );
    const partial = await page.locator(".sidebar").boundingBox();
    assert(partial.x < 62 && partial.x + partial.width > 0);
    await page.screenshot({ path: "test-results/mobile-navigation-drag.png" });
    await touch("touchEnd", []);
    await expect(rail).toBeHidden();
    await swipe([4, 350], [280, 350]);
    await expect(rail).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Hide channels", exact: true }),
    ).toHaveAttribute("aria-expanded", "true");
    await page.screenshot({ path: "test-results/mobile-navigation-open.png" });
    await swipe([270, 350], [10, 350]);
    await expect(rail).toBeHidden();
    await swipe([386, 350], [110, 350]);
    await expect(members).toBeVisible();
    await expect(rail).toBeHidden();
    await page.screenshot({ path: "test-results/mobile-members-open.png" });
    await swipe([120, 350], [385, 350]);
    await expect(members).toBeHidden();
    await swipe([4, 350], [8, 200]);
    await expect(rail).toBeHidden();
    await expect(members).toBeHidden();
    await swipe([195, 350], [310, 350]);
    await expect(rail).toBeHidden();
    await expect(members).toBeHidden();
    await touch("touchStart", [[386, 350]]);
    await touch("touchMove", [[220, 350]]);
    await touch("touchCancel", []);
    await expect(members).toBeHidden();
    report.edgeDrawers = true;
    report.cancelledAndVerticalGestures = true;
    const input = page.getByRole("textbox", { name: "Message", exact: true });
    await input.focus();
    assert(
      await input.evaluate(
        (element) => parseFloat(getComputedStyle(element).fontSize) >= 16,
      ),
    );
    await page.touchscreen.tap(195, 300);
    await page.touchscreen.tap(195, 300);
    await touch("touchStart", [
      [140, 350, 1],
      [250, 350, 2],
    ]);
    for (let i = 1; i <= 6; i++)
      await touch("touchMove", [
        [140 - i * 16, 350, 1],
        [250 + i * 16, 350, 2],
      ]);
    await touch("touchEnd", []);
    await expect.poll(() => page.evaluate(() => visualViewport.scale)).toBe(1);
    report.pageScale = await page.evaluate(() => visualViewport.scale);
    await page.evaluate(() => {
      const key = "chatxo-client-preferences-v1";
      const prefs = JSON.parse(localStorage.getItem(key) ?? "{}");
      prefs.theme = {
        ...prefs.theme,
        preset: "custom",
        colors: { ...prefs.theme?.colors, chrome: "#ffc39c" },
      };
      localStorage.setItem(key, JSON.stringify(prefs));
      window.dispatchEvent(new StorageEvent("storage", { key }));
    });
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
      "content",
      "#ffc39c",
    );
    await expect(page.locator(".app-titlebar")).toHaveCSS(
      "background-color",
      "rgb(255, 195, 156)",
    );
    await expect(page.locator("body")).toHaveCSS(
      "background-color",
      "rgb(255, 195, 156)",
    );
    const manifest = await session.send("Page.getAppManifest");
    assert.deepEqual(manifest.errors, []);
    const parsed = JSON.parse(manifest.data);
    assert.equal(parsed.theme_color, "#ffc39c");
    assert.equal(parsed.background_color, "#ffc39c");
    assert.equal(parsed.id, new URL("/", page.url()).href);
    assert.equal(parsed.start_url, parsed.id);
    assert.equal(parsed.scope, parsed.id);
    assert(
      parsed.icons.every(
        (icon) => new URL(icon.src).origin === new URL(page.url()).origin,
      ),
    );
    await page.reload();
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
      "content",
      "#ffc39c",
    );
    await page.screenshot({ path: "test-results/mobile-theme-chrome.png" });
    report.themeAndManifest = true;
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.locator(".server-rail")).toBeVisible();
    await expect(
      page.getByRole("complementary", { name: "Member list" }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".server-rail")).toBeHidden();
    await expect(
      page.getByRole("complementary", { name: "Member list" }),
    ).toBeHidden();
    report.desktopPreferencePreserved = true;
    assert.deepEqual(errors, []);
    await fs.writeFile(
      "test-results/mobile-web.json",
      JSON.stringify(report, null, 2),
    );
    console.log(
      "Mobile drawers, touch cancellation, page scale, theme colors, PWA manifest and desktop restoration passed.",
    );
  } finally {
    await context.close();
  }
}
