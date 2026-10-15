import { expect } from "@playwright/test";
import assert from "node:assert/strict";

export async function checkSignin(browser, fixtures, desktopPage) {
  const contexts = [];
  const errors = [];
  const makePage = async () => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 850 },
    });
    contexts.push(context);
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:5173");
    return page;
  };
  const signIn = async (page, server, user) => {
    await page.getByRole("button", { name: "Add server", exact: true }).click();
    await page.getByLabel("Server address").fill(server.url);
    await page.getByLabel("Username", { exact: true }).fill(user);
    await page.getByLabel("Password", { exact: true }).fill(fixtures.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".connection")).toHaveText("Connected");
  };
  try {
    const page = desktopPage ?? (await makePage());
    page.on("pageerror", (e) => errors.push(e.message));
    page.setDefaultTimeout(15000);
    const responses = [];
    page.on("response", (response) => {
      if (response.url() === fixtures.rtc.url + "/api/v1/auth/login")
        responses.push(response);
    });
    await signIn(page, fixtures.rtc, "alice");
    const first = await responses.at(-1).json();
    await signIn(page, fixtures.ws, "bob");
    await page
      .getByRole("button", { name: `Open ${fixtures.rtc.name}`, exact: true })
      .click();
    const logout = async () => {
      await page
        .getByRole("button", { name: "Account settings", exact: true })
        .click();
      await page
        .getByRole("navigation", { name: "User settings sections" })
        .getByRole("button", { name: "Account", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Sign out of this server", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(
        page.getByRole("button", {
          name: `Open ${fixtures.rtc.name}`,
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(page.locator(".connection")).toHaveText("Connected");
      await expect(page.locator(".profile")).toContainText("bob");
    };
    const saved = async () => {
      await page
        .getByRole("button", { name: "Add server", exact: true })
        .click();
      const select = page.getByLabel("Saved sign-ins");
      const options = await select
        .locator("option")
        .evaluateAll((options) =>
          options.map((o) => ({ label: o.textContent, value: o.value })),
        );
      const item = options.find(
        (o) => o.label.includes("@alice") && o.label.includes(fixtures.rtc.url),
      );
      assert(item, "Signed-out server and username remain available");
      await select.selectOption(item.value);
      await expect(page.getByLabel("Username", { exact: true })).toHaveValue(
        "alice",
      );
      await expect(page.getByLabel("Server address")).toHaveValue(
        fixtures.rtc.url,
      );
    };
    await logout();
    const oldStatus = await page.evaluate(
      async ({ origin, token }) =>
        (
          await fetch(origin + "/api/v1/me", {
            headers: { Authorization: `Bearer ${token}` },
          })
        ).status,
      { origin: fixtures.rtc.url, token: first.token },
    );
    assert.equal(oldStatus, 401, "Only the old session is revoked");
    await saved();
    await page.getByLabel("Password", { exact: true }).fill(fixtures.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".connection")).toHaveText("Connected");
    const second = await responses.at(-1).json();
    assert.notEqual(second.token, first.token);
    assert.notEqual(second.session.id, first.session.id);
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Fresh login works");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      page.locator(".message-body").filter({ hasText: "Fresh login works" }),
    ).toBeVisible();
    await logout();
    await saved();
    await page
      .getByLabel("Password", { exact: true })
      .fill("deliberately-incorrect");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("dialog").locator(".error")).toHaveText(
      "The username or password is incorrect for this server.",
    );
    await page.getByLabel("Password", { exact: true }).fill(fixtures.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".connection")).toHaveText("Connected");
    await page.reload();
    await expect(page.locator(".connection")).toHaveText("Connected");
    await page
      .getByRole("button", { name: `Open ${fixtures.rtc.name}`, exact: true })
      .click();
    await expect(page.locator(".connection")).toHaveText("Connected");
    await expect(page.locator(".error")).toHaveCount(0);
    assert.deepEqual(errors, []);
    console.log(
      `PASS ${desktopPage ? "desktop" : "browser"} sign-in: logout/relogin without reload, fresh token, old token revoked, other server unaffected, saved server/username, rejected credentials, corrected retry, messaging and reload.`,
    );
  } finally {
    for (const context of contexts) await context.close();
  }
}
