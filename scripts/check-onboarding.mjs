import { fillSignin } from "./signin-fields.mjs";
import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function checkOnboarding(
  browser,
  fixtures,
  desktopPage,
  desktopApp,
) {
  const contexts = [],
    errors = [];
  const scratch = await fs.mkdtemp(
    path.join(os.tmpdir(), "chatxo-onboarding-"),
  );
  const makePage = async () => {
    const context = await browser.newContext({
      viewport: { width: 1400, height: 960 },
    });
    contexts.push(context);
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:5173");
    return page;
  };
  const observe = (page) => {
    page.setDefaultTimeout(20000);
    page.on("pageerror", (e) => errors.push(e.message));
  };
  const close = (page) =>
    page.getByRole("button", { name: "Close", exact: true }).click();
  const login = async (page, user, password = fixtures.password) => {
    await page.getByRole("button", { name: "Add server", exact: true }).click();
    await fillSignin(page, fixtures.rtc.url, user);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator(".connection")).toHaveText("Connected");
  };
  const api = async (method, route, token, body) => {
    const res = await fetch(fixtures.rtc.url + "/api/v1" + route, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert(res.ok, `fixture request ${route} failed: ${res.status}`);
    return res.status === 204 ? undefined : res.json();
  };
  const manage = async (owner, user) => {
    await owner
      .getByRole("button", { name: "Server settings", exact: true })
      .click();
    await owner
      .getByRole("navigation", { name: "Server settings sections" })
      .getByRole("button", { name: "Members", exact: true })
      .click();
    await owner.getByLabel("Find a member").fill(user);
    await owner
      .locator(".settings-list-row")
      .filter({ hasText: `@${user}` })
      .click();
  };
  try {
    const owner = await makePage(),
      guest = desktopPage ?? (await makePage());
    observe(owner);
    observe(guest);
    await login(owner, "owner");
    await owner
      .getByRole("button", { name: "Account settings", exact: true })
      .click();
    await owner
      .getByRole("button", { name: "Invitations", exact: true })
      .click();
    await owner
      .getByRole("button", { name: "Create invitation", exact: true })
      .click();
    await expect(owner.locator(".invite-code code")).toBeVisible();
    const link = await owner.locator(".invite-code code").innerText();
    assert(link.startsWith(fixtures.rtc.url + "/#invite="));
    await expect(
      owner.getByRole("button", { name: "Copy invite link" }),
    ).toBeVisible();
    await close(owner);
    await guest
      .getByRole("button", { name: "Add server", exact: true })
      .click();
    await guest.getByLabel("Account address", { exact: true }).fill(link);
    await expect(guest.getByLabel("Invitation code")).toHaveCount(0);
    await expect(guest.locator(".invite-destination")).toContainText(
      fixtures.rtc.url,
    );
    await guest.getByLabel("Username", { exact: true }).fill("inviteduser");
    await guest.getByLabel("Password", { exact: true }).fill("eight888");
    await guest
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await expect(guest.locator(".connection")).toHaveText("Connected");
    const admin = await api("POST", "/auth/login", "", {
      username: "owner",
      password: fixtures.password,
      device_name: "onboarding fixture",
    });
    const users = await api("GET", "/users", admin.token),
      id = users.users.find((u) => u.username === "inviteduser").id;
    await api("POST", "/dms", admin.token, { members: [id] });
    await expect(
      owner.locator(".dm-entry").filter({ hasText: "inviteduser" }),
    ).toBeVisible();
    await manage(owner, "inviteduser");
    await owner
      .getByRole("button", { name: "Reset password", exact: true })
      .click();
    await owner
      .getByLabel("Reason", { exact: true })
      .fill("Onboarding recovery test");
    await owner
      .getByRole("button", { name: "Issue temporary password", exact: true })
      .click();
    await expect(
      owner.getByLabel("Temporary password", { exact: true }),
    ).toBeVisible();
    const temporary = await owner
      .getByLabel("Temporary password", { exact: true })
      .inputValue();
    assert(temporary.length >= 16);
    await expect(
      guest.getByRole("button", { name: "Sign in again", exact: true }),
    ).toBeVisible();
    await guest
      .getByRole("button", { name: "Sign in again", exact: true })
      .click();
    await expect(
      guest.getByLabel("Account address", { exact: true }),
    ).toHaveValue(`inviteduser@${new URL(fixtures.rtc.url).host}`);
    await guest.getByLabel("Password", { exact: true }).fill(temporary);
    await guest.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      guest.getByRole("heading", {
        name: "Choose a new password",
        exact: true,
      }),
    ).toBeVisible();
    assert(
      !(
        await guest.evaluate(() =>
          JSON.stringify([localStorage, sessionStorage]),
        )
      ).includes(temporary),
    );
    await guest.getByLabel("New password", { exact: true }).fill("newpass8");
    await guest
      .getByLabel("Confirm new password", { exact: true })
      .fill("newpass8");
    await guest
      .getByRole("button", { name: "Change password and sign in", exact: true })
      .click();
    await expect(guest.locator(".connection")).toHaveText("Connected");
    const exportedPreferences = {
      "chatxo-client-preferences-v1": JSON.stringify({
        accentColor: "#d0e0f1",
        enabled: true,
        sound: "chime",
        volume: 37,
        noiseSuppression: true,
        automaticGainControl: false,
        microphoneGain: 135,
        servers: { [admin.instance_id]: "mute" },
        channels: {
          [JSON.stringify([admin.instance_id, fixtures.rtc.channel])]:
            "mentions",
        },
      }),
      "chatxo-user-volumes-v1": JSON.stringify({
        [JSON.stringify([
          JSON.stringify([admin.instance_id, id]),
          admin.user.id,
        ])]: { audio: 23, camera_audio: 54, screen_audio: 65 },
      }),
      "chatxo-voice-sounds": "off",
      "chatxo-call-window-v1": JSON.stringify({
        left: 20,
        top: 40,
        width: 380,
        height: 260,
      }),
      ["chatxo-emoji-recents:" + JSON.stringify([admin.instance_id, id])]:
        JSON.stringify(["😀"]),
    };
    await guest.evaluate((values) => {
      for (const [key, value] of Object.entries(values))
        localStorage.setItem(key, value);
    }, exportedPreferences);
    await guest
      .getByRole("button", { name: "Account settings", exact: true })
      .click();
    await guest
      .getByRole("button", { name: "Backup & restore", exact: true })
      .click();
    const exporting = guest.locator(".backup-settings form").filter({
      has: guest.getByRole("button", { name: "Export encrypted backup" }),
    });
    await exporting
      .getByLabel("Backup password", { exact: true })
      .fill("backup-pass8");
    await exporting
      .getByLabel("Confirm backup password", { exact: true })
      .fill("backup-pass8");
    const filename = path.join(scratch, "backup.chatxo");
    if (desktopApp) {
      await desktopApp.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath });
      }, filename);
      await exporting
        .getByRole("button", { name: "Export encrypted backup" })
        .click();
      await expect(guest.getByRole("status")).toContainText(
        "Encrypted backup saved.",
      );
    } else {
      const downloading = guest.waitForEvent("download");
      await exporting
        .getByRole("button", { name: "Export encrypted backup" })
        .click();
      const download = await downloading;
      await download.saveAs(filename);
    }
    const encrypted = await fs.readFile(filename, "utf8");
    assert(!encrypted.includes("inviteduser"));
    assert(!encrypted.includes(temporary));
    const restored = await makePage();
    observe(restored);
    await restored
      .getByRole("button", { name: "Client settings", exact: true })
      .click();
    await restored
      .getByRole("button", { name: "Backup & restore", exact: true })
      .click();
    const importing = restored.locator(".backup-settings form").filter({
      has: restored.getByRole("button", { name: "Preview backup" }),
    });
    await importing.getByLabel("Backup file").setInputFiles(filename);
    await importing
      .getByLabel("Backup password", { exact: true })
      .fill("wrong-pass");
    await importing.getByRole("button", { name: "Preview backup" }).click();
    await expect(restored.locator(".error")).toContainText(
      "incorrect or the file is damaged",
    );
    await importing
      .getByLabel("Backup password", { exact: true })
      .fill("backup-pass8");
    await importing.getByRole("button", { name: "Preview backup" }).click();
    await expect(restored.locator(".backup-preview")).toContainText(
      "inviteduser",
    );
    await restored
      .getByRole("button", { name: "Restore and reload client" })
      .click();
    await expect(restored.locator(".connection")).toHaveText("Connected");
    const importedPreferences = await restored.evaluate(
      (keys) =>
        Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)])),
      Object.keys(exportedPreferences),
    );
    assert.deepEqual(
      importedPreferences,
      exportedPreferences,
      "all client preferences must survive export/import",
    );
    await close(owner);
    await manage(owner, "inviteduser");
    await owner
      .getByRole("button", { name: "Delete account", exact: true })
      .click();
    await owner
      .getByLabel("Reason", { exact: true })
      .fill("Delete onboarding test user");
    await owner
      .getByRole("button", { name: "Confirm delete", exact: true })
      .click();
    await expect(
      owner.locator(".settings-list-row").filter({ hasText: "@inviteduser" }),
    ).toHaveCount(0);
    await close(owner);
    await expect(
      owner.locator(".dm-entry").filter({ hasText: "inviteduser" }),
    ).toHaveCount(0);
    await owner.getByRole("button", { name: "Show member list" }).click();
    await owner.getByLabel("Search members").fill("inviteduser");
    await expect(owner.locator(".member-row")).toHaveCount(0);
    await expect(
      restored.getByRole("button", { name: "Sign in again", exact: true }),
    ).toBeVisible();
    // Clearing web token storage must not discard the independent IndexedDB directory.
    await restored.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await restored.reload();
    await restored
      .getByRole("button", { name: "Add server", exact: true })
      .click();
    await restored.getByLabel("Saved sign-ins", { exact: true }).selectOption({
      label: `inviteduser@${new URL(fixtures.rtc.url).host} · The Common Room`,
    });
    await expect(
      restored.getByLabel("Account address", { exact: true }),
    ).toHaveValue(`inviteduser@${new URL(fixtures.rtc.url).host}`);
    await api("POST", "/auth/logout", admin.token);
    assert.deepEqual(errors, []);
    console.log(
      `Onboarding passed (${desktopPage ? "packaged desktop → browser backup" : "browser"}): invite, 8-character signup, forced reset, expired sign-in recovery, encrypted backup/import, live deleted-user removal.`,
    );
  } finally {
    for (const ctx of contexts) await ctx.close();
    await fs.rm(scratch, { recursive: true, force: true });
  }
}
