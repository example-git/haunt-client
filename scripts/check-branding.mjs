import { expect } from "@playwright/test";
import assert from "node:assert/strict";

export async function checkBranding(page, desktop) {
  const suffix = desktop ? "desktop" : "browser";
  await expect(page).toHaveTitle("Haunt");
  await expect(
    page.getByRole("heading", { name: "Haunt", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".brand-mark img")).toHaveAttribute("alt", "Haunt");
  await page.locator(".brand-mark img").evaluate((image) => image.decode());
  await page.locator(".welcome-logo").evaluate((image) => image.decode());
  assert.equal(
    await page.locator('meta[name="theme-color"]').getAttribute("content"),
    "#161616",
  );
  assert.match(
    await page.locator('link[rel="icon"]').getAttribute("href"),
    /\/brand\/favicon-32\.png$/,
  );
  const assets = await page.evaluate(async () => {
    const url = document.querySelector('link[rel="manifest"]').href;
    const response = await fetch(url);
    const manifest = await response.json();
    const pixels = [];
    for (const name of [
      "favicon-16.png",
      "logo-32.png",
      "logo-48.png",
      "icon-maskable-192.png",
    ]) {
      const image = new Image();
      image.src = new URL(name, url).href;
      await image.decode();
      pixels.push([name, image.naturalWidth, image.naturalHeight]);
    }
    return { manifest, pixels, scope: new URL(manifest.scope, url).pathname };
  });
  assert.equal(assets.manifest.name, "Haunt");
  assert.equal(assets.scope, "/");
  assert.deepEqual(
    assets.pixels.map((p) => p[1]),
    [16, 32, 48, 192],
  );
  const colors = await page.evaluate(() => ({
    page: getComputedStyle(document.documentElement).backgroundColor,
    rail: getComputedStyle(document.querySelector(".server-rail"))
      .backgroundColor,
    button: getComputedStyle(document.querySelector(".welcome .primary"))
      .backgroundColor,
    markFilter: getComputedStyle(document.querySelector(".brand-mark img"))
      .filter,
  }));
  assert.deepEqual(colors, {
    page: "rgb(22, 22, 22)",
    rail: "rgb(22, 22, 22)",
    button: "rgb(255, 154, 61)",
    markFilter: "none",
  });
  await page.screenshot({ path: `test-results/haunt-${suffix}-welcome.png` });
  await page
    .getByRole("button", { name: "Join a server", exact: true })
    .click();
  await page.getByLabel("Account address", { exact: true }).focus();
  // Keyboard focus follows the new solid focus token, independently of the action accent.
  await page.keyboard.press("Tab");
  const focus = await page.evaluate(() => ({
    outline: getComputedStyle(document.activeElement).outlineColor,
    border: getComputedStyle(document.querySelector("input")).borderColor,
  }));
  assert.equal(focus.outline, "rgb(184, 198, 255)");
  assert.equal(focus.border, "rgb(102, 102, 102)");
  await page.screenshot({ path: `test-results/haunt-${suffix}-connect.png` });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  if (desktop) {
    const details = await desktop.evaluate(({ app, BrowserWindow }) => ({
      name: app.getName(),
      profile: app.getPath("userData"),
      session: app.getPath("sessionData"),
      background: BrowserWindow.getAllWindows()[0].getBackgroundColor(),
      packaged: app.isPackaged,
    }));
    assert.equal(details.name, "Haunt");
    assert.equal(details.background.toLowerCase(), "#161616");
    assert(details.profile.endsWith(details.packaged ? "/haunt" : "/desktop"));
    assert.equal(details.session, details.profile);
  } else {
    await page.setViewportSize({ width: 390, height: 844 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({ path: "test-results/haunt-browser-mobile.png" });
    await page.setViewportSize({ width: 1360, height: 950 });
  }
  console.log(
    `Haunt ${suffix}: approved assets decode, neutral charcoal surfaces/accent controls, focus, manifest, identity/profile checks passed.`,
  );
}
