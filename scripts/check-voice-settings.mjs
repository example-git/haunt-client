import { fillSignin } from "./signin-fields.mjs";
import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { unzipSync, zipSync, strToU8 } from "fflate";

// Web-only integration checks; all accounts/data belong to the isolated fixture.
export async function checkVoiceSettings(browser, fixtures) {
  const contexts = [],
    errors = [];
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "haunt-settings-"));
  const server = fixtures.rtc;
  let ownerToken;
  const api = async (method, route, body, token = ownerToken) => {
    const res = await fetch(server.url + "/api/v1" + route, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    assert(res.ok, `${method} ${route}: ${res.status}`);
    return res.status === 204 ? undefined : res.json();
  };
  const page = async () => {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 850 },
      permissions: ["microphone"],
    });
    contexts.push(ctx);
    const p = await ctx.newPage();
    p.setDefaultTimeout(15000);
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto("http://127.0.0.1:5173");
    return p;
  };
  const login = async (p, user) => {
    await p.getByRole("button", { name: "Add server", exact: true }).click();
    await fillSignin(p, server.url, user);
    await p.getByLabel("Password", { exact: true }).fill(fixtures.password);
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(p.locator(".connection")).toHaveText("Connected");
  };
  const settings = async (p, tab) => {
    await p
      .getByRole("button", { name: "Account settings", exact: true })
      .click();
    await p.getByRole("button", { name: tab, exact: true }).click();
  };
  const close = (p) =>
    p.getByRole("button", { name: "Close", exact: true }).click();
  const saved = (p) =>
    p.evaluate(() => {
      const persistent = Object.keys(localStorage).find((k) =>
        k.startsWith("chatxo-remembered-v1:"),
      );
      return persistent
        ? JSON.parse(localStorage[persistent])
        : JSON.parse(sessionStorage["chatxo-sessions-v1"])[0];
    });
  try {
    ownerToken = (
      await api("POST", "/auth/login", {
        username: "owner",
        password: fixtures.password,
        device_name: "settings fixture",
      })
    ).token;
    const category = await api("POST", "/categories", {
      name: "Shared rooms",
    });
    const channel = await api("POST", "/channels", {
      name: "category-text",
      kind: "text",
      category_id: category.id,
    });
    const owner = await page(),
      member = await page();
    await login(owner, "owner");
    await login(member, "alice");
    await expect(member.locator(".member-panel-header")).toHaveText("Members");
    await expect(
      member.getByRole("button", { name: "Close member list", exact: true }),
    ).toHaveCount(0);
    await member
      .getByRole("button", { name: "Hide member list", exact: true })
      .click();
    await expect(member.locator(".member-panel")).toHaveCount(0);
    await member
      .getByRole("button", { name: "Show member list", exact: true })
      .click();
    await expect(member.locator(".member-panel")).toBeVisible();
    for (const p of [owner, member]) {
      const toggle = p.getByRole("button", {
        name: "Shared rooms",
        exact: true,
      });
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(p.locator(`[data-channel-id="${channel.id}"]`)).toBeHidden();
      await p.reload();
      await p
        .getByRole("button", { name: "Open The Common Room", exact: true })
        .click();
      await expect(p.locator(".connection")).toHaveText("Connected");
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await toggle.click();
      await expect(
        p.locator(`[data-channel-id="${channel.id}"]`),
      ).toBeVisible();
    }
    await expect(
      member.getByRole("button", { name: "Add channel to Shared rooms" }),
    ).toHaveCount(0);
    await owner.locator(".category-heading").hover();
    await owner
      .getByRole("button", { name: "Add channel to Shared rooms" })
      .click();
    await expect(
      owner.getByRole("combobox", { name: "Category", exact: true }),
    ).toHaveValue(category.id);
    await owner
      .getByLabel("Channel name", { exact: true })
      .fill("created-in-category");
    await owner
      .getByRole("dialog", { name: "Create channel", exact: true })
      .getByRole("button", { name: "Create channel", exact: true })
      .click();
    await expect(
      owner.locator(`[data-category-id="${category.id}"]`),
    ).toContainText("created-in-category");
    const memberAccount = await saved(member);
    const role = await api("POST", "/roles", {
      name: "Channel manager",
      permissions: 16,
      position: 1,
    });
    await api("PUT", `/members/${memberAccount.login.user.id}/roles`, {
      role_ids: [role.id],
    });
    await expect(
      member.getByRole("button", { name: "Add channel to Shared rooms" }),
    ).toHaveCount(1);
    await member.locator(".category-heading").hover();
    await member
      .getByRole("button", { name: "Add channel to Shared rooms" })
      .click();
    await expect(
      member.getByRole("combobox", { name: "Category", exact: true }),
    ).toHaveValue(category.id);
    await close(member);
    await api("PUT", `/members/${memberAccount.login.user.id}/roles`, {
      role_ids: [],
    });
    await expect(
      member.getByRole("button", { name: "Add channel to Shared rooms" }),
    ).toHaveCount(0);
    const label = member.locator(".profile .account-address");
    await expect(label).toHaveText(
      `alice@${new URL(memberAccount.instance.public_url).host}`,
    );
    await label.evaluate((el) => (el.style.maxWidth = "80px"));
    await expect(label).toHaveAttribute("data-overflow", "true");
    await label.hover();
    await expect(label.locator("span")).toHaveCSS(
      "animation-name",
      "account-marquee",
    );
    await member.locator(".conversation-head").hover();
    await expect(label.locator("span")).toHaveCSS("animation-name", "none");

    // One plugin shows controls immediately, multiple plugins use one selector.
    await settings(member, "Server audio plugins");
    await expect(
      member.getByLabel("Server audio plugin", { exact: true }),
    ).toHaveCount(0);
    await expect(
      member.getByLabel("Plugin output level", { exact: true }),
    ).toBeVisible();
    await expect(member.locator(".noise-options h3")).toHaveCount(0);
    await member.getByLabel("Plugin output level", { exact: true }).fill("37");
    await close(member);
    const archive = unzipSync(
      new Uint8Array(
        await fs.readFile(
          new URL(
            "../tests/fixtures/audio-plugin/test-audio.zip",
            import.meta.url,
          ),
        ),
      ),
    );
    const manifest = JSON.parse(
      new TextDecoder().decode(archive["manifest.json"]),
    );
    manifest.id = "second-audio";
    manifest.name = "Second audio";
    manifest.fields[0].label = "Second output level";
    archive["manifest.json"] = strToU8(JSON.stringify(manifest));
    const installed = await fetch(server.url + "/api/v1/admin/audio-plugins", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        "Content-Type": "application/zip",
      },
      body: zipSync(archive),
    });
    assert.equal(installed.status, 201);
    await settings(member, "Server audio plugins");
    const selector = member.getByLabel("Server audio plugin", { exact: true });
    await expect(selector).toBeVisible();
    await selector.selectOption("second-audio");
    await expect(
      member.getByLabel("Second output level", { exact: true }),
    ).toHaveValue("100");
    await member.getByLabel("Second output level", { exact: true }).fill("22");
    await selector.selectOption("test-audio");
    await expect(
      member.getByLabel("Plugin output level", { exact: true }),
    ).toHaveValue("37");
    await selector.selectOption("second-audio");
    await expect(
      member.getByLabel("Second output level", { exact: true }),
    ).toHaveValue("22");
    await close(member);
    await member.reload();
    await member
      .getByRole("button", { name: "Open The Common Room", exact: true })
      .click();
    await expect(member.locator(".connection")).toHaveText("Connected");
    await settings(member, "Server audio plugins");
    await expect(selector).toHaveValue("second-audio");
    await expect(
      member.getByLabel("Second output level", { exact: true }),
    ).toHaveValue("22");
    await close(member);
    await api("DELETE", "/admin/audio-plugins/test-audio");
    await api("DELETE", "/admin/audio-plugins/second-audio");
    await settings(member, "Devices");
    await expect(
      member.getByRole("button", { name: "Server audio plugins", exact: true }),
    ).toHaveCount(0);
    await expect(
      member.getByLabel("Noise suppression", { exact: true }),
    ).toBeDisabled();
    await expect(
      member.getByText("Input level · noise cancellation off", { exact: true }),
    ).toBeVisible();
    assert.equal(
      await member.evaluate(
        () =>
          JSON.parse(localStorage["chatxo-client-preferences-v1"])
            .noiseSuppression,
      ),
      true,
    );
    await close(member);

    // Actual encrypted export/import into independent browser storage.
    await settings(member, "Backup & restore");
    const form = member.locator(".backup-settings form").first();
    await form
      .getByLabel("Backup password", { exact: true })
      .fill("test backup password");
    await form
      .getByLabel("Confirm backup password", { exact: true })
      .fill("test backup password");
    const downloading = member.waitForEvent("download");
    await form.getByRole("button", { name: "Export encrypted backup" }).click();
    const download = await downloading,
      file = path.join(scratch, "backup.chatxo");
    await download.saveAs(file);
    await close(member);
    const restored = await page();
    await restored
      .getByRole("button", { name: "Client settings", exact: true })
      .click();
    await restored
      .getByRole("button", { name: "Backup & restore", exact: true })
      .click();
    const importing = restored.locator(".backup-settings form").nth(1);
    await importing.getByLabel("Backup file").setInputFiles(file);
    await importing
      .getByLabel("Backup password", { exact: true })
      .fill("test backup password");
    await importing.getByRole("button", { name: "Preview backup" }).click();
    await restored
      .getByRole("button", { name: "Restore and reload client" })
      .click();
    await restored
      .getByRole("button", { name: "Open The Common Room", exact: true })
      .click();
    await expect(restored.locator(".connection")).toHaveText("Connected");
    const fresh = await saved(restored);
    assert.notEqual(fresh.login.token, memberAccount.login.token);
    assert.notEqual(fresh.login.session.id, memberAccount.login.session.id);
    assert.equal(fresh.login.session.device_name, "Browser · backup restore");
    await settings(restored, "Account");
    await restored
      .getByRole("button", { name: "Sign out of this server", exact: true })
      .click();
    await member.reload();
    await member
      .getByRole("button", { name: "Open The Common Room", exact: true })
      .click();
    await expect(member.locator(".connection")).toHaveText("Connected");
    await api("GET", "/me", undefined, memberAccount.login.token);
    const revoked = await fetch(server.url + "/api/v1/me", {
      headers: { Authorization: `Bearer ${fresh.login.token}` },
    });
    assert.equal(revoked.status, 401);
    assert.deepEqual(errors, []);
    await member.screenshot({ path: "test-results/voice-settings.png" });
    console.log(
      "PASS web: category collapse persistence, owner/role add permission, preselected category, canonical account marquee, zero/one/multiple plugin options and persistence, encrypted backup creates independent device, logout leaves source signed in",
    );
  } finally {
    for (const ctx of contexts) await ctx.close();
    await fs.rm(scratch, { recursive: true, force: true });
  }
}
