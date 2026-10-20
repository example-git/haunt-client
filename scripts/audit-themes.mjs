import fs from "node:fs/promises";
import path from "node:path";
import { expect } from "@playwright/test";

/** Capture the production UI before/after a design pass without changing it. */
export async function auditThemes(page, { appearance, close, reply }, phase) {
  if (!["before", "after"].includes(phase)) throw Error("Unknown audit phase");
  const output = path.resolve(`test-results/theme-audit-${phase}`);
  await fs.mkdir(output, { recursive: true });
  await appearance(page);
  const names = await page.locator(".theme-preset").allTextContents();
  await close(page);
  const report = [];
  for (const name of names.map((name) => name.trim())) {
    const id = name.toLowerCase().replaceAll(" ", "-");
    await page.setViewportSize({ width: 1440, height: 1000 });
    const showMembers = page.getByRole("button", {
      name: "Show member list",
      exact: true,
    });
    if (await showMembers.isVisible()) await showMembers.click();
    await appearance(page);
    await page.getByRole("button", { name, exact: true }).click();
    await expect(
      page.getByRole("button", { name, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.waitForTimeout(180);
    await page.screenshot({
      path: path.join(output, `${id}-desktop-settings.png`),
    });
    await close(page);
    await reply.scrollIntoViewIfNeeded();
    await page.mouse.move(780, 36);
    await page.screenshot({
      path: path.join(output, `${id}-desktop-chat.png`),
    });
    const palette = await page.evaluate(() => {
      const read = (selector) => {
        const element = document.querySelector(selector);
        const s = getComputedStyle(element);
        return {
          background: s.backgroundColor,
          image: s.backgroundImage,
          color: s.color,
        };
      };
      return Object.fromEntries(
        [
          ".app-titlebar",
          ".sidebar",
          ".member-panel",
          ".conversation-view",
        ].map((selector) => [selector, read(selector)]),
      );
    });
    await page.setViewportSize({ width: 390, height: 844 });
    const hideMembers = page.getByRole("button", {
      name: "Hide member list",
      exact: true,
    });
    if (await hideMembers.isVisible()) await hideMembers.click();
    if (await page.locator(".sidebar.open").count())
      await page.locator(".mobile-menu").click();
    await expect(page.locator(".sidebar")).not.toHaveClass(/\bopen\b/);
    await reply.scrollIntoViewIfNeeded();
    await page.locator(".composer textarea").focus();
    if (phase === "after") {
      await expect(page.locator(".server-rail")).toBeHidden();
      const chat = await page.locator(".workspace").boundingBox();
      if (chat.x !== 0 || chat.width < 389)
        throw Error(`${name}: mobile chat is not full width`);
      await expect(reply.locator(".message-options-toggle")).toBeHidden();
    }
    await page.locator(".composer textarea").evaluate((node) => node.blur());
    await page.screenshot({ path: path.join(output, `${id}-mobile-chat.png`) });
    await appearance(page);
    await page.screenshot({
      path: path.join(output, `${id}-mobile-settings.png`),
    });
    await close(page);
    report.push({ name, id, palette });
  }
  await fs.writeFile(
    path.join(output, "capture.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(`Captured ${report.length} presets in four views: ${output}`);
}
