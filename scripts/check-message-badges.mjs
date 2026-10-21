import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { badgeServerFixture } from "./badge-server-fixture.mjs";
import { fillSignin } from "./signin-fields.mjs";
const run = promisify(execFile);

export async function checkMessageBadges(
  app,
  page,
  native,
  report,
  { withoutArtwork = false } = {},
) {
  await fs.mkdir("test-results", { recursive: true });
  page.setDefaultTimeout(20000);
  const server = await badgeServerFixture();
  const target = `${process.platform}-${process.arch}${withoutArtwork ? "-without-artwork" : ""}`;
  const states = [];
  report.messageBadges = {
    source: report.browserOnly
      ? "HTTP/WebSocket protocol fixture through browser only"
      : "HTTP/WebSocket protocol fixture through packaged client",
    osRelease: os.release(),
    withoutArtwork,
    states,
  };
  const hidden = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].hide(),
    );
  const show = () =>
    app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.show();
      window.focus();
    });
  const check = async (label, count, unread) => {
    await expect(page).toHaveTitle(
      count ? `(${count}) Haunt` : unread ? "• Haunt" : "Haunt",
    );
    const state = { label, count, unread };
    if (process.platform === "darwin") {
      await expect
        .poll(() => app.evaluate(({ app }) => app.dock.getBadge()))
        .toBe(count ? String(count) : unread ? "•" : "");
      state.dock = await app.evaluate(({ app }) => app.dock.getBadge());
      const screenshot = `test-results/message-badge-${target}-${label}.png`;
      await run("screencapture", ["-x", screenshot]);
      state.screenshot = screenshot;
    } else if (process.platform === "linux") {
      await expect
        .poll(
          async () =>
            (await native.records()).filter((r) => r.kind === "badge").at(-1)
              ?.count,
        )
        .toBe(count);
      state.launcher = (await native.records())
        .filter((r) => r.kind === "badge")
        .at(-1);
      assert.equal(state.launcher.visible, count > 0);
      assert.equal(
        state.launcher.application,
        `application://${native.desktop}`,
      );
      if (native.capture) {
        // Allow the dock's short badge transition to reach its painted state.
        await new Promise((resolve) => setTimeout(resolve, 500));
        const screenshot = `test-results/message-badge-${target}-${label}.png`;
        await native.capture(screenshot);
        state.screenshot = screenshot;
      }
    }
    if (process.platform === "win32") {
      const screenshot = `test-results/message-badge-${target}-${label}.png`;
      await native.capture(screenshot);
      state.screenshot = screenshot;
      state.nativeVisibility =
        "Requires inspection of the actual Windows taskbar capture; Windows has no badge readback API.";
    }
    states.push(state);
  };
  try {
    if (withoutArtwork) {
      // Fault-inject only the artwork decoder. Messages, read state, IPC and
      // native dock APIs remain the packaged application's real implementation.
      await page.addInitScript(() => {
        const decode = HTMLImageElement.prototype.decode;
        window.badgeArtworkDecodeFailures = 0;
        HTMLImageElement.prototype.decode = function (...args) {
          if (new URL(this.src).pathname.endsWith("/brand/logo-64.png")) {
            window.badgeArtworkDecodeFailures++;
            return Promise.reject(
              new DOMException(
                "Injected badge artwork decode failure",
                "EncodingError",
              ),
            );
          }
          return decode.apply(this, args);
        };
      });
      await page.reload({ waitUntil: "domcontentloaded" });
    }
    if (report.browserOnly) await page.goto(server.origin);
    await page.getByRole("button", { name: "Add server", exact: true }).click();
    await fillSignin(page, server.origin, "owner");
    await page
      .getByLabel("Password", { exact: true })
      .fill("native fixture password");
    await page.getByLabel("Remember this device", { exact: true }).uncheck();
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator(".connection")).toHaveText("Connected", {
      timeout: 30000,
    });
    const members = page.getByRole("button", {
      name: "Dismiss member list",
      exact: true,
    });
    if (await members.isVisible()) await members.click();
    await page
      .locator(".channel")
      .filter({ has: page.getByText("quiet", { exact: true }) })
      .first()
      .click();
    await hidden();
    await check("empty", 0, false);
    server.send(server.general);
    await check("ordinary-unread", 0, true);
    server.send(server.general, true);
    await check("mention", 1, true);
    server.send(server.dm);
    await check("mention-and-dm", 2, true);
    await show();
    await page
      .locator(".channel")
      .filter({ has: page.getByText("general", { exact: true }) })
      .first()
      .click();
    await expect(
      page
        .locator(".message-body")
        .filter({ hasText: "@owner native badge check" }),
    ).toBeVisible();
    await check("channel-read", 1, true);
    await page
      .getByRole("button", {
        name: "Direct messages and notifications",
        exact: true,
      })
      .click();
    await page
      .locator(".notification-inbox > button")
      .filter({ hasText: "Direct message" })
      .first()
      .click();
    await expect(
      page.locator(".message-body").filter({ hasText: "Incoming message" }),
    ).toBeVisible();
    await check("all-read", 0, false);
    assert(
      server.requests.some(
        (r) => r.method === "PUT" && r.pathname.endsWith("/read"),
      ),
    );
    report.messageBadges.requests = server.requests;
    report.messageBadges.unexpected = server.unexpected;
    assert.deepEqual(server.unexpected, []);
    if (withoutArtwork) {
      const failures = await page.evaluate(
        () => window.badgeArtworkDecodeFailures,
      );
      assert(
        failures > 0,
        "The real badge subscriber exercised the injected decoder failure",
      );
      report.messageBadges.artworkDecodeFailures = failures;
      report.messageBadges.faultInjection =
        "Badge logo decode rejected; native badge implementation unchanged";
    }
    report.messageBadges.passed = true;
  } catch (error) {
    report.messageBadges.error = error.message;
    await page
      .screenshot({ path: `test-results/message-badge-${target}-failure.png` })
      .catch(() => {});
    throw error;
  } finally {
    await fs.writeFile(
      `test-results/message-badges-${target}.json`,
      JSON.stringify(report.messageBadges, null, 2),
    );
    await server.stop();
  }
}
