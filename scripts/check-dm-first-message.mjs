import { _electron as electron, expect as baseExpect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fillSignin } from "./signin-fields.mjs";

assert.equal(process.env.CI, "true");
assert(["win32", "linux"].includes(process.platform));
const expect = baseExpect.configure({ timeout: 30_000 });
const origin = "http://127.0.0.1:18080";
const password = "isolated DM test password";
const results = path.resolve("test-results/dm-first-message");
await fs.mkdir(results, { recursive: true });
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "haunt-dm-ci-"));
const clients = [];
const checks = [];
const requests = [];
const diagnostics = [];
const accounts = new Map();
let keyring;
const report = {
  platform: process.platform,
  revision: process.env.GITHUB_SHA,
  passed: false,
  checks,
  requests,
  diagnostics,
};
const save = () =>
  fs.writeFile(path.join(results, "report.json"), JSON.stringify(report, null, 2));

async function api(route, token, body, method = body ? "POST" : "GET") {
  const response = await fetch(origin + "/api/v1" + route, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  assert(response.ok, `${method} ${route}: ${response.status} ${response.ok ? "" : await response.text()}`);
  return response.status === 204 ? undefined : response.json();
}

async function launch(username, suffix = username) {
  const app = await electron.launch({
    executablePath: path.resolve(process.platform === "win32" ? "release/builder/win-unpacked/haunt.exe" : "release/builder/linux-unpacked/haunt"),
    args: [`--user-data-dir=${path.join(scratch, suffix)}`, ...(process.platform === "linux" ? ["--no-sandbox", "--password-store=gnome-libsecret"] : [])],
    timeout: 60_000,
  });
  const entry = { username, app, page: undefined };
  clients.push(entry);
  app.process().stderr.on("data", (data) => {
    diagnostics.push({ client: suffix, kind: "stderr", text: String(data).slice(0, 4000) });
  });
  const page = await app.firstWindow();
  entry.page = page;
  page.setDefaultTimeout(30_000);
  page.on("pageerror", (error) => diagnostics.push({ client: suffix, kind: "pageerror", text: error.message }));
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.push({ client: suffix, kind: "console", text: message.text() });
  });
  page.on("requestfailed", (request) => diagnostics.push({ client: suffix, kind: "requestfailed", path: new URL(request.url()).pathname, error: request.failure() }));
  page.on("response", async (response) => {
    const url = new URL(response.url());
    if (!url.pathname.startsWith("/api/v1/")) return;
    const row = { client: suffix, method: response.request().method(), path: url.pathname, status: response.status() };
    requests.push(row);
    if (/\/encryption(?:\/events)?$|\/dm-devices(?:\/[^/]+\/packages)?$/.test(url.pathname)) {
      try {
        const value = await response.json();
        row.encryption = {
          error: value.error,
          revision: value.revision,
          devices: value.devices?.map((device) => typeof device === "string" ? device : { id: device.id, user: device.user_id, revoked: device.revoked }),
          packages: value.packages?.map((item) => ({ id: item.id, device: item.device_id })),
          events: value.events?.map((event) => ({ revision: event.revision, actor: event.actor, devices: event.devices })),
        };
      } catch {}
    }
  });
  await expect(page.locator(".app-titlebar")).toBeVisible({ timeout: 60_000 });
  await page.evaluate(() => window.hauntDesktop.updates.healthy());
  await page.getByRole("button", { name: "Add server", exact: true }).click();
  await fillSignin(page, origin, username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".connection")).toHaveText("Connected");
  return entry;
}

async function open(client, username) {
  const page = client.page;
  await expect(page.getByRole("button", { name: /^Direct messages and notifications/ })).toBeVisible();
  const dismissMembers = page.getByRole("button", { name: "Dismiss member list", exact: true });
  if (await dismissMembers.isVisible()) await dismissMembers.click();
  await page.getByRole("button", { name: /^Direct messages and notifications/ }).click();
  await page.getByRole("button", { name: "New direct message", exact: true }).click();
  await page.getByLabel("Find people").fill(username);
  await page.locator(".people-list input[type=checkbox]").check();
  await page.getByRole("button", { name: "Start conversation", exact: true }).click();
  await expect(page.locator(".dm-workspace")).toBeVisible();
}

