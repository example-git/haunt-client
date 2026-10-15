import { fillSignin } from "./signin-fields.mjs";
import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

export async function checkImageCache(page, fixtures, username = "alice") {
  const origin = fixtures.rtc.url;
  const loginResponse = await fetch(origin + "/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username,
      password: fixtures.password,
      device_name: "Image cache fixture",
    }),
  });
  assert.equal(loginResponse.status, 200);
  const login = await loginResponse.json();
  const headers = { Authorization: `Bearer ${login.token}` };
  const png = await fs.readFile(new URL("../static/icon.png", import.meta.url));
  const upload = await fetch(origin + "/api/v1/me/avatar", {
    method: "PUT",
    headers,
    body: png,
  });
  assert.equal(upload.status, 200);
  const version = (await upload.json()).version;
  await page.addInitScript(() => {
    window.cacheSockets = [];
    const Socket = window.WebSocket;
    window.WebSocket = class extends Socket {
      constructor(...args) {
        super(...args);
        window.cacheSockets.push(this);
      }
    };
    const fetch = window.fetch.bind(window);
    window.imageRequests = [];
    window.failAvatar = 1;
    window.fetch = async (input, options) => {
      const url = typeof input === "string" ? input : input.url;
      const method = options?.method ?? input.method ?? "GET";
      const image =
        /\/api\/v1\/(users\/[^/]+\/avatar|attachments\/|conversations\/.*\/embeds)/.test(
          url,
        );
      if (image && method === "GET") {
        window.imageRequests.push(url);
        if (
          sessionStorage.blockImageDownloads === "yes" ||
          (/\/avatar$/.test(url) && window.failAvatar-- > 0)
        )
          return new Response("temporarily unavailable", { status: 503 });
      }
      return fetch(input, options);
    };
  });
  await page.reload();
  await page.getByRole("button", { name: "Add server", exact: true }).click();
  await fillSignin(page, origin, username);
  await page.getByLabel("Password", { exact: true }).fill(fixtures.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".connection")).toHaveText("Connected");
  const visibleImage = async (selector) => {
    await expect(page.locator(selector)).toBeVisible({ timeout: 12000 });
    await expect
      .poll(() =>
        page
          .locator(selector)
          .evaluate((img) => img.complete && img.naturalWidth > 0),
      )
      .toBe(true);
  };
  await visibleImage(".profile .avatar img");
  assert(
    (await page.evaluate(
      () =>
        window.imageRequests.filter((url) => url.endsWith("/avatar")).length,
    )) >= 2,
    "A failed startup download must retry without a profile edit",
  );
  const me = await (await fetch(origin + "/api/v1/me", { headers })).json();
  assert.equal(
    me.user.avatar_version,
    version,
    "Recovery must not require changing the server avatar",
  );
  const pictureBeforeReconnect = await page
    .locator(".profile .avatar img")
    .getAttribute("src");
  const sockets = await page.evaluate(() => {
    const count = window.cacheSockets.length;
    window.cacheSockets.forEach((socket) => socket.close());
    return count;
  });
  await expect
    .poll(() => page.evaluate(() => window.cacheSockets.length))
    .toBeGreaterThan(sockets);
  await expect(page.locator(".connection")).toHaveText("Connected");
  await expect(page.locator(".profile .avatar img")).toHaveAttribute(
    "src",
    pictureBeforeReconnect,
  );

  await page
    .getByLabel("Message", { exact: true })
    .fill("Cached rich image https://preview.example.com/cache-" + username);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const embedSelector = `.message:has(a[href="https://preview.example.com/cache-${username}"]) .embed-card img`;
  await visibleImage(embedSelector);
  await page
    .locator(".composer input[type=file]")
    .setInputFiles({ name: "cached.png", mimeType: "image/png", buffer: png });
  await expect(page.locator(".attachment-chips")).toContainText("cached.png");
  await page
    .getByLabel("Message", { exact: true })
    .fill("Cached attachment " + username);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const attachmentSelector = `.message:has-text("Cached attachment ${username}") .attachment-image`;
  await visibleImage(attachmentSelector);
  await page.evaluate(() => {
    sessionStorage.blockImageDownloads = "yes";
  });
  await page.reload();
  await expect(page.locator(".connection")).toHaveText("Connected");
  await visibleImage(".profile .avatar img");
  await visibleImage(embedSelector);
  await visibleImage(attachmentSelector);
  assert.deepEqual(
    await page.evaluate(() => window.imageRequests),
    [],
    "Reopened client must load saved pictures/preview metadata locally",
  );

  await page.evaluate(() => {
    delete sessionStorage.blockImageDownloads;
  });
  const changed = await fetch(origin + "/api/v1/me/avatar", {
    method: "PUT",
    headers,
    body: png,
  });
  assert.equal(changed.status, 200);
  await expect
    .poll(() => page.evaluate(() => window.imageRequests.length))
    .toBeGreaterThan(0);
  await visibleImage(".profile .avatar img");
  assert.notEqual((await changed.json()).version, version);
  await fetch(origin + "/api/v1/me/avatar", { method: "DELETE", headers });
  await expect(page.locator(".profile .avatar img")).toHaveCount(0);
  await fetch(origin + "/api/v1/auth/logout", { method: "POST", headers });
  console.log(
    "PASS avatar startup retry, persistent image/metadata cache, reload without downloads, version invalidation and avatar removal",
  );
}
