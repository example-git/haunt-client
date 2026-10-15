import { fillSignin } from "./signin-fields.mjs";
import { expect } from "@playwright/test";
import assert from "node:assert/strict";

export async function checkMediaStatus(browser, fixtures, desktopPage) {
  const servers = desktopPage
    ? [["electron", fixtures.rtc]]
    : [
        ["rtc", fixtures.rtc],
        ["ws", fixtures.ws],
      ];
  for (const [transport, server] of servers) {
    const contexts = await Promise.all([
      browser.newContext({
        permissions: ["camera", "microphone"],
        viewport: { width: 1280, height: 850 },
      }),
      browser.newContext({ viewport: { width: 1280, height: 850 } }),
    ]);
    const [publisher, browserObserver] = await Promise.all(
      contexts.map((c) => c.newPage()),
    );
    const observer = desktopPage ?? browserObserver;
    const errors = [];
    for (const page of [publisher, observer]) {
      page.on("pageerror", (e) => errors.push(e.message));
      page.setDefaultTimeout(15000);
    }
    const login = async (page, username) => {
      if (page !== desktopPage) await page.goto("http://127.0.0.1:5173");
      await page
        .getByRole("button", { name: "Add server", exact: true })
        .click();
      await fillSignin(page, server.url, username);
      await page
        .getByLabel("Password", { exact: true })
        .fill(fixtures.password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.locator(".connection")).toHaveText("Connected");
    };
    const dock = () => publisher.locator(".call-dock");
    const control = (name) =>
      dock().getByRole("button", { name, exact: true }).click();
    try {
      await login(publisher, "alice");
      await login(observer, "owner");
      if (
        await observer
          .getByRole("button", { name: "Show member list", exact: true })
          .count()
      )
        await observer
          .getByRole("button", { name: "Show member list", exact: true })
          .click();
      const name = await publisher.locator(".profile strong").innerText();
      const member = observer
        .locator(".member-row")
        .filter({ has: observer.locator("strong", { hasText: name }) });
      const voice = observer.locator(".voice-member").filter({ hasText: name });
      const camera = voice.getByRole("img", { name: "Camera on", exact: true });
      const screen = voice.getByRole("img", {
        name: "Sharing screen",
        exact: true,
      });
      await publisher
        .locator(`[data-channel-id="${server.voice}"] button.channel`)
        .click();
      await expect(voice).toBeVisible();
      await expect(member.locator("small")).toHaveText("In lounge");
      await expect(voice.locator(".voice-media-icons")).toHaveCount(0);
      // This test checks gateway state and UI; a deterministic video source
      // substitutes the OS picker so no unrelated desktop content is captured.
      await publisher.evaluate(() => {
        navigator.mediaDevices.getDisplayMedia = async () => {
          const canvas = document.createElement("canvas");
          canvas.width = 640;
          canvas.height = 360;
          canvas.getContext("2d").fillRect(0, 0, 640, 360);
          const stream = canvas.captureStream(10);
          window.statusTestScreen = stream.getVideoTracks()[0];
          return stream;
        };
      });
      await control("Turn on camera");
      await expect(camera).toBeVisible();
      await expect(screen).toHaveCount(0);
      await expect(member.locator(".member-media-status")).toHaveText(
        "Camera on · lounge",
      );
      await control("Share screen");
      await expect(camera).toBeVisible();
      await expect(screen).toBeVisible();
      await expect(member.locator(".member-media-status")).toHaveText(
        "Streaming + camera · lounge",
      );
      await expect(observer.locator(".call-panel")).toHaveCount(0);
      await observer.screenshot({
        path: `test-results/media-status-${transport}.png`,
      });
      await control("Mute microphone");
      await expect(screen).toBeVisible();
      await expect(camera).toBeVisible();
      await observer.reload();
      await expect(observer.locator(".connection")).toHaveText("Connected");
      if (
        await observer
          .getByRole("button", { name: "Show member list", exact: true })
          .count()
      )
        await observer
          .getByRole("button", { name: "Show member list", exact: true })
          .click();
      await expect(member.locator(".member-media-status")).toHaveText(
        "Streaming + camera · lounge",
      );
      await control("Turn off camera");
      await expect(camera).toHaveCount(0);
      await expect(screen).toBeVisible();
      await expect(member.locator(".member-media-status")).toHaveText(
        "Streaming · lounge",
      );
      // Simulate the browser's native "Stop sharing" action.
      await publisher.evaluate(() => {
        window.statusTestScreen.stop();
        window.statusTestScreen.dispatchEvent(new Event("ended"));
      });
      await expect(screen).toHaveCount(0);
      await expect(member.locator(".member-media-status")).toHaveCount(0);
      await expect(member.locator("small")).toHaveText("In lounge");
      await control("Turn on camera");
      await expect(camera).toBeVisible();
      await control("Leave call");
      await expect(voice).toHaveCount(0);
      await expect(member.locator(".member-media-status")).toHaveCount(0);
      await expect(member.locator("small")).toHaveText("@alice");
      assert.deepEqual(errors, []);
      console.log(
        `PASS ${transport}: camera/screen/both indicators and member statuses for a non-call observer, mute independence, reconnect snapshot, native share stop and leave cleanup`,
      );
    } finally {
      await Promise.all(contexts.map((c) => c.close()));
    }
  }
}
