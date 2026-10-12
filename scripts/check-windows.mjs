import { expect } from "@playwright/test";
import assert from "node:assert/strict";

export async function checkWindows(browser, fixtures, page, desktop) {
  const errors = [];
  const closeByButton = async (popup, name) => {
    await popup
      .getByRole("button", { name, exact: true })
      .click()
      .catch((error) => {
        if (!popup.isClosed()) throw error;
      });
    await expect.poll(() => popup.isClosed()).toBe(true);
  };
  page.on("pageerror", (e) => errors.push(e.message));
  await expect(page.locator(".app-titlebar")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Notifications", exact: true }),
  ).toHaveCount(1);
  assert(
    await page
      .locator(".brand-mark")
      .evaluate(
        (el) =>
          el.getBoundingClientRect().top >=
          document.querySelector(".app-titlebar").getBoundingClientRect()
            .bottom,
      ),
  );
  await desktop.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    globalThis.windowCalls = [];
    for (const name of ["minimize", "maximize", "unmaximize"]) {
      const original = win[name].bind(win);
      win[name] = (...args) => {
        globalThis.windowCalls.push(name);
        return original(...args);
      };
    }
  });
  await page
    .getByRole("button", { name: "Maximize window", exact: true })
    .click();
  await expect
    .poll(() =>
      desktop.evaluate(() => globalThis.windowCalls.includes("maximize")),
    )
    .toBe(true);
  await desktop.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].unmaximize(),
  );
  await page
    .getByRole("button", { name: "Minimize window", exact: true })
    .click();
  await expect
    .poll(() =>
      desktop.evaluate(() => globalThis.windowCalls.includes("minimize")),
    )
    .toBe(true);
  await desktop.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.restore();
    w.show();
    w.focus();
  });
  const denied = await page.evaluate(
    () => window.open("https://example.invalid", "untrusted") === null,
  );
  assert(denied, "Other renderer-created windows stay blocked");
  const diagnostics = await page.evaluate(() =>
    window.hauntDesktop.mediaDiagnostics(),
  );
  assert.equal(typeof diagnostics.hardwareAcceleration, "boolean");
  assert.equal(typeof diagnostics.gpu, "object");
  // Exercise the packaged picker with the thumbnail-free SwiftCapture catalog.
  desktop.manualCapturePicker = true;
  const pickerOpened = desktop.waitForEvent("window");
  void pickerOpened.catch(() => {});
  await desktop.evaluate(({ app, BrowserWindow }) => {
    const { chooseCapture } = process.mainModule.require(
      app.getAppPath() + "/apps/desktop/capture-picker.cjs",
    );
    globalThis.nativePickerResult = undefined;
    void chooseCapture(BrowserWindow.getAllWindows()[0], true, {
      native: true,
      sources: [
        { id: "screen:1:0", name: "Native display", width: 1920, height: 1080 },
        {
          id: "window:123:0",
          name: "Native app — Window",
          width: 1280,
          height: 720,
        },
      ],
    }).then((result) => {
      globalThis.nativePickerResult = result;
    });
  });
  const picker = await pickerOpened;
  await expect(picker.locator(".native-source")).toHaveCount(2);
  await expect(picker.locator(".source img")).toHaveCount(0);
  await picker.getByLabel("Share audio", { exact: true }).check();
  await picker
    .getByRole("button", { name: "Native app — Window", exact: true })
    .click();
  await expect
    .poll(() => desktop.evaluate(() => globalThis.nativePickerResult))
    .toEqual({
      video: {
        id: "window:123:0",
        name: "Native app — Window",
        width: 1280,
        height: 720,
      },
      audio: "loopback",
    });
  await expect.poll(() => picker.isClosed()).toBe(true);
  desktop.manualCapturePicker = false;
  const login = async (p, server, user) => {
    await p.getByRole("button", { name: "Add server", exact: true }).click();
    await p.getByLabel("Server address").fill(server.url);
    await p.getByLabel("Username", { exact: true }).fill(user);
    await p.getByLabel("Password", { exact: true }).fill(fixtures.password);
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(p.locator(".connection")).toHaveText("Connected");
  };
  for (const [transport, server] of [
    ["rtc", fixtures.rtc],
    ["ws", fixtures.ws],
  ]) {
    const context = await browser.newContext({
      viewport: { width: 1200, height: 820 },
      permissions: ["camera", "microphone"],
    });
    const bob = await context.newPage();
    try {
      await bob.goto("http://127.0.0.1:5173");
      await login(bob, server, "bob");
      await login(page, server, "alice");
      await expect(page.locator(".app-titlebar .header-members")).toBeVisible();
      await expect(page.locator(".workspace .conversation-head")).toHaveCount(
        0,
      );
      await expect(bob.locator(".window-controls")).toHaveCount(0);
      for (const p of [page, bob])
        await p
          .locator(`[data-channel-id="${server.voice}"] button.channel`)
          .click();
      await expect(page.locator(".call-tile")).toHaveCount(2);
      await expect(
        page.locator('.call-dock button[aria-label="Audio & video settings"]'),
      ).toHaveCount(0);
      await expect(
        page.locator('.call-panel button[aria-label="Audio & video settings"]'),
      ).toHaveCount(1);
      await expect(page.locator(".call-panel audio")).toHaveCount(1);
      await bob
        .locator(".call-dock")
        .getByRole("button", { name: "Turn on camera", exact: true })
        .click();
      await expect(page.locator(".call-tile video")).toHaveCount(1);
      await expect
        .poll(() =>
          page.locator(".call-tile video").evaluate((el) => el.videoWidth),
        )
        .toBeGreaterThan(0);
      await page.evaluate(() => {
        window.ownedCallAudio = document.querySelector(".call-panel audio");
        window.ownedCallTrack =
          window.ownedCallAudio.srcObject.getAudioTracks()[0].id;
      });
      const joined = await page
        .locator(".call-dock time")
        .getAttribute("datetime");
      let admissions = 0;
      const request = (r) => {
        if (r.method() === "POST" && r.url().endsWith("/admissions"))
          admissions++;
      };
      page.on("request", request);
      const continuity = async () => {
        assert(
          await page.evaluate(
            () =>
              document.querySelector(".call-panel audio") ===
                window.ownedCallAudio &&
              window.ownedCallAudio.srcObject.getAudioTracks()[0].id ===
                window.ownedCallTrack &&
              !window.ownedCallAudio.paused,
          ),
        );
        assert.equal(
          await page.locator(".call-dock time").getAttribute("datetime"),
          joined,
        );
        assert.equal(
          admissions,
          0,
          "Moving the view must not join the call again",
        );
      };
      const next = desktop.waitForEvent("window");
      await page
        .getByRole("button", { name: "Pop out call", exact: true })
        .click();
      const popup = await next;
      popup.on("pageerror", (e) => errors.push(e.message));
      await expect(popup.locator(".call-tile")).toHaveCount(2);
      await expect(popup.locator(".call-tile video")).toHaveCount(1);
      await expect
        .poll(() =>
          popup.locator(".call-tile video").evaluate((el) => el.videoWidth),
        )
        .toBeGreaterThan(0);
      await page
        .locator("button.channel")
        .filter({ hasText: "general" })
        .click();
      await expect(page.locator(".call-panel.mini")).toBeHidden();
      await expect(page.locator(".call-dock")).toBeVisible();
      await continuity();
      assert.equal(
        await popup.locator("audio").count(),
        0,
        "Only the main window plays call audio",
      );
      await popup
        .getByRole("button", { name: "Mute microphone", exact: true })
        .click();
      await expect(
        page
          .locator(".call-dock")
          .getByRole("button", { name: "Unmute microphone", exact: true }),
      ).toBeVisible();
      await page
        .locator(".call-dock")
        .getByRole("button", { name: "Unmute microphone", exact: true })
        .click();
      await expect(
        popup.getByRole("button", { name: "Mute microphone", exact: true }),
      ).toBeVisible();
      const deafen = popup.getByRole("button", { name: "Deafen", exact: true });
      await deafen.click();
      await expect(deafen.locator(".lucide-headphone-off")).toHaveCount(1);
      await expect(page.locator(".call-panel audio")).toHaveJSProperty(
        "muted",
        true,
      );
      await deafen.click();
      await expect(deafen.locator(".lucide-headphones")).toHaveCount(1);
      await expect(page.locator(".call-panel audio")).toHaveJSProperty(
        "muted",
        false,
      );
      // The native window responds to sizing and receives the main renderer's theme.
      await desktop.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().includes("call-window.html"))
          .setSize(440, 380),
      );
      await expect
        .poll(() =>
          popup
            .locator(".call-stage")
            .evaluate(
              (el) =>
                el.getBoundingClientRect().right <= innerWidth &&
                el.getBoundingClientRect().bottom <= innerHeight,
            ),
        )
        .toBe(true);
      await page.evaluate(() =>
        document.documentElement.style.setProperty("--accent", "#abcdff"),
      );
      await expect
        .poll(() =>
          popup.evaluate(() =>
            getComputedStyle(document.documentElement)
              .getPropertyValue("--accent")
              .trim(),
          ),
        )
        .toBe("#abcdff");
      await desktop.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().includes("call-window.html"))
          .setSize(960, 640),
      );
      const tile = popup.locator(".call-tile").filter({ hasText: "bob" });
      await tile.click();
      await expect(tile).toHaveClass(/focused/);
      await tile.click({ button: "right" });
      await expect(popup.getByRole("menu")).toBeVisible();
      await popup
        .getByLabel("Microphone volume", { exact: true })
        .evaluate((el) => {
          Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
          ).set.call(el, "43");
          el.dispatchEvent(new Event("input", { bubbles: true }));
        });
      await expect
        .poll(() =>
          page.locator(".call-panel audio").evaluate((el) => el.volume),
        )
        .toBe(0.43);
      await popup.keyboard.press("Escape");
      await popup.screenshot({
        path: `test-results/call-native-${transport}.png`,
      });
      await page.screenshot({
        path: `test-results/window-shell-${transport}.png`,
      });
      await closeByButton(popup, "Close call window");
      await expect(page.locator(".call-tile")).toHaveCount(2);
      await continuity();
      const reopened = desktop.waitForEvent("window");
      await page
        .getByRole("button", { name: "Pop out call", exact: true })
        .click();
      const second = await reopened;
      await expect(second.locator(".call-tile")).toHaveCount(2);
      await closeByButton(second, "Return call to main window");
      await expect(page.locator(".call-tile")).toHaveCount(2);
      await continuity();
      const reloading = desktop.waitForEvent("window");
      await page
        .getByRole("button", { name: "Pop out call", exact: true })
        .click();
      const reloadWindow = await reloading;
      await expect(reloadWindow.locator(".call-tile")).toHaveCount(2);
      await reloadWindow.reload().catch(() => {});
      await expect.poll(() => reloadWindow.isClosed()).toBe(true);
      await expect(page.locator(".call-tile")).toHaveCount(2);
      await continuity();
      const final = desktop.waitForEvent("window");
      await page
        .getByRole("button", { name: "Pop out call", exact: true })
        .click();
      const last = await final;
      await expect(last.locator(".call-tile")).toHaveCount(2);
      await closeByButton(last, "Leave call");
      await expect.poll(() => last.isClosed()).toBe(true);
      await expect(page.locator(".call-dock")).toHaveCount(0);
      page.off("request", request);
      await bob
        .locator(".call-dock")
        .getByRole("button", { name: "Leave call", exact: true })
        .click();
      console.log(
        `PASS native ${transport}: CSS titlebar, native window controls, app-wide actions, popout video/menus/controls, unchanged audio and join time, close/return/reopen and end cleanup.`,
      );
    } catch (error) {
      console.log("Window diagnostics", {
        errors,
        alerts: await page.locator('[role="alert"], .fatal').allTextContents(),
        windows: desktop
          .windows()
          .map((p) => ({ url: p.url(), closed: p.isClosed() })),
      });
      await page
        .screenshot({ path: `test-results/window-failure-${transport}.png` })
        .catch(() => {});
      throw error;
    } finally {
      await context.close();
    }
  }
  assert.deepEqual(errors, []);
}
