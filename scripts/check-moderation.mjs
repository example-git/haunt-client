import { expect } from "@playwright/test";
import assert from "node:assert/strict";

export async function checkModeration(browser, fixtures) {
  const contexts = [];
  const errors = [];
  const pageFor = async (user, blocked = false) => {
    const ctx = await browser.newContext({
      viewport: { width: 1400, height: 960 },
    });
    contexts.push(ctx);
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://127.0.0.1:5173");
    await page.getByRole("button", { name: "Add server", exact: true }).click();
    await page.getByLabel("Server address").fill(fixtures.rtc.url);
    await page.getByLabel("Username", { exact: true }).fill(user);
    await page.getByLabel("Password", { exact: true }).fill(fixtures.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    if (!blocked)
      await expect(page.locator(".connection")).toHaveText("Connected");
    return page;
  };
  const settings = (page) =>
    page.getByRole("button", { name: "Server settings", exact: true }).click();
  const section = (page, name) =>
    page
      .getByRole("navigation", { name: "Server settings sections" })
      .getByRole("button", { name, exact: true })
      .click();
  const member = async (page, name) => {
    await section(page, "Members");
    await page.getByLabel("Find a member").fill(name);
    await page
      .locator(".settings-list-row")
      .filter({ hasText: `@${name}` })
      .click();
  };
  try {
    await pageFor("bob");
    const owner = await pageFor("owner"),
      alice = await pageFor("alice");
    await expect(
      alice.getByRole("button", { name: "Server settings", exact: true }),
    ).toHaveCount(0);
    await settings(owner);
    await section(owner, "Roles & permissions");
    await owner.getByLabel("Role name", { exact: true }).fill("Moderator");
    await owner.getByLabel("Role rank", { exact: false }).fill("50");
    for (const label of [
      "Manage server appearance & emojis",
      "Manage lower-ranked roles",
      "Kick members",
      "Ban members & review appeals",
      "View audit log",
      "View member IPs & manage IP bans",
    ]) {
      await owner.getByLabel(label, { exact: true }).check();
    }
    await owner
      .getByRole("button", { name: "Create role", exact: true })
      .click();
    await expect(owner.getByRole("status")).toHaveText("Role saved.");
    await member(owner, "alice");
    await owner.getByLabel("Moderator", { exact: true }).check();
    await owner
      .getByRole("button", { name: "Save member roles", exact: true })
      .click();
    await expect(owner.getByRole("status").first()).toHaveText(
      "Member roles saved.",
    );
    await settings(alice);
    await member(alice, "bob");
    await expect(
      alice.getByRole("button", { name: "Delete account", exact: true }),
    ).toHaveCount(0);
    await alice
      .getByRole("button", { name: "Show recorded IP addresses" })
      .click();
    await expect(alice.getByText("127.0.0.1", { exact: true })).toBeVisible();
    await alice
      .getByRole("button", { name: "Ban account", exact: true })
      .click();
    await alice
      .getByLabel("Reason", { exact: true })
      .fill("Browser moderation check");
    await alice
      .getByRole("button", { name: "Confirm ban", exact: true })
      .click();
    await expect(
      alice.getByText("Account banned", { exact: true }),
    ).toBeVisible();
    const bob = await pageFor("bob", true);
    await expect(
      bob.getByRole("heading", { name: "Account ban", exact: true }),
    ).toBeVisible();
    await expect(
      bob.getByText("Browser moderation check", { exact: true }),
    ).toBeVisible();
    await bob
      .getByLabel("Appeal", { exact: true })
      .fill("Please review this test account ban.");
    await bob
      .getByRole("button", { name: "Submit appeal", exact: true })
      .click();
    await expect(
      bob.getByText("Appeal submitted.", { exact: true }),
    ).toBeVisible();
    await section(owner, "Bans & appeals");
    await expect(
      owner.getByText("Please review this test account ban.", { exact: true }),
    ).toBeVisible();
    await owner
      .getByRole("button", { name: "Mark reviewed", exact: true })
      .click();
    await expect(
      owner.getByRole("button", { name: "Mark reviewed", exact: true }),
    ).toHaveCount(0);
    await owner.getByRole("button", { name: "Lift ban", exact: true }).click();
    await owner
      .getByLabel("Reason for lifting ban")
      .fill("Test appeal accepted");
    await owner
      .getByRole("button", { name: "Confirm lift ban", exact: true })
      .click();
    await expect(
      owner.getByText("No active bans.", { exact: true }),
    ).toBeVisible();
    await bob.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(bob.locator(".connection")).toHaveText("Connected");
    await section(owner, "Audit log");
    await expect(
      owner.getByText("Account banned", { exact: true }),
    ).toBeVisible();
    await expect(owner.getByText("Ban lifted", { exact: true })).toBeVisible();
    await owner.getByRole("button", { name: "Close", exact: true }).click();
    await owner.getByRole("button", { name: "Show member list" }).click();
    await owner.getByLabel("Search members").fill("bob");
    await owner.locator(".member-row").click({ button: "right" });
    await owner
      .getByRole("menuitem", { name: "Manage member", exact: true })
      .click();
    await expect(
      owner.getByRole("heading", { name: "Moderation", exact: true }),
    ).toBeVisible();
    await owner
      .getByRole("button", { name: "Delete account", exact: true })
      .click();
    await owner
      .getByLabel("Reason", { exact: true })
      .fill("Remove test identity");
    await owner
      .getByRole("button", { name: "Confirm delete", exact: true })
      .click();
    await expect(
      owner.getByText("Deleted account", { exact: true }),
    ).toBeVisible();
    await owner.screenshot({ path: "test-results/moderation-ui.png" });
    assert.deepEqual(errors, []);
    console.log(
      "Moderation browser checks passed: roles, delegated UI, IP privacy, bans, appeal review, audit, context menu, deletion.",
    );
  } finally {
    for (const ctx of contexts) await ctx.close();
  }
}
