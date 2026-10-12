import { expect } from "@playwright/test";
import assert from "node:assert/strict";
export async function checkClientState(page, fixtures, label = "browser") {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const login = async (server) => {
    await page.getByRole("button", { name: "Add server", exact: true }).click();
    await page.getByLabel("Server address").fill(server.url);
    await page.getByLabel("Username", { exact: true }).fill("owner");
    await page.getByLabel("Password", { exact: true }).fill(fixtures.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator(".connection")).toHaveText("Connected");
  };
  await login(fixtures.rtc);
  await expect(
    page.getByRole("complementary", { name: "Member list" }),
  ).toBeVisible();
  const section = (name) =>
    page.locator(".member-section").filter({
      has: page.getByRole("heading", { name: new RegExp(`^${name}`) }),
    });
  await expect(section("Online").locator(".member-row strong")).toHaveText([
    "owner",
  ]);
  await expect(section("Offline").locator(".member-row strong")).toHaveText([
    "alice",
    "bob",
  ]);
  await page
    .getByRole("button", { name: "Hide member list", exact: true })
    .click();
  await login(fixtures.ws);
  await expect(
    page.getByRole("complementary", { name: "Member list" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: `Open ${fixtures.rtc.name}`, exact: true })
    .click();
  await expect(
    page.getByRole("complementary", { name: "Member list" }),
  ).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".connection")).toHaveText("Connected");
  await page
    .getByRole("button", { name: `Open ${fixtures.rtc.name}`, exact: true })
    .click();
  await expect(
    page.getByRole("complementary", { name: "Member list" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Show member list", exact: true })
    .click();
  await page.reload();
  await expect(page.locator(".connection")).toHaveText("Connected");
  await page
    .getByRole("button", { name: `Open ${fixtures.rtc.name}`, exact: true })
    .click();
  await expect(
    page.getByRole("complementary", { name: "Member list" }),
  ).toBeVisible();
  await page.screenshot({ path: `test-results/member-sections-${label}.png` });
  assert.deepEqual(errors, []);
  console.log(
    `PASS ${label}: member list open by default, alphabetical Online/Offline sections, per-server collapse persistence and reload`,
  );
}
export async function checkWebUpdates(browser) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() =>
      sessionStorage.setItem(
        "test-load-count",
        String(Number(sessionStorage.getItem("test-load-count") ?? 0) + 1),
      ),
    );
    let requests = 0,
      mode = "fail";
    const newer = "11111111-2222-4333-8444-555555555555";
    await page.route("**/haunt-build.json?**", (route) => {
      requests++;
      return route.fulfill(
        mode === "fail"
          ? { status: 503, body: "unavailable" }
          : mode === "html"
            ? { status: 200, contentType: "text/html", body: "proxy fallback" }
            : {
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({ version: 1, id: newer }),
              },
      );
    });
    await page.addInitScript(() => {
      const now = Date.now;
      Date.now = () => now() + (window.updateClockOffset ?? 0);
    });
    const tick = () =>
      page.evaluate(() => {
        window.updateClockOffset = (window.updateClockOffset ?? 0) + 61000;
        window.dispatchEvent(new Event("focus"));
      });
    await page.goto("http://127.0.0.1:5173");
    await tick();
    await expect.poll(() => requests).toBe(1);
    assert.equal(
      await page.evaluate(() => sessionStorage.getItem("test-load-count")),
      "1",
    );
    mode = "html";
    await tick();
    await expect.poll(() => requests).toBe(2);
    assert.equal(
      await page.evaluate(() => sessionStorage.getItem("test-load-count")),
      "1",
    );
    // Do not interrupt a settings form or call/attachment operation.
    mode = "new";
    await page.getByRole("button", { name: "Add server", exact: true }).click();
    await tick();
    await expect.poll(() => requests).toBe(3);
    assert.equal(
      await page.evaluate(() => sessionStorage.getItem("test-load-count")),
      "1",
    );
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.evaluate(() =>
      document.querySelector(".app").setAttribute("data-update-busy", "true"),
    );
    await tick();
    await expect.poll(() => requests).toBe(4);
    assert.equal(
      await page.evaluate(() => sessionStorage.getItem("test-load-count")),
      "1",
    );
    await page.evaluate(() =>
      document.querySelector(".app").removeAttribute("data-update-busy"),
    );
    await Promise.all([
      page.waitForEvent("framenavigated", {
        predicate: (frame) => frame === page.mainFrame(),
      }),
      tick(),
    ]);
    await expect(
      page.getByRole("button", { name: "Add server", exact: true }),
    ).toBeVisible();
    assert.equal(
      await page.evaluate(() => sessionStorage.getItem("test-load-count")),
      "2",
    );
    assert.equal(requests, 6, "Two identical markers confirm the update");
    await tick();
    await expect.poll(() => requests).toBeGreaterThan(6);
    assert.equal(
      await page.evaluate(() => sessionStorage.getItem("test-load-count")),
      "2",
      "Old HTML after refresh cannot create a loop",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS web update check: ignores network/HTML failures, defers busy operations, confirms twice, refreshes automatically, prevents reload loop",
    );
  } finally {
    await context.close();
  }
}
