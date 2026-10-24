import { fillSignin } from "./signin-fields.mjs";
import fs from "node:fs/promises";
import { expect as baseExpect } from "@playwright/test";
const expect = baseExpect.configure({ timeout: 20_000 });
import assert from "node:assert/strict";

// Exercise the renderer/portal lifecycle with a small desktop bridge double.
// This is a headless browser check, not an Electron/native-window test.
export async function checkCallPopout(browser, fixtures) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 850 },
    permissions: ["camera", "microphone"],
  });
  const errors = [];
  const server = fixtures.rtc;
  try {
    const alice = await context.newPage();
    // Separate browser storage keeps the two fixture accounts independent.
    const other = await browser.newContext({ permissions: ["microphone"] });
    try {
      const bob = await other.newPage();
      for (const [page, user] of [
        [alice, "alice"],
        [bob, "bob"],
      ]) {
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto("http://127.0.0.1:5173");
        if (process.env.HAUNT_CLIENT_BUILD === "dist-standalone")
          await expect(
            page.getByRole("dialog", { name: "Connect to a server" }),
          ).toBeVisible();
        else
          await page
            .getByRole("button", { name: "Add server", exact: true })
            .click();
        await fillSignin(page, server.url, user);
        await page
          .getByLabel("Password", { exact: true })
          .fill(fixtures.password);
        await page
          .getByRole("button", { name: "Sign in", exact: true })
          .click();
        await expect(page.locator(".connection")).toHaveText("Connected");
      }
      await alice.evaluate(() => {
        window.hauntDesktop = {
          platform: "darwin",
          appearance: {
            set: async ({ mode }) => ({
              effect: mode,
              supported: true,
              restart: false,
            }),
          },
          onCallWindowClosed: (callback) => {
            window.testCallWindowClosed = callback;
            return () => {
              delete window.testCallWindowClosed;
            };
          },
          windowState: async (target) => ({
            target,
            maximized: false,
            fullscreen: false,
          }),
          onWindowState: () => () => {},
          windowControl: async () => {},
          setBadge: async () => {},
          notificationAvailable: async () => false,
          showNotification: async () => {},
        };
      });
      for (const page of [alice, bob])
        await page
          .locator(`[data-channel-id="${server.voice}"] button.channel`)
          .click();
      await expect(alice.locator(".call-tile"))
        .toHaveCount(2, { timeout: 20000 })
        .catch(async (error) => {
          console.error(
            "Call join diagnostic",
            await alice
              .locator(".call-panel, .error, [role=alert]")
              .allTextContents(),
            await bob
              .locator(".call-panel, .error, [role=alert]")
              .allTextContents(),
          );
          throw error;
        });
      await expect(alice.locator(".call-panel audio")).toHaveCount(1);
      await expect(alice.locator(".call-panel audio")).toHaveJSProperty(
        "paused",
        false,
      );
      console.log("Call popout: two participants and remote audio are ready");
      const joined = await alice
        .locator(".call-dock time")
        .getAttribute("datetime");
      await alice.evaluate(() => {
        window.testCallAudio = document.querySelector(".call-panel audio");
        window.testCallTrack =
          window.testCallAudio.srcObject.getAudioTracks()[0].id;
      });
      let admissions = 0;
      alice.on("request", (request) => {
        if (
          request.method() === "POST" &&
          request.url().endsWith("/admissions")
        )
          admissions++;
      });
      const continuity = async () => {
        assert(
          await alice.evaluate(() => {
            const audio = document.querySelector(".call-panel audio");
            return (
              audio === window.testCallAudio &&
              !audio.paused &&
              audio.srcObject.getAudioTracks()[0].id === window.testCallTrack
            );
          }),
          "Hiding the PiP must keep its audio element and track playing",
        );
        assert.equal(
          await alice.locator(".call-dock time").getAttribute("datetime"),
          joined,
        );
        assert.equal(admissions, 0);
      };
      const opened = alice.waitForEvent("popup");
      await alice
        .getByRole("button", { name: "Pop out call", exact: true })
        .click();
      const popup = await opened;
      popup.on("pageerror", (error) => errors.push(error.message));
      await expect(popup.locator(".call-tile")).toHaveCount(2);
      await expect(alice.locator(".call-detached-notice")).toBeVisible();
      await alice
        .locator("button.channel")
        .filter({ hasText: "general" })
        .click();
      await expect(alice.locator(".call-panel.mini")).toBeHidden();
      await expect(alice.locator(".call-dock")).toBeVisible();
      await continuity();
      const chat = popup.getByRole("region", {
        name: "Voice channel chat",
        exact: true,
      });
      await expect(chat).toBeVisible();
      // Exercise actual theme controls while the portal remains in its second document.
      await alice
        .getByRole("button", { name: "Account settings", exact: true })
        .click();
      await alice
        .getByRole("button", { name: "Appearance", exact: true })
        .click();
      const background = (page, selector) =>
        page.locator(selector).evaluate((el) => {
          const style = getComputedStyle(el);
          return [style.backgroundColor, style.backgroundImage];
        });
      for (const theme of ["Paper", "Ultraviolet", "wumpoff"]) {
        await alice.getByRole("button", { name: theme, exact: true }).click();
        await expect
          .poll(() => background(popup, ".voice-chat"))
          .toEqual(await background(alice, ".workspace > .conversation-view"));
      }
      await expect(popup.locator(".voice-chat")).toHaveCSS(
        "background-color",
        "rgb(32, 32, 36)",
      );
      await alice
        .getByLabel("Text selection background hex", { exact: true })
        .fill("#123abc");
      await alice
        .getByLabel("Selected text hex", { exact: true })
        .fill("#fedcba");
      await expect
        .poll(() =>
          popup.locator(".voice-chat > header").evaluate((el) => {
            const style = getComputedStyle(el, "::selection");
            return [style.backgroundColor, style.color];
          }),
        )
        .toEqual(["rgb(18, 58, 188)", "rgb(254, 220, 186)"]);
      for (const [effect, minimum, railOpacity] of [
        ["material", 30, 47.5],
        ["transparent", 50, 67.5],
      ]) {
        await alice
          .getByLabel("Window effect", { exact: true })
          .selectOption(effect);
        const slider = alice.getByLabel("Sidebar opacity", { exact: true });
        await expect(slider).toHaveAttribute("min", String(minimum));
        await slider.focus();
        await slider.press("Home");
        const alpha = (selector) =>
          alice.locator(selector).evaluate((el) => {
            const canvas = document.createElement("canvas"),
              ctx = canvas.getContext("2d");
            canvas.width = canvas.height = 1;
            ctx.fillStyle = getComputedStyle(el).backgroundColor;
            ctx.fillRect(0, 0, 1, 1);
            return ctx.getImageData(0, 0, 1, 1).data[3];
          });
        await expect
          .poll(() => alpha(".sidebar"))
          .toBe(Math.round((255 * minimum) / 100));
        await expect
          .poll(() => alpha(".server-rail"))
          .toBe(Math.round((255 * railOpacity) / 100));
        await expect(popup.locator(".voice-chat")).toHaveCSS(
          "background-color",
          "rgb(32, 32, 36)",
        );
      }
      console.log("Call popout: themes, selection and panel opacity passed");
      await alice
        .getByLabel("Window effect", { exact: true })
        .selectOption("solid");
      await alice.getByRole("button", { name: "Close", exact: true }).click();
      await chat
        .getByRole("textbox", { name: "Message", exact: true })
        .fill("Pinned popout message");
      await chat
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await expect(bob.locator(".voice-chat .message-body")).toHaveText([
        "Pinned popout message",
      ]);
      await bob
        .getByRole("textbox", { name: "Message", exact: true })
        .fill("Reply from voice channel");
      await bob
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await expect(chat.locator(".message-body")).toHaveText([
        "Pinned popout message",
        "Reply from voice channel",
      ]);
      await expect(
        alice.locator(".workspace .message-body").filter({
          hasText: /Pinned popout message|Reply from voice channel/,
        }),
      ).toHaveCount(0);
      // Popup-local document listeners must handle picker dismissal and file drops.
      await chat
        .getByRole("button", { name: "Choose emoji", exact: true })
        .click();
      await expect(
        popup.getByLabel("Search emojis", { exact: true }),
      ).toBeVisible();
      await popup.locator(".native-popout header").click();
      await expect(
        popup.getByLabel("Search emojis", { exact: true }),
      ).toHaveCount(0);
      const png = [
        ...(await fs.readFile(new URL("../static/icon.png", import.meta.url))),
      ];
      await chat.locator(".messages").evaluate((element, bytes) => {
        const data = new DataTransfer();
        data.items.add(
          new File([new Uint8Array(bytes)], "popout.png", {
            type: "image/png",
          }),
        );
        element.dispatchEvent(
          new DragEvent("drop", {
            dataTransfer: data,
            bubbles: true,
            cancelable: true,
          }),
        );
      }, png);
      await expect(chat.locator(".attachment-chips button")).toHaveCount(1);
      await chat
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await expect(bob.locator(".voice-chat .attachment-image")).toBeVisible();
      await expect(chat.locator(".attachment-image")).toBeVisible();
      await continuity();
      const stageBox = await popup.locator(".native-popout").boundingBox();
      const chatBox = await chat.boundingBox();
      assert(
        stageBox.x + stageBox.width <= chatBox.x + 1,
        "Chat must be pinned beside the stage",
      );
      assert(chatBox.height > 300 && stageBox.width > 300);
      await popup.setViewportSize({ width: 600, height: 700 });
      await expect(
        chat.getByRole("textbox", { name: "Message", exact: true }),
      ).toBeInViewport();
      assert(
        await popup.evaluate(
          () => document.documentElement.scrollHeight <= innerHeight + 1,
        ),
        "No window overflow",
      );
      await popup.setViewportSize({ width: 960, height: 640 });
      await popup.screenshot({ path: "test-results/call-popout-chat.png" });
      await popup
        .getByRole("button", {
          name: "Return call to main window",
          exact: true,
        })
        .click()
        .catch((error) => {
          if (!popup.isClosed()) throw error;
        });
      await expect(alice.locator(".call-panel.mini")).toBeVisible();
      await expect(alice.locator(".call-tile")).toHaveCount(2);
      await continuity();
      const reopened = alice.waitForEvent("popup");
      await alice
        .getByRole("button", { name: "Pop out call", exact: true })
        .click();
      const second = await reopened;
      await expect(second.locator(".call-tile")).toHaveCount(2);
      await expect(alice.locator(".call-panel.mini")).toBeHidden();
      await second.close();
      // The Electron host sends this after a native close-button action.
      await alice.evaluate(() => window.testCallWindowClosed());
      await expect(alice.locator(".call-panel.mini")).toBeVisible();
      await continuity();
      await alice
        .locator(".call-dock")
        .getByRole("button", { name: "Leave call", exact: true })
        .click();
      await expect(alice.locator(".call-panel")).toHaveCount(0);
      assert.deepEqual(errors, []);
      console.log(
        "PASS browser popout lifecycle: pinned channel chat send/receive, attachment drop, emoji dismissal, small-window layout; PiP hidden when detached, restored on return/close, call dock visible and audio/track/admission unchanged (desktop bridge double)",
      );
    } catch (error) {
      for (const [label, page] of [
        ["alice", alice],
        ["bob", other.pages()[0]],
      ]) {
        if (!page || page.isClosed()) continue;
        console.error(
          "Call popout failure",
          label,
          await page
            .locator(".call-panel, .call-dock, .error, [role=alert]")
            .allTextContents()
            .catch(() => []),
        );
        await page
          .screenshot({
            path: `test-results/call-popout-failure-${label}.png`,
            timeout: 5000,
          })
          .catch(() => {});
      }
      throw error;
    } finally {
      await other.close();
    }
  } finally {
    await context.close();
  }
}