async function show(client, body) {
  const message = client.page.locator(".message").filter({ has: client.page.locator(".message-body", { hasText: body }) });
  await expect(message).toHaveCount(1);
  await expect(message.locator(".message-body")).toBeVisible();
}

async function send(client, body) {
  await client.page.getByRole("textbox", { name: "Message", exact: true }).fill(body);
  await client.page.getByRole("button", { name: "Send message", exact: true }).click();
  await show(client, body);
  await expect(client.page.locator(".pending-message")).toHaveCount(0);
}

async function exchange(a, b, label, simultaneous = false) {
  if (simultaneous) {
    await Promise.all([open(a, b.username), open(b, a.username)]);
    await Promise.all([send(a, label + " first"), send(b, label + " reply")]);
  } else {
    await open(a, b.username);
    await send(a, label + " first");
    await open(b, a.username);
    await show(b, label + " first");
    await send(b, label + " reply");
  }
  await show(a, label + " reply");
  await show(b, label + " first");
  const account = accounts.get(a.username);
  const conversation = await api("/dms", account.token, { members: [accounts.get(b.username).user.id] });
  const history = await api(`/conversations/${conversation.id}/messages`, account.token);
  assert(history.messages.length >= 2);
  for (const message of history.messages) {
    assert(message.body.startsWith("!haunt-mls-v1!"));
    assert(!message.body.includes(label));
  }
  checks.push({ name: label, passed: true, conversation: conversation.id });
  console.log("PASS", label);
  await save();
}

async function captureFailure(label, error) {
  checks.push({ name: label, passed: false, error: error.stack });
  for (const client of clients.filter((entry) => !entry.closed && entry.page)) {
    const text = await client.page.locator(".error,.dm-info,.pending-message").allTextContents().catch(() => []);
    diagnostics.push({ client: client.username, case: label, kind: "visible-errors", text });
    console.error(label, client.username, JSON.stringify(text));
    await client.page.screenshot({ path: path.join(results, `${checks.length}-${client.username}.png`) }).catch(() => {});
  }
  await save();
}

async function attempt(label, work) {
  try {
    await work();
  } catch (error) {
    await captureFailure(label, error);
  }
}

async function scenario(label, work) {
  const first = clients.length;
  try {
    await attempt(label, work);
  } finally {
    for (const client of clients.slice(first).filter((entry) => !entry.closed)) {
      await client.app.close().catch(() => {});
      client.closed = true;
    }
  }
}

async function deviceID(client) {
  return client.page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("haunt-dm-crypto-v1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction("accounts").objectStore("accounts").getAll();
        request.onsuccess = () => resolve(request.result[0]?.device);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  });
}

function expirePackages(devices) {
  for (const id of devices) assert.match(id, /^[0-9a-f-]{36}$/);
  const sql = `UPDATE chatxo.dm_key_packages SET created_at=now()-interval '29 days' WHERE used_by IS NULL AND device_id IN (${devices.map((id) => `'${id}'`).join(",")})`;
  const command = process.platform === "win32" ? "wsl.exe" : "psql";
  const args = process.platform === "win32"
    ? ["--distribution", "Ubuntu-24.04", "--exec", "runuser", "-u", "postgres", "--", "psql", "-d", "haunt_dm_ci"]
    : ["postgres://haunt_dm_ci:isolated-dm-fixture@127.0.0.1:55432/haunt_dm_ci?sslmode=disable"];
  const output = execFileSync(command, [...args, "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8" });
  assert.match(output, /UPDATE [1-9][0-9]*/);
  console.log("Expired older device packages in isolated fixture", output.trim());
}

