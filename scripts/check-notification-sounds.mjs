import { fillSignin } from "./signin-fields.mjs";
import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
export async function checkNotificationSounds(
  page,
  fixtures,
  label = "browser",
) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.setDefaultTimeout(15000);
  await page.addInitScript(() => {
    window.soundTones = [];
    window.soundBuffers = 0;
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...args) {
      window.soundTones.push(Math.round(this.frequency.value));
      return start.apply(this, args);
    };
    const buffer = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      window.soundBuffers++;
      return buffer.apply(this, args);
    };
  });
  await page.reload();
  const api = async (path, body, token = "") => {
    const response = await fetch(fixtures.rtc.url + "/api/v1" + path, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    assert(response.ok, `${path}: ${response.status}`);
    return response.json();
  };
  const alice = await api("/auth/login", {
    username: "alice",
    password: fixtures.password,
    device_name: "notification-sounds-test",
  });
  await page.getByRole("button", { name: "Add server", exact: true }).click();
  await fillSignin(page, fixtures.rtc.url, "owner");
  await page.getByLabel("Password", { exact: true }).fill(fixtures.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".connection")).toHaveText("Connected");
  const settings = async () => {
    await page
      .getByRole("button", { name: /^(Account settings|Client settings)$/ })
      .click();
    await page
      .getByRole("button", { name: "Notification Settings", exact: true })
      .click();
  };
  const close = () =>
    page.getByRole("button", { name: "Close", exact: true }).click();
  await settings();
  await expect(
    page.getByRole("button", { name: "Server & channel rules", exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Notifications", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Messages in the conversation I’m viewing").check();
  await close();
  // Rail context menu provides server defaults without admin permissions.
  await page
    .getByRole("button", { name: `Open ${fixtures.rtc.name}`, exact: true })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Notifications", exact: true })
    .click();
  await page
    .getByLabel(`Notification sound for ${fixtures.rtc.name}`, { exact: true })
    .selectOption("soft");
  await close();
  const send = async (conversation) => {
    await page.waitForTimeout(1100); // Respect the real notification sound throttle.
    await page.evaluate(() => {
      window.soundTones = [];
      window.soundBuffers = 0;
    });
    await api(
      `/conversations/${conversation}/messages`,
      { request_id: randomUUID(), body: `@owner Sound test ${randomUUID()}` },
      alice.token,
    );
  };
  await send(fixtures.rtc.general);
  await expect
    .poll(() => page.evaluate(() => window.soundTones))
    .toEqual([440, 554]);
  // Channel menu overrides the server and offers an inherited fallback.
  await page
    .getByRole("button", { name: "Channel menu for general", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Notifications", exact: true })
    .click();
  await page
    .getByLabel("Notification sound for #general", { exact: true })
    .selectOption("chime");
  await close();
  await send(fixtures.rtc.general);
  await expect
    .poll(() => page.evaluate(() => window.soundTones))
    .toEqual([880, 1175, 1397]);
  // A direct message has its own persistent sound, independent of channel settings.
  await page
    .getByRole("button", { name: "New direct message", exact: true })
    .click();
  await page.getByLabel("Find people").fill("alice");
  await page.locator(".people-list input[type=checkbox]").check();
  await page
    .getByRole("button", { name: "Start conversation", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const conversations = await api("/conversations", undefined, alice.token);
  const dm = conversations.conversations.find((c) => c.kind === "dm");
  assert(dm);
  const dmMenu = async () => {
    await page
      .locator(".dm-rail")
      .getByRole("button", {
        name: `Message alice via ${fixtures.rtc.name}`,
        exact: true,
      })
      .click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "Notification Settings", exact: true })
      .click();
  };
  await dmMenu();
  await page
    .getByLabel("Notification sound for alice", { exact: true })
    .selectOption("none");
  await close();
  await send(dm.id);
  await expect(page.locator(".message-body").last()).toContainText(
    "Sound test",
  );
  assert.deepEqual(await page.evaluate(() => window.soundTones), []);
  // A separate uploaded clip, reused by the dropdown, persists in IndexedDB.
  const wav = Buffer.alloc(44 + 16000);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(16000, 40);
  for (let i = 0; i < 8000; i++)
    wav.writeInt16LE(
      Math.round(Math.sin((i * 2 * Math.PI * 770) / 8000) * 2000),
      44 + i * 2,
    );
  await dmMenu();
  await page
    .getByLabel("Upload notification sound for alice", { exact: true })
    .setInputFiles({ name: "alice.wav", mimeType: "audio/wav", buffer: wav });
  await expect(
    page.getByLabel("Notification sound for alice", { exact: true }),
  ).toHaveValue(/^clip:/);
  await page
    .getByLabel("Upload notification sound for alice", { exact: true })
    .setInputFiles({
      name: "bad.wav",
      mimeType: "audio/wav",
      buffer: Buffer.from("invalid"),
    });
  await expect(page.getByRole("alert")).toContainText("could not be read");
  await close();
  await send(dm.id);
  await expect.poll(() => page.evaluate(() => window.soundBuffers)).toBe(1);
  await page.reload();
  await expect(page.locator(".dm-home")).toBeVisible();
  await dmMenu();
  await expect(
    page.getByLabel("Notification sound for alice", { exact: true }),
  ).toHaveValue(/^clip:/);
  await close();
  await send(dm.id);
  await expect.poll(() => page.evaluate(() => window.soundBuffers)).toBe(1);
  await settings();
  await expect(
    page.getByLabel(`Notification sound for ${fixtures.rtc.name}`, {
      exact: true,
    }),
  ).toHaveValue("soft");
  await expect(
    page.getByLabel("Notification sound for #general", { exact: true }),
  ).toHaveValue("chime");
  await page
    .getByRole("button", { name: "Remove sound alice.wav", exact: true })
    .click();
  await expect(
    page.getByLabel("Notification sound for alice", { exact: true }),
  ).toHaveValue("inherit");
  await page.screenshot({
    path: `test-results/notification-sounds-${label}.png`,
  });
  await close();
  await send(dm.id);
  await expect
    .poll(() => page.evaluate(() => window.soundTones))
    .toEqual([440, 554]);
  assert.deepEqual(errors, []);
  console.log(
    `PASS ${label}: consolidated settings, server/channel/DM menus, actual inherited/overridden/silent/custom playback, file validation, reload persistence, library removal fallback`,
  );
}
