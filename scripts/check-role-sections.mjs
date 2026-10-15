import { expect } from "@playwright/test";
import assert from "node:assert/strict";
export async function checkRoleSections(
  browser,
  page,
  fixtures,
  label = "browser",
) {
  const server = fixtures.rtc;
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(15000);
  let token, observerContext;
  const created = new Set();
  const api = async (method, path, body) => {
    const response = await fetch(server.url + "/api/v1" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    assert(response.ok, `${method} ${path}: ${response.status}`);
    return response.status === 204 ? undefined : response.json();
  };
  const login = async (target, user) => {
    await target
      .getByRole("button", { name: "Add server", exact: true })
      .click();
    await target.getByLabel("Server address").fill(server.url);
    await target.getByLabel("Username", { exact: true }).fill(user);
    await target
      .getByLabel("Password", { exact: true })
      .fill(fixtures.password);
    await target.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(target.locator(".connection")).toHaveText("Connected");
  };
  const settings = async () => {
    await page
      .getByRole("button", { name: "Server settings", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Roles & permissions", exact: true })
      .click();
  };
  const flag = () =>
    page.getByLabel("Display members separately", { exact: true });
  const section = (target, id) =>
    target.locator(`.member-section[data-section-id="${id}"]`);
  const save = async () => {
    await page.getByRole("button", { name: "Save role", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Role saved.");
  };
  try {
    token = (
      await api("POST", "/auth/login", {
        username: "owner",
        password: fixtures.password,
        device_name: "role-sections-test",
      })
    ).token;
    await login(page, "owner");
    observerContext = await browser.newContext({
      viewport: { width: 1400, height: 960 },
    });
    const alice = await observerContext.newPage();
    alice.on("pageerror", (error) => errors.push(error.message));
    await alice.goto("http://127.0.0.1:5173");
    await login(alice, "alice");
    const { users } = await api("GET", "/users");
    const aliceID = users.find((u) => u.username === "alice").id,
      bobID = users.find((u) => u.username === "bob").id;
    await settings();
    await expect(flag()).not.toBeChecked();
    await page.getByLabel("Role name", { exact: true }).fill("Hosts");
    await page.getByRole("spinbutton", { name: /^Role rank/ }).fill("10");
    await page
      .getByRole("button", { name: "Create role", exact: true })
      .click();
    await expect(page.getByRole("status")).toHaveText("Role saved.");
    const lower = (await api("GET", "/roles")).roles.find(
      (r) => r.name === "Hosts",
    );
    created.add(lower.id);
    assert.equal(lower.display_separately, false);
    for (const id of [aliceID, bobID])
      await api("PUT", `/members/${id}/roles`, { role_ids: [lower.id] });
    await expect(
      section(alice, "online").locator(".member-row strong"),
    ).toHaveText(["alice", "owner"]);
    await flag().check();
    await save();
    await expect(
      section(alice, `role:${lower.id}`).locator(".member-row strong"),
    ).toHaveText(["alice"]);
    await expect(
      section(alice, "offline").locator(".member-row strong"),
    ).toHaveText(["bob"]);
    await page.reload();
    await expect(page.locator(".connection")).toHaveText("Connected");
    await settings();
    await page.getByLabel("Role", { exact: true }).selectOption(lower.id);
    await expect(flag()).toBeChecked();
    const upper = await api("POST", "/roles", {
      name: "Organizers",
      position: 20,
      permissions: 0,
      display_separately: true,
    });
    created.add(upper.id);
    await api("PUT", `/members/${aliceID}/roles`, {
      role_ids: [lower.id, upper.id],
    });
    await expect(
      section(alice, `role:${upper.id}`).locator(".member-row strong"),
    ).toHaveText(["alice"]);
    await expect(section(alice, `role:${lower.id}`)).toHaveCount(0);
    await api("PUT", `/roles/${upper.id}`, {
      name: upper.name,
      permissions: 0,
      display_separately: false,
    });
    await expect(
      section(alice, `role:${lower.id}`).locator(".member-row strong"),
    ).toHaveText(["alice"]);
    await page.getByLabel("Role name", { exact: true }).fill("Room hosts");
    await save();
    await expect(
      section(alice, `role:${lower.id}`).getByRole("heading"),
    ).toHaveText("Room hosts 1");
    await flag().uncheck();
    await save();
    await expect(section(alice, `role:${lower.id}`)).toHaveCount(0);
    await expect(
      section(alice, "online").locator(".member-row strong"),
    ).toHaveText(["alice", "owner"]);
    await flag().check();
    await save();
    await expect(section(alice, `role:${lower.id}`)).toBeVisible();
    await api("DELETE", `/roles/${lower.id}`);
    created.delete(lower.id);
    await expect(section(alice, `role:${lower.id}`)).toHaveCount(0);
    await api("PUT", `/roles/${upper.id}`, {
      name: upper.name,
      permissions: 0,
      display_separately: true,
    });
    await expect(section(alice, `role:${upper.id}`)).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(
      section(page, `role:${upper.id}`).locator(".member-row strong"),
    ).toHaveText(["alice"]);
    await observerContext.close();
    observerContext = undefined;
    await expect(
      section(page, "offline").locator(".member-row strong"),
    ).toHaveText(["alice", "bob"]);
    await expect(section(page, `role:${upper.id}`)).toHaveCount(0);
    await page.screenshot({ path: `test-results/role-sections-${label}.png` });
    assert.deepEqual(errors, []);
    console.log(
      `PASS ${label}: per-role opt-in, saved checkbox, live grouping on a regular member's client, highest enabled role, offline placement, rename, disable, deletion and disconnect`,
    );
  } finally {
    await observerContext?.close();
    for (const id of created) await api("DELETE", `/roles/${id}`);
    if (token) await api("POST", "/auth/logout");
  }
}