try {
  if (process.platform === "linux") {
    keyring = spawn("gnome-keyring-daemon", ["--foreground", "--unlock", "--components=secrets"], { stdio: ["pipe", "ignore", "inherit"] });
    keyring.stdin.end("\n");
    await expect.poll(() => execFileSync("dbus-send", ["--session", "--print-reply", "--dest=org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus.NameHasOwner", "string:org.freedesktop.secrets"], { encoding: "utf8" }).includes("boolean true")).toBe(true);
  }
  await expect.poll(async () => {
    try { return (await fetch(origin + "/readyz", { signal: AbortSignal.timeout(2000) })).status; }
    catch { return 0; }
  }, { timeout: 60_000 }).toBe(200);
  const owner = await api("/auth/login", undefined, { username: "owner", password, device_name: "dm-ci" });
  accounts.set("owner", owner);
  await api("/channels", owner.token, { name: "general", kind: "text" });
  const invite = await api("/invites", owner.token, { uses: 10, expires_in_hours: 1 });
  for (const username of ["alice", "bob", "carol", "dave", "eve", "frank", "gina", "hank", "ivy", "jules"]) {
    const account = await api("/auth/register", undefined, { username, password, device_name: "dm-ci", invitation: invite.token });
    accounts.set(username, account);
  }
  await scenario("fresh first DM", async () => {
    const alice = await launch("alice"), bob = await launch("bob");
    await exchange(alice, bob, "fresh first DM");
    await attempt("reply after reload", async () => {
      await Promise.all([alice.page.reload(), bob.page.reload()]);
      await exchange(bob, alice, "reply after reload");
    });
  });
  await scenario("opposite initiator", async () => {
    const carol = await launch("carol"), dave = await launch("dave");
    await exchange(dave, carol, "opposite initiator");
  });
  await scenario("simultaneous first DM", async () => {
    const gina = await launch("gina"), hank = await launch("hank");
    await exchange(gina, hank, "simultaneous first DM", true);
  });
  await scenario("owner comparison", async () => {
    const starter = await launch("owner"), eve = await launch("eve"), frank = await launch("frank");
    await attempt("owner starts first DM", () => exchange(starter, eve, "owner starts first DM"));
    await attempt("member starts first DM to owner", () => exchange(frank, starter, "member starts first DM to owner"));
    await attempt("first DM after replying elsewhere", () => exchange(eve, frank, "first DM after replying elsewhere"));
    await eve.app.close(); eve.closed = true;
    await frank.app.close(); frank.closed = true;
    await attempt("older device first-contact setup", async () => {
      const oldIvy = await launch("ivy", "ivy-old"), oldJules = await launch("jules", "jules-old");
      await exchange(starter, oldIvy, "owner to ivy before device change");
      await exchange(starter, oldJules, "owner to jules before device change");
      const oldDevices = await Promise.all([deviceID(oldIvy), deviceID(oldJules)]);
      await oldIvy.app.close(); oldIvy.closed = true;
      await oldJules.app.close(); oldJules.closed = true;
      const ivy = await launch("ivy", "ivy-current"), jules = await launch("jules", "jules-current");
      await exchange(starter, ivy, "owner to current ivy device");
      await exchange(starter, jules, "owner to current jules device");
      expirePackages(oldDevices);
      await attempt("first DM with expired older devices", () => exchange(ivy, jules, "first DM with expired older devices"));
      await attempt("reverse first DM with expired older devices", () => exchange(jules, ivy, "reverse first DM with expired older devices"));
      await attempt("ivy replies to owner after failed first contact", () => exchange(starter, ivy, "ivy replies to owner after failed first contact"));
      await attempt("jules replies to owner after failed first contact", () => exchange(starter, jules, "jules replies to owner after failed first contact"));
    });
  });
  report.passed = checks.length >= 15 && checks.every((check) => check.passed);
  assert(report.passed, "At least one first-DM case failed; see report.json");
} catch (error) {
  report.error = error.stack;
  for (const client of clients.filter((entry) => !entry.closed && entry.page)) {
    diagnostics.push({ client: client.username, kind: "visible-errors", text: await client.page.locator(".error,.dm-info,.pending-message").allTextContents().catch(() => []) });
    await client.page.screenshot({ path: path.join(results, client.username + ".png") }).catch(() => {});
  }
  console.error("DM diagnostics", JSON.stringify(diagnostics.filter((item) => item.kind === "visible-errors")));
  throw error;
} finally {
  await save();
  console.log("DM first-message report", JSON.stringify(report));
  for (const client of clients.filter((entry) => !entry.closed)) await client.app.close().catch(() => {});
  keyring?.kill();
  await fs.rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
