import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import { fillSignin } from "./signin-fields.mjs";
export async function checkNotificationSearch(browser, fixtures) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const errors = [];
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("http://127.0.0.1:5173");
    for (const server of [fixtures.rtc, fixtures.ws]) {
      await page
        .getByRole("button", { name: "Add server", exact: true })
        .click();
      await fillSignin(page, server.url, "owner");
      await page
        .getByLabel("Password", { exact: true })
        .fill(fixtures.password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.locator(".connection")).toHaveText("Connected", {
        timeout: 20_000,
      });
    }
    await page
      .getByRole("button", { name: "Account settings", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Notification Settings", exact: true })
      .click();
    const selector = page.getByLabel("Server for notifications", {
      exact: true,
    });
    const options = await selector
      .locator("option")
      .evaluateAll((els) =>
        els.map((el) => ({ value: el.value, text: el.textContent })),
      );
    const scopes = [fixtures.rtc, fixtures.ws].map(
      (server) =>
        options.find((option) => option.text.includes(server.name)).value,
    );
    const search = page.getByLabel("Find a user for notifications", {
      exact: true,
    });
    const results = page.locator(".notification-user-result");
    let newDMs = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && /\/conversations$/.test(request.url()))
        newDMs++;
    });
    await selector.selectOption(scopes[0]);
    await expect(results).toHaveCount(0);
    await search.fill("alice");
    await expect(results).toHaveCount(1);
    const firstLabel = `alice@${new URL(fixtures.rtc.url).host}`;
    await expect(results).toContainText(firstLabel);
    await page
      .getByLabel(`Notifications for ${firstLabel}`, { exact: true })
      .selectOption("mute");
    await page
      .getByLabel(`Notification sound for ${firstLabel}`, { exact: true })
      .selectOption("chime");
    const order = await page.evaluate(() => {
      const server = document.querySelector(
        '[aria-label="Server for notifications"]',
      );
      const users = document.querySelector(".notification-user-search");
      const channels = [
        ...document.querySelectorAll(".notification-rules h4"),
      ].find((el) => el.textContent === "Channel overrides");
      return (
        !!(
          server.compareDocumentPosition(users) &
          Node.DOCUMENT_POSITION_FOLLOWING
        ) &&
        !!(
          users.compareDocumentPosition(channels) &
          Node.DOCUMENT_POSITION_FOLLOWING
        )
      );
    });
    assert(
      order,
      "Search results must sit between the server selector and channel overrides",
    );
    await selector.selectOption(scopes[1]);
    await expect(search).toHaveValue("");
    await expect(results).toHaveCount(0);
    await search.fill("alice");
    const secondLabel = `alice@${new URL(fixtures.ws.url).host}`;
    await expect(results).toHaveCount(1);
    await expect(results).toContainText(secondLabel);
    await expect(
      page.getByLabel(`Notifications for ${secondLabel}`, { exact: true }),
    ).toHaveValue("inherit");
    await expect(
      page.getByLabel(`Notification sound for ${secondLabel}`, { exact: true }),
    ).toHaveValue("inherit");
    await search.fill("nobody matches this");
    await expect(results).toHaveCount(0);
    await expect(
      page.getByText("No matching users on this server."),
    ).toBeVisible();
    await search.fill("   ");
    await expect(results).toHaveCount(0);
    await expect(
      page.getByText("No matching users on this server."),
    ).toHaveCount(0);
    await selector.selectOption(scopes[0]);
    await search.fill("alice");
    await expect(
      page.getByLabel(`Notifications for ${firstLabel}`, { exact: true }),
    ).toHaveValue("mute");
    assert.equal(
      newDMs,
      0,
      "Editing a user's notifications must not create a DM",
    );
    await page.screenshot({
      path: "test-results/notification-user-search.png",
    });
    await page.reload();
    await page
      .getByRole("button", { name: `Open ${fixtures.rtc.name}`, exact: true })
      .click();
    await expect(page.locator(".connection")).toHaveText("Connected", {
      timeout: 20_000,
    });
    await page
      .getByRole("button", { name: "Account settings", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Notification Settings", exact: true })
      .click();
    await selector.selectOption(scopes[0]);
    await search.fill("alice");
    await expect(
      page.getByLabel(`Notifications for ${firstLabel}`, { exact: true }),
    ).toHaveValue("mute");
    await expect(
      page.getByLabel(`Notification sound for ${firstLabel}`, { exact: true }),
    ).toHaveValue("chime");
    assert.deepEqual(errors, []);
    console.log(
      "PASS notification search: two servers, empty/no-match queries, scope reset, saved rules/sounds, reload, ordering and no DM creation",
    );
  } finally {
    await context.close();
  }
}
