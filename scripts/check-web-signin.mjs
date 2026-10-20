import { expect as baseExpect } from "@playwright/test";
import assert from "node:assert/strict";
import { fillSignin } from "./signin-fields.mjs";
const expect = baseExpect.configure({ timeout: 20000 });

export async function checkWebSignin(browser, fixtures) {
  for (const [server, other] of [
    [fixtures.rtc, fixtures.ws],
    [fixtures.ws, fixtures.rtc],
  ]) {
    const contexts = [];
    const errors = [];
    const makePage = async () => {
      const context = await browser.newContext({
        ignoreHTTPSErrors: Boolean(server.tlsCertificate),
      });
      contexts.push(context);
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(server.url);
      return page;
    };
    try {
      const page = await makePage();
      let loginRequests = 0;
      page.on("request", (request) => {
        if (new URL(request.url()).pathname === "/api/v1/auth/login")
          loginRequests++;
      });
      await page
        .getByRole("button", { name: "Add server", exact: true })
        .click();
      await fillSignin(page, other.url, "alice");
      await page
        .getByLabel("Password", { exact: true })
        .fill(fixtures.password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.getByRole("dialog").locator(".error")).toContainText(
        "This web client signs in only to this server",
      );
      assert.equal(
        loginRequests,
        0,
        "Cross-origin sign-in is rejected before credentials are sent",
      );

      await fillSignin(page, server.url, "alice");
      await expect(
        page.getByLabel("Remember this device", { exact: true }),
      ).toBeChecked();
      const response = page.waitForResponse(
        (r) =>
          r.url() === server.url + "/api/v1/auth/login" &&
          r.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      const firstResponse = await response;
      assert.equal(firstResponse.status(), 200);
      const first = await firstResponse.json();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.locator(".connection")).toHaveText("Connected");
      await expect(page.locator(".profile .account-address")).toHaveText(
        `alice@${new URL(server.url).host}`,
      );
      await page
        .locator(`[data-channel-id="${server.general}"] button.channel`)
        .click();
      const text = "Same-origin login survives reload";
      await page
        .getByRole("textbox", { name: "Message", exact: true })
        .fill(text);
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await expect(
        page.locator(".message-body").filter({ hasText: text }),
      ).toBeVisible();
      await page.reload();
      await page
        .getByRole("button", { name: `Open ${server.name}`, exact: true })
        .click();
      await page
        .locator(`[data-channel-id="${server.general}"] button.channel`)
        .click();
      await expect(page.locator(".connection")).toHaveText("Connected");
      await expect(
        page.locator(".message-body").filter({ hasText: text }),
      ).toBeVisible();

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
      assert.equal(
        await page.evaluate(
          async (token) =>
            (
              await fetch("/api/v1/me", {
                headers: { Authorization: `Bearer ${token}` },
              })
            ).status,
          first.token,
        ),
        401,
      );
      await page
        .getByRole("button", { name: "Add server", exact: true })
        .click();
      const saved = page.getByLabel("Saved sign-ins");
      const savedAccount = saved
        .locator("option")
        .filter({ hasText: `alice@${new URL(server.url).host}` });
      await expect(savedAccount).toHaveCount(1);
      const option = await savedAccount.getAttribute("value");
      assert(option, "Saved account address remains available after logout");
      await saved.selectOption(option);
      await page
        .getByLabel("Password", { exact: true })
        .fill("deliberately-incorrect");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.getByRole("dialog").locator(".error")).toHaveText(
        "The username or password is incorrect for this server.",
      );
      await page
        .getByLabel("Password", { exact: true })
        .fill(fixtures.password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.locator(".connection")).toHaveText("Connected");

      const guest = await makePage();
      await guest
        .getByRole("button", { name: "Add server", exact: true })
        .click();
      await guest
        .getByLabel("Account address", { exact: true })
        .fill(`${server.url}/#invite=${server.invitation}`);
      await guest.getByLabel("Username", { exact: true }).fill("origin_guest");
      await guest
        .getByLabel("Password", { exact: true })
        .fill(fixtures.password);
      await guest
        .getByRole("button", { name: "Create account", exact: true })
        .click();
      await expect(guest.locator(".connection")).toHaveText("Connected");
      await expect(guest.locator(".profile .account-address")).toHaveText(
        `origin_guest@${new URL(server.url).host}`,
      );
      assert.deepEqual(errors, []);
      console.log(
        `PASS ${new URL(server.url).protocol} hosted browser: origin boundary, login, messaging/reload, logout revocation, saved sign-in, rejected password and invite signup`,
      );
    } catch (error) {
      for (const [index, context] of contexts.entries()) {
        const page = context.pages()[0];
        if (page) {
          console.error(
            "Hosted sign-in diagnostics:",
            await page.locator(".error, [role=alert]").allTextContents(),
          );
          await page.screenshot({
            path: `test-results/hosted-signin-failure-${index}.png`,
          });
        }
      }
      throw error;
    } finally {
      for (const context of contexts) await context.close();
    }
  }
}
