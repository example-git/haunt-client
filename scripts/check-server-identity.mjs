import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

export async function checkServerIdentity(page, fixtures, api) {
  const server = fixtures.rtc;
  const open = async () =>
    page
      .getByRole("button", { name: `Open ${server.name}`, exact: true })
      .click();
  await open();
  await expect(page.getByLabel("Search members", { exact: true })).toHaveCount(
    0,
  );
  await page
    .locator(".member-row")
    .filter({ has: page.locator("strong", { hasText: /^alice$/ }) })
    .click();
  await expect(page.locator(".member-profile .account-address")).toHaveText(
    `alice@${new URL(server.url).host}`,
  );
  await page.getByRole("button", { name: "Close", exact: true }).click();

  // Render the search threshold without creating extra accounts or changing service data.
  const rosterURL = `${server.url}/api/v1/users`;
  const roster = async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    while (json.users.length < 20)
      json.users.push({
        ...json.users[1],
        id: crypto.randomUUID(),
        username: `fixture${json.users.length}`,
        display_name: `Fixture member ${json.users.length}`,
        is_owner: false,
      });
    await route.fulfill({ response, json });
  };
  await page.route(rosterURL, roster);
  await page.reload();
  await open();
  await expect(
    page.getByLabel("Search members", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Search members", { exact: true }).fill("fixture19");
  await expect(page.locator(".member-row")).toHaveCount(1);
  await page.unroute(rosterURL, roster);
  await page.reload();
  await open();
  await expect(page.getByLabel("Search members", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.locator(".member-row")).toHaveCount(3);

  const login = await api(server, "", "/auth/login", {
    username: "owner",
    password: fixtures.password,
    device_name: "branding-cache-check",
  });
  const png = await fs.readFile(new URL("../static/icon.png", import.meta.url));
  for (const kind of ["icon", "banner"]) {
    const response = await fetch(`${server.url}/api/v1/instance/${kind}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${login.token}`,
        "Content-Type": "image/png",
      },
      body: png,
    });
    assert.equal(response.status, 200);
  }
  const image = async (selector) => {
    await expect(page.locator(selector)).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator(selector)
          .evaluate((img) => img.complete && img.naturalWidth > 0),
      )
      .toBe(true);
  };
  await image(".server-banner");
  await image(".server-icon.selected img");
  const size = await page.locator(".server-name-label").evaluate((el) => ({
    label: el.getBoundingClientRect().width,
    name: el.querySelector("h2").getBoundingClientRect().width,
    dot: el.querySelector(".connection").getBoundingClientRect().width,
    cover: el.closest(".community-cover").getBoundingClientRect().width,
  }));
  assert(
    Math.abs(size.label - size.name - size.dot - 28) <= 1,
    "Blur hugs the name, dot, gap and padding",
  );
  assert(size.label < size.cover, "Blur does not fill the banner");
  await expect(page.locator(".community-cover .presence.online")).toHaveCount(
    1,
  );
  await page.screenshot({ path: "test-results/server-identity.png" });

  await page.addInitScript((origin) => {
    const original = window.fetch.bind(window);
    window.brandDownloads = [];
    window.fetch = (input, options) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.startsWith(origin) && /\/instance\/(icon|banner)$/.test(url))
        window.brandDownloads.push(url);
      if (sessionStorage.offlineBranding === "yes" && url.startsWith(origin))
        return Promise.resolve(
          new Response("Offline fixture", { status: 503 }),
        );
      return original(input, options);
    };
    window.brandSockets = [];
    const Socket = window.WebSocket;
    window.WebSocket = class extends Socket {
      constructor(...args) {
        super(...args);
        window.brandSockets.push(this);
      }
    };
  }, server.url);
  await page.reload();
  await open();
  await expect(page.locator(".connection")).toHaveText("Connected");
  await image(".server-banner");
  const before = await page.locator(".server-banner").getAttribute("src");
  await page.evaluate(() => {
    sessionStorage.offlineBranding = "yes";
    window.brandSockets.forEach((socket) => socket.close());
  });
  await expect(page.locator(".connection")).not.toHaveText("Connected");
  await expect(page.locator(".server-banner")).toHaveAttribute("src", before);
  await expect(page.locator(".server-name-label h2")).toHaveText(server.name);
  await page.reload();
  await open();
  await expect(page.locator(".connection")).not.toHaveText("Connected");
  await image(".server-banner");
  await image(".server-icon.selected img");
  await expect(page.locator(".server-name-label h2")).toHaveText(server.name);
  assert.deepEqual(
    await page.evaluate(() => window.brandDownloads),
    [],
    "Offline reload restores artwork from disk without requesting images",
  );
  await page.screenshot({ path: "test-results/server-identity-offline.png" });
  await page.evaluate(() => delete sessionStorage.offlineBranding);
  await page.reload();
  await open();
  await expect(page.locator(".connection")).toHaveText("Connected");
  await api(server, login.token, "/auth/logout", undefined, "POST");
  // Restore the last selected service for the existing logout-isolation check.
  await page
    .getByRole("button", { name: `Open ${fixtures.ws.name}`, exact: true })
    .click();
  console.log(
    "PASS qualified profiles, 20-member search threshold, bounded banner label and persistent branding through disconnect/offline reload/recovery",
  );
}
