import { fillSignin } from "./signin-fields.mjs";
import { expect } from "@playwright/test";
import assert from "node:assert/strict";

export async function checkSignin(browser, fixtures, desktopPage) {
  const contexts = [];
  const errors = [];
  const makePage = async () => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 850 },
      ignoreHTTPSErrors: Boolean(fixtures.rtc.tlsCertificate),
    });
    contexts.push(context);
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:5173");
    return page;
  };
  const signIn = async (page, server, user) => {
    await page.getByRole("button", { name: "Add server", exact: true }).click();
    await expect(page.getByLabel("Use HTTPS", { exact: true })).toBeChecked();
    await expect(
      page.getByLabel("Use HTTPS", { exact: true }).locator(".."),
    ).toHaveCSS("flex-direction", "row");
    await expect(page.getByLabel("Username", { exact: true })).toHaveCount(0);
    await fillSignin(page, server.url, user);
    await page.getByLabel("Password", { exact: true }).fill(fixtures.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("dialog"))
      .toHaveCount(0)
      .catch(async (error) => {
        console.error(
          "Sign-in dialog diagnostics:",
          await page.getByRole("dialog").allTextContents(),
        );
        console.error(
          "Sign-in errors:",
          await page.locator(".error, [role=alert]").allTextContents(),
        );
        await page.screenshot({ path: "test-results/signin-failure.png" });
        throw error;
      });
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
    await page.getByRole("button", { name: "Add server", exact: true }).click();
    await expect(page.getByLabel("Use HTTPS", { exact: true })).toBeChecked();
    await page
      .getByLabel("Account address", { exact: true })
      .fill("alice@community.test@other.test");
    await page.getByLabel("Password", { exact: true }).fill(fixtures.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(
      "username@serveraddress",
    );
    assert.equal(responses.length, 0);
    await page
      .getByLabel("Account address", { exact: true })
      .fill(`alice@${new URL(fixtures.rtc.url).host}`);
    await page.screenshot({ path: "test-results/account-address-signin.png" });
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await signIn(page, fixtures.rtc, "alice");
    const first = await responses.at(-1).json();
    const label = page.locator(".profile .account-label");
    await expect(label.locator(".account-display-name")).toHaveText("alice");
    await expect(label.locator(".account-address")).toHaveText(
      `alice@${new URL(fixtures.rtc.url).host}`,
    );
    await page
      .getByRole("button", { name: "Account settings", exact: true })
      .click();
    await page
      .getByLabel("Display name", { exact: true })
      .fill("Alice Example with a deliberately long display name");
    await page
      .getByRole("button", { name: "Save profile", exact: true })
      .click();
    await expect(label.locator(".account-display-name")).toHaveText(
      "Alice Example with a deliberately long display name",
    );
    await page.getByRole("button", { name: "Close", exact: true }).click();
    const geometry = await label.evaluate((element) => {
      const name = element.querySelector(".account-display-name"),
        address = element.querySelector(".account-address");
      return {
        above:
          name.getBoundingClientRect().bottom <=
          address.getBoundingClientRect().top,
        nameSize: parseFloat(getComputedStyle(name).fontSize),
        addressSize: parseFloat(getComputedStyle(address).fontSize),
        nameWeight: getComputedStyle(name).fontWeight,
        addressWeight: getComputedStyle(address).fontWeight,
      };
    });
    assert(geometry.above && geometry.nameSize > geometry.addressSize);
    assert.equal(geometry.nameWeight, "600");
    assert.equal(geometry.addressWeight, "400");
    await expect(label.locator(".account-display-name")).toHaveAttribute(
      "data-overflow",
      "true",
    );
    await label.hover();
    await expect(label.locator(".account-display-name > span")).toHaveCSS(
      "animation-name",
      "account-marquee",
    );
    await page.mouse.move(700, 150);
    await page
      .locator(".profile")
      .screenshot({ path: "test-results/account-label.png" });
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
      // Signing out returns to DMs; the independent saved server stays in the rail.
      await page
        .getByRole("button", { name: `Open ${fixtures.ws.name}`, exact: true })
        .click();
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
      const item = options.find((o) =>
        o.label.includes(`alice@${new URL(fixtures.rtc.url).host}`),
      );
      assert(item, "Signed-out server and username remain available");
      await select.selectOption(item.value);
      await expect(
        page.getByLabel("Account address", { exact: true }),
      ).toHaveValue(`alice@${new URL(fixtures.rtc.url).host}`);
      await expect(page.getByLabel("Use HTTPS", { exact: true })).toBeChecked({
        checked: new URL(fixtures.rtc.url).protocol === "https:",
      });
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
    await page
      .getByRole("button", { name: `Open ${fixtures.rtc.name}`, exact: true })
      .click();
    await expect(page.locator(".connection")).toHaveText("Connected");
    await expect(page.locator(".error")).toHaveCount(0);
    if (!desktopPage) {
      // An invite still asks for a plain username and password, with the host fixed.
      const guest = await makePage();
      await guest
        .getByRole("button", { name: "Add server", exact: true })
        .click();
      await guest
        .getByLabel("Account address", { exact: true })
        .fill(`${fixtures.rtc.url}/#invite=${fixtures.rtc.invitation}`);
      await expect(
        guest.getByLabel("Account address", { exact: true }),
      ).toHaveCount(0);
      await expect(guest.getByLabel("Use HTTPS", { exact: true })).toHaveCount(
        0,
      );
      await expect(guest.locator(".invite-destination")).toContainText(
        fixtures.rtc.url,
      );
      await guest.getByLabel("Username", { exact: true }).fill("addressguest");
      await guest
        .getByLabel("Password", { exact: true })
        .fill(fixtures.password);
      await guest
        .getByRole("button", { name: "Create account", exact: true })
        .click();
      await expect(guest.locator(".connection")).toHaveText("Connected");
      await expect(guest.locator(".profile .account-address")).toHaveText(
        `addressguest@${new URL(fixtures.rtc.url).host}`,
      );
    }
    assert.deepEqual(errors, []);
    console.log(
      `PASS ${desktopPage ? "desktop" : "browser"} sign-in: account address, protocol selection, two-line footer with marquee, ${desktopPage ? "" : "invite signup, "}logout/relogin, fresh session, saved account recovery, rejected credentials, messaging and reload.`,
    );
  } finally {
    for (const context of contexts) await context.close();
  }
}
