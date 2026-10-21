import { fillSignin } from "./signin-fields.mjs";
import { expect as baseExpect } from "@playwright/test";
const expect = baseExpect.configure({ timeout: 20_000 });
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
export async function checkSecureDM(
  page,
  fixtures,
  browser,
  label = "browser",
) {
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const peerContext = await browser.newContext({
    viewport: { width: 1400, height: 960 },
  });
  const extras = [];
  const peerUser = label === "electron" ? "bob" : "alice";
  const peer = await peerContext.newPage();
  peer.setDefaultTimeout(20000);
  peer.on("pageerror", (e) => errors.push(e.message));
  const api = async (path, body, token, method = body ? "POST" : "GET") => {
    const r = await fetch(fixtures.rtc.url + "/api/v1" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    assert(r.ok, `${method} ${path} ${r.status} ${text}`);
    return text ? JSON.parse(text) : undefined;
  };
  const login = async (p, user) => {
    await p.getByRole("button", { name: "Add server", exact: true }).click();
    await fillSignin(p, fixtures.rtc.url, user);
    await p.getByLabel("Password", { exact: true }).fill(fixtures.password);
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(p.locator(".connection")).toHaveText("Connected");
  };
  const home = async (p) => {
    await p
      .getByRole("button", { name: /^Direct messages and notifications/ })
      .click();
    await expect(p.locator(".dm-home")).toBeVisible();
  };
  const create = async (p, user) => {
    await home(p);
    await p
      .getByRole("button", { name: "New direct message", exact: true })
      .click();
    await p.getByLabel("Find people").fill(user);
    await p.locator(".people-list input[type=checkbox]").check();
    await p
      .getByRole("button", { name: "Start conversation", exact: true })
      .click();
    await expect(p.locator(".dm-workspace")).toBeVisible();
  };
  const send = async (p, body) => {
    await p.getByRole("textbox", { name: "Message", exact: true }).fill(body);
    await p.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(
      p.locator(".message-body").filter({ hasText: body }),
    ).toHaveCount(1);
  };
  const show = async (p, text) =>
    await expect(
      p.locator(".message-body").filter({ hasText: text }),
    ).toHaveCount(1);
  try {
    const alice = await api("/auth/login", {
      username: peerUser,
      password: fixtures.password,
      device_name: "dm-test",
    });
    const owner = await api("/auth/login", {
      username: "owner",
      password: fixtures.password,
      device_name: "dm-test",
    });
    const dm = await api("/dms", { members: [alice.user.id] }, owner.token);
    const legacy = await api(
      `/conversations/${dm.id}/messages`,
      {
        request_id: crypto.randomUUID(),
        body: `${label} old unencrypted message`,
      },
      owner.token,
    );
    await peer.goto(fixtures.rtc.url);
    await login(peer, peerUser);
    await login(page, "owner");
    await peer
      .getByRole("button", { name: "Account settings", exact: true })
      .click();
    await peer.getByRole("button", { name: "Appearance", exact: true }).click();
    await peer.getByRole("radio", { name: "Compact", exact: true }).check();
    await peer.getByRole("button", { name: "Close", exact: true }).click();
    await expect(
      page
        .locator(".sidebar")
        .getByRole("button", { name: "New direct message" }),
    ).toHaveCount(0);
    await create(page, peerUser);
    await create(peer, "owner");
    await expect(page.locator(".dm-info")).toContainText(
      "New messages and images are end-to-end encrypted.",
    );
    await expect(peer.locator(".dm-info")).toContainText(
      "New messages and images are end-to-end encrypted.",
    );
    await show(page, `${label} old unencrypted message`);
    await show(peer, `${label} old unencrypted message`);
    await expect(
      page
        .locator(".message")
        .filter({ hasText: `${label} old unencrypted message` })
        .getByRole("img", { name: "Not end-to-end encrypted", exact: true }),
    ).toHaveAttribute("title", "Not end-to-end encrypted");
    console.log("DM ready", label);
    const greeting = `${label} secret first`;
    await send(page, greeting);
    await show(peer, greeting);
    await expect(peer.locator(".dm-workspace .messages")).toHaveClass(
      /chat-display-compact/,
    );
    await expect(peer.locator(".dm-workspace .message-avatar")).toHaveCount(0);
    await expect(
      peer
        .locator(".message")
        .filter({ hasText: greeting })
        .locator(".compact-message-time"),
    ).toBeVisible();
    await peer.screenshot({ path: `test-results/compact-dm-${label}.png` });
    await expect(
      peer
        .locator(".message")
        .filter({ hasText: greeting })
        .getByRole("img", { name: "End-to-end encrypted", exact: true }),
    ).toHaveAttribute("title", "End-to-end encrypted");
    const headerMessage = peer
      .locator(".message")
      .filter({ hasText: greeting });
    await expect(
      headerMessage.locator(".message-meta > .message-security:first-child"),
    ).toHaveCount(1);
    await expect(
      headerMessage.locator(".message-body .message-security"),
    ).toHaveCount(0);
    assert.equal(
      await headerMessage.locator(".message-body").evaluate((el) => {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        selection.removeAllRanges();
        selection.addRange(range);
        const text = selection.toString();
        selection.removeAllRanges();
        return text;
      }),
      greeting,
    );
    const raw = await api(
      `/conversations/${dm.id}/messages`,
      undefined,
      owner.token,
    );
    assert(
      raw.messages
        .filter((m) => m.id !== legacy.id)
        .every(
          (m) =>
            m.body.startsWith("!haunt-mls-v1!") && !m.body.includes(greeting),
        ),
      "new messages reach server only as MLS ciphertext",
    );
    assert.equal(
      raw.messages.find((m) => m.id === legacy.id)?.body,
      `${label} old unencrypted message`,
    );
    const plain = await fetch(
      `${fixtures.rtc.url}/api/v1/conversations/${dm.id}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${owner.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          request_id: crypto.randomUUID(),
          body: "plaintext forbidden",
        }),
      },
    );
    assert.equal(plain.status, 409);
    // Simulate a client upgraded with an old wire-envelope history row. Keep
    // crypto keys: clearing message history must not be needed to repair it.
    await page.evaluate(
      async ({ message, scope }) => {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open("chatxo-history-v1", 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        await new Promise((resolve, reject) => {
          const tx = db.transaction("messages", "readwrite");
          tx.objectStore("messages").put({ ...message, scope });
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });
        db.close();
      },
      {
        message: raw.messages.find((m) => m.id !== legacy.id),
        scope: JSON.stringify([owner.instance_id, owner.user.id]),
      },
    );
    await page.addInitScript(() => {
      window.dmWireFlashes = 0;
      const check = (value) => {
        if (value?.includes("!haunt-mls-")) window.dmWireFlashes++;
      };
      new MutationObserver((records) => {
        for (const record of records) {
          if (record.type === "characterData") {
            check(record.oldValue);
            check(record.target.textContent);
          }
          for (const node of record.addedNodes) check(node.textContent);
        }
      }).observe(document, {
        childList: true,
        subtree: true,
        characterData: true,
        characterDataOldValue: true,
      });
    });
    await page.reload();
    await expect(page.locator(".dm-home-entry").first()).toContainText(
      greeting,
    );
    await page.locator(".dm-home-entry").first().click();
    await expect(page.locator(".dm-info")).toContainText(
      "end-to-end encrypted",
    );
    await show(page, greeting);
    assert.equal(
      await page.evaluate(() => window.dmWireFlashes),
      0,
      "old cached wire content flashed in UI",
    );
    // Re-fetch into an empty history cache with the same device keys.
    await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("chatxo-history-v1", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction("messages", "readwrite");
        tx.objectStore("messages").clear();
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    });
    await page.reload();
    await page.locator(".dm-home-entry").first().click();
    await show(page, greeting);
    assert.equal(
      await page.evaluate(() => window.dmWireFlashes),
      0,
      "fresh history wire content flashed in UI",
    );
    await send(peer, `${label} reply after reload`);
    await show(page, `${label} reply after reload`);
    await home(page);
    await send(peer, `${label} unread reply`);
    await expect(page.locator(".dm-rail .conversation-badge")).toBeVisible();
    await expect(
      page.locator(".server-rail > .rail-button .conversation-badge"),
    ).toHaveCount(0);
    await expect(page.locator(".haunt-home .conversation-badge")).toHaveCount(
      0,
    );
    await page.locator(".dm-rail button").first().click();
    await show(page, `${label} unread reply`);
    await expect(page.locator(".dm-rail .conversation-badge")).toHaveCount(0);
    // Names open profiles, whose Message user action returns to this DM.
    await page.locator(".message-meta .user-name").last().click();
    await expect(
      page.getByRole("dialog", { name: "Member profile" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Message user", exact: true })
      .click();
    const image = await page.evaluate(async () => {
      const c = document.createElement("canvas");
      c.width = 120;
      c.height = 80;
      const x = c.getContext("2d");
      x.fillStyle = "#fe7381";
      x.fillRect(0, 0, 120, 80);
      return Array.from(
        new Uint8Array(
          await (
            await new Promise((r) => c.toBlob(r, "image/png"))
          ).arrayBuffer(),
        ),
      );
    });
    // The whole chat surface accepts a dropped image and the sender compresses it.
    await page
      .locator(".dm-workspace .conversation-view")
      .evaluate((el, bytes) => {
        const dt = new DataTransfer();
        dt.items.add(
          new File([new Uint8Array(bytes)], "private.png", {
            type: "image/png",
          }),
        );
        el.dispatchEvent(
          new DragEvent("drop", { bubbles: true, dataTransfer: dt }),
        );
      }, image);
    await expect(page.locator(".attachment-chips")).toBeVisible();
    await send(page, `${label} encrypted picture`);
    await show(peer, `${label} encrypted picture`);
    await expect(peer.locator("img.attachment-image")).toBeVisible();
    const messages = (
      await api(`/conversations/${dm.id}/messages`, undefined, alice.token)
    ).messages;
    const photo = messages.find((m) => m.attachment_ids?.length);
    assert(photo);
    const download = await fetch(
      `${fixtures.rtc.url}/api/v1/attachments/${photo.attachment_ids[0]}`,
      { headers: { Authorization: `Bearer ${alice.token}` } },
    );
    assert.equal(download.status, 200);
    assert.equal(
      download.headers.get("content-type"),
      "application/octet-stream",
    );
    const cipher = new Uint8Array(await download.arrayBuffer());
    assert.equal(cipher[0], 1);
    assert.notEqual(Buffer.from(cipher.slice(0, 4)).toString(), "RIFF");
    await page.getByRole("button", { name: "Backup", exact: true }).click();
    const csvDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV", exact: true }).click();
    const csv = await csvDownload;
    const csvText = await fs.readFile(await csv.path(), "utf8");
    assert(csvText.includes(greeting));
    assert(!csvText.includes("!haunt-mls-v1!"));
    await page.getByRole("button", { name: "Backup", exact: true }).click();
    const htmlDownload = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Export HTML ZIP", exact: true })
      .click();
    const zip = unzipSync(
      new Uint8Array(await fs.readFile(await (await htmlDownload).path())),
    );
    assert(Object.keys(zip).some((n) => n.endsWith(".webp")));
    assert(
      Object.entries(zip).some(
        ([n, b]) => n.endsWith(".html") && strFromU8(b).includes(greeting),
      ),
    );
    // Image validation is not repeated on cached loads; it renders while file endpoint is unavailable.
    await peer.route("**/api/v1/attachments/" + photo.attachment_ids[0], (r) =>
      r.abort(),
    );
    await peer.reload();
    await peer.locator(".dm-home-entry").first().click();
    await show(peer, `${label} encrypted picture`);
    await expect(peer.locator("img.attachment-image")).toBeVisible();
    // Runtime DM policy hides uploading and keeps text messaging available.
    const cfg = await api("/instance/configuration", undefined, owner.token);
    cfg.settings.limits.dm.images_enabled = false;
    await api(
      "/instance/configuration",
      { revision: cfg.revision, settings: cfg.settings },
      owner.token,
      "PUT",
    );
    await expect(
      page.getByRole("button", { name: "Attach image", exact: true }),
    ).toHaveCount(0);
    await send(peer, `${label} text with images disabled`);
    await show(page, `${label} text with images disabled`);
    const updated = await api(
      "/instance/configuration",
      undefined,
      owner.token,
    );
    updated.settings.limits.dm.images_enabled = true;
    await api(
      "/instance/configuration",
      { revision: updated.revision, settings: updated.settings },
      owner.token,
      "PUT",
    );

    // Editing uses a new authenticated application message, while deleting preserves the tombstone.
    const own = page.locator(".message").filter({ hasText: greeting });
    await own.click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "Edit message", exact: true })
      .click();
    await own.locator("textarea").fill(greeting + " edited");
    await own.getByRole("button", { name: "Save", exact: true }).click();
    await show(peer, greeting + " edited");
    if (label === "browser") {
      // A recovery import must read old text and add a distinct live sending device.
      const deviceIDs = async (p) =>
        p.evaluate(
          () =>
            new Promise((resolve, reject) => {
              const r = indexedDB.open("haunt-dm-crypto-v1");
              r.onsuccess = () => {
                const q = r.result
                  .transaction("accounts")
                  .objectStore("accounts")
                  .getAll();
                q.onsuccess = () => resolve(q.result.map((a) => a.device));
                q.onerror = () => reject(q.error);
              };
              r.onerror = () => reject(r.error);
            }),
        );
      const beforeDevices = await deviceIDs(page);
      await page
        .getByRole("button", { name: "Client settings", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Backup & restore", exact: true })
        .click();
      const exporting = page.locator(".backup-settings form").first();
      await exporting
        .getByLabel("Backup password", { exact: true })
        .fill("dm-backup-test");
      await exporting
        .getByLabel("Confirm backup password", { exact: true })
        .fill("dm-backup-test");
      const downloading = page.waitForEvent("download");
      await exporting
        .getByRole("button", { name: "Export encrypted backup" })
        .click();
      const backup = await downloading;
      const filename = await backup.path();
      assert(!(await fs.readFile(filename, "utf8")).includes(greeting));
      await page.getByRole("button", { name: "Close", exact: true }).click();
      const restoredContext = await browser.newContext({
        viewport: { width: 1400, height: 960 },
      });
      extras.push(restoredContext);
      const restored = await restoredContext.newPage();
      let holdAcknowledgments = false;
      const acknowledgments = [];
      await restored.routeWebSocket("**/api/v1/events", (socket) => {
        const upstream = socket.connectToServer();
        upstream.onMessage((message) => {
          if (holdAcknowledgments)
            acknowledgments.push(() => socket.send(message));
          else socket.send(message);
        });
      });
      restored.on("pageerror", (e) => errors.push(e.message));
      await restored.goto(fixtures.rtc.url);
      await restored
        .getByRole("button", { name: "Client settings", exact: true })
        .click();
      await restored
        .getByRole("button", { name: "Backup & restore", exact: true })
        .click();
      const importing = restored.locator(".backup-settings form").nth(1);
      await importing.getByLabel("Backup file").setInputFiles(filename);
      await importing
        .getByLabel("Backup password", { exact: true })
        .fill("dm-backup-test");
      await importing.getByRole("button", { name: "Preview backup" }).click();
      await expect(restored.locator(".backup-preview")).toContainText("owner");
      await restored
        .getByRole("button", { name: "Restore and reload client" })
        .click();
      await restored.locator(".dm-home-entry").first().click();
      await show(restored, greeting + " edited");
      await expect(restored.locator(".dm-info")).toContainText(
        "New messages and images are end-to-end encrypted.",
        { timeout: 20000 },
      );
      assert(
        (await deviceIDs(restored)).every((id) => !beforeDevices.includes(id)),
        "restored install has an independent device key",
      );
      await send(restored, "new device after recovery");
      await show(peer, "new device after recovery");
      await show(page, "new device after recovery");
      console.log("PASS backup recovery and independent sending device");
      // Simultaneous sends and a lost HTTP response must not duplicate ratchets or messages.
      let dropped = false;
      const attempts = [];
      await restored.route(
        "**/api/v1/conversations/*/messages",
        async (route) => {
          if (route.request().method() === "POST") {
            attempts.push(route.request().postDataJSON());
            if (!dropped) {
              dropped = true;
              await route.fetch();
              await route.abort();
              return;
            }
          }
          await route.continue();
        },
      );
      holdAcknowledgments = true;
      await restored
        .getByRole("textbox", { name: "Message", exact: true })
        .fill("lost response safe retry");
      await restored
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await show(peer, "lost response safe retry");
      const retry = restored
        .locator(".pending-message")
        .getByRole("button", { name: "Retry", exact: true });
      await retry.click();
      await show(restored, "lost response safe retry");
      await expect(restored.locator(".pending-message")).toHaveCount(0);
      assert.equal(attempts.length, 2);
      assert.deepEqual(attempts[1], attempts[0]);
      assert(
        acknowledgments.length > 0,
        "The sender acknowledgment was delayed",
      );
      holdAcknowledgments = false;
      for (const deliver of acknowledgments.splice(0)) deliver();
      await show(restored, "lost response safe retry");
      await show(peer, "lost response safe retry");
      const delivered = await api(
        `/conversations/${dm.id}/messages`,
        undefined,
        owner.token,
      );
      assert.equal(
        delivered.messages.filter(
          (message) => message.request_id === attempts[0].request_id,
        ).length,
        1,
      );
      await Promise.all([
        send(page, "parallel original"),
        send(restored, "parallel restored"),
      ]);
      await show(peer, "parallel original");
      await show(peer, "parallel restored");
      await restored.unroute("**/api/v1/conversations/*/messages");
      // Three users have a separate MLS group; both other users receive its text.
      const bobContext = await browser.newContext();
      extras.push(bobContext);
      const bob = await bobContext.newPage();
      await bob.goto(fixtures.rtc.url);
      await login(bob, "bob");
      const group = async (p, users) => {
        await home(p);
        await p
          .getByRole("button", { name: "New direct message", exact: true })
          .click();
        for (const user of users) {
          await p.getByLabel("Find people").fill(user);
          await p.locator(".people-list input[type=checkbox]").check();
        }
        await p
          .getByRole("button", { name: "Start conversation", exact: true })
          .click();
        await expect(p.locator(".dm-info")).toContainText(
          "New messages and images are end-to-end encrypted.",
          { timeout: 20000 },
        );
      };
      await group(page, ["alice", "bob"]);
      await group(peer, ["owner", "bob"]);
      await group(bob, ["owner", "alice"]);
      await send(page, "private three-user group");
      await show(peer, "private three-user group");
      await show(bob, "private three-user group");
      console.log("PASS group DM with three users and four devices");
      const quota = await api(
        "/instance/configuration",
        undefined,
        owner.token,
      );
      quota.settings.limits.dm.image_max_bytes = 1024;
      quota.settings.limits.dm.user_storage_bytes = 1024;
      await api(
        "/instance/configuration",
        { revision: quota.revision, settings: quota.settings },
        owner.token,
        "PUT",
      );
      const used = await api("/me/dm-storage", undefined, owner.token);
      const padding = 900 - used.used_bytes;
      if (padding > 29) {
        const r = await fetch(
          `${fixtures.rtc.url}/api/v1/conversations/${dm.id}/attachments?size=${padding}&filename=encrypted-image&encrypted=1`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${owner.token}` },
            body: new Uint8Array(padding),
          },
        );
        assert.equal(r.status, 201);
      }
      await page
        .getByRole("button", { name: `Open ${fixtures.rtc.name}`, exact: true })
        .click();
      await expect(page.locator(".dm-storage-warning")).toContainText(
        "nearing",
      );
      await page
        .getByRole("button", { name: "Account settings", exact: true })
        .click();
      await page.getByRole("button", { name: "Account", exact: true }).click();
      await expect(
        page.getByRole("progressbar", { name: "DM upload storage" }),
      ).toHaveAttribute("value", "900");
      await page
        .locator(".dm-storage-meter")
        .getByRole("button", { name: "Purge old uploads" })
        .click();
      await page
        .getByRole("combobox", { name: "Older than" })
        .selectOption("0");
      await page.waitForTimeout(1100);
      await page.getByRole("button", { name: "Review uploads" }).click();
      await page.getByRole("button", { name: "Purge these uploads" }).click();
      await expect(
        page.getByRole("dialog", { name: "Purge old DM uploads" }),
      ).toContainText("Message text was kept");
      await page
        .getByRole("dialog", { name: "Purge old DM uploads" })
        .getByRole("button", { name: "Close", exact: true })
        .click();
      await expect(
        page.getByRole("progressbar", { name: "DM upload storage" }),
      ).toHaveAttribute("value", "0");
      await page.getByRole("button", { name: "Close", exact: true }).click();
      const restoredPolicy = await api(
        "/instance/configuration",
        undefined,
        owner.token,
      );
      restoredPolicy.settings.limits.dm.image_max_bytes = 2 * 1024 * 1024;
      restoredPolicy.settings.limits.dm.user_storage_bytes = 100 * 1024 * 1024;
      await api(
        "/instance/configuration",
        {
          revision: restoredPolicy.revision,
          settings: restoredPolicy.settings,
        },
        owner.token,
        "PUT",
      );
      console.log("PASS quota banner, Account meter and own-upload purge UI");
    }
    await page.screenshot({ path: `test-results/dm-secure-${label}.png` });
    assert.deepEqual(errors, []);
    console.log(
      `PASS ${label}: MLS two-client encrypted text/images, reload, unread rail, profiles, plaintext rejection, drop, cached image, CSV/HTML exports, runtime DM policy`,
    );
  } catch (e) {
    console.error(
      "DM failure notices",
      await page.locator(".error,.dm-info,.pending-message").allTextContents(),
      await peer.locator(".error,.dm-info,.pending-message").allTextContents(),
    );
    throw e;
  } finally {
    for (const context of extras) await context.close();
    await peerContext.close();
  }
}
