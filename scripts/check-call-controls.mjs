import { fillSignin } from "./signin-fields.mjs";
import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
async function peak(element) {
  // React mounts the element before attaching its stream in an effect. A
  // restarted share can already exist in the DOM while that binding is pending.
  await expect
    .poll(() =>
      element.evaluate(
        (el) =>
          el.srcObject instanceof MediaStream &&
          el.srcObject
            .getAudioTracks()
            .some((track) => track.readyState === "live"),
      ),
    )
    .toBe(true);
  return element.evaluate(async (el) => {
    const ctx = new AudioContext();
    await ctx.resume();
    const source = ctx.createMediaStreamSource(el.srcObject),
      analyser = ctx.createAnalyser();
    source.connect(analyser);
    analyser.fftSize = 512;
    const samples = new Float32Array(512);
    let peak = 0;
    for (let n = 0; n < 50; n++) {
      analyser.getFloatTimeDomainData(samples);
      peak = Math.max(peak, ...samples.map(Math.abs));
      if (peak > 0.01) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    source.disconnect();
    await ctx.close();
    return peak;
  });
}
const slider = async (page, label, value) =>
  page.getByLabel(`${label} volume`, { exact: true }).evaluate((el, n) => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set.call(el, String(n));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
export async function checkCallControls(browser, fixtures) {
  for (const [transport, server] of [
    ["rtc", fixtures.rtc],
    ["ws", fixtures.ws],
  ]) {
    const a = await browser.newContext({
      viewport: { width: 1280, height: 850 },
      permissions: ["microphone", "camera"],
    });
    const b = await browser.newContext({
      viewport: { width: 1120, height: 800 },
      permissions: ["microphone", "camera"],
    });
    const alice = await a.newPage(),
      bob = await b.newPage(),
      errors = [];
    for (const page of [alice, bob]) {
      await page.addInitScript(() => {
        window.callTones = [];
        window.activityContexts = [];
        const Context = window.AudioContext;
        window.AudioContext = class extends Context {
          constructor(...args) {
            super(...args);
            if (args[0]?.latencyHint === "interactive" && !args[0]?.sampleRate)
              window.activityContexts.push(this);
          }
        };
        const start = OscillatorNode.prototype.start;
        OscillatorNode.prototype.start = function (...args) {
          window.callTones.push(this.frequency.value);
          return start.apply(this, args);
        };
      });
      page.setDefaultTimeout(20000);
      page.on("pageerror", (error) => errors.push(error.message));
    }
    const login = async (page, user, register = false) => {
      await page.goto("http://127.0.0.1:5173");
      if (process.env.HAUNT_CLIENT_BUILD === "dist-standalone")
        await expect(
          page.getByRole("dialog", { name: "Connect to a server" }),
        ).toBeVisible();
      else
        await page
          .getByRole("button", { name: "Add server", exact: true })
          .click();
      if (register) {
        await page
          .getByRole("button", {
            name: "Have an invitation? Create an account",
            exact: true,
          })
          .click();
        await page
          .getByLabel("Server address", { exact: true })
          .fill(server.url);
        await page.getByLabel("Username", { exact: true }).fill(user);
        await page
          .getByLabel("Invitation code", { exact: true })
          .fill(server.invitation);
      } else await fillSignin(page, server.url, user);
      await page
        .getByLabel("Password", { exact: true })
        .fill(fixtures.password);
      await page
        .getByRole("button", {
          name: register ? "Create account" : "Sign in",
          exact: true,
        })
        .click();
      await expect(page.locator(".connection")).toHaveText("Connected");
      // Initial history scrolls to the newest message after authentication.
      // Let that finish before opening a menu that dismisses on scrolling.
      await expect(page.locator(".message").last()).toBeInViewport();
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
    };
    const join = (page) =>
      page
        .locator(`[data-channel-id="${server.voice}"] button.channel`)
        .click();
    try {
      await login(alice, "alice");
      await login(bob, "bob");
      if (transport === "rtc") {
        const image = await alice.evaluate(() => {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 128;
          const context = canvas.getContext("2d");
          context.fillStyle = "#305579";
          context.fillRect(0, 0, 128, 128);
          context.fillStyle = "#d7eaff";
          context.font = "bold 80px sans-serif";
          context.textAlign = "center";
          context.fillText("A", 64, 94);
          return canvas.toDataURL("image/png").split(",")[1];
        });
        await alice
          .getByRole("button", { name: "Edit your profile", exact: true })
          .click();
        const editor = alice.locator(".art-editor.art-avatar");
        await editor.locator("input[type=file]").setInputFiles({
          name: "call-avatar.png",
          mimeType: "image/png",
          buffer: Buffer.from(image, "base64"),
        });
        await editor
          .getByRole("button", { name: "Save image", exact: true })
          .click();
        await expect(editor.getByRole("status")).toHaveText("Image saved.");
        await alice
          .getByRole("dialog")
          .getByRole("button", { name: "Close", exact: true })
          .click();
      }
      const name = await alice
        .locator(".profile .profile-user-name")
        .innerText();
      const row = bob
        .locator(".sidebar .voice-member")
        .filter({ hasText: name });
      const audio = (purpose) =>
        bob.locator(`.call-panel audio[aria-label$=" · ${purpose}"]`);
      // A non-owner's server menu must not offer administrative actions.
      await bob.locator(".community-head").click({ button: "right" });
      await expect(bob.getByRole("menu")).toBeVisible();
      await expect(
        bob.getByRole("menuitem", { name: "Server settings", exact: true }),
      ).toHaveCount(0);
      await bob.keyboard.press("Escape");
      await join(alice);
      await join(bob);
      await expect(audio("audio")).toHaveCount(1, { timeout: 30000 });
      await expect(row.locator("time")).toHaveCount(1);
      const joined = await row.locator("time").getAttribute("datetime");
      assert(
        joined.endsWith("Z") &&
          Math.abs(Date.now() - Date.parse(joined)) < 30000,
      );
      await row.click();
      await expect(bob.getByRole("menu")).toHaveCount(0);
      await expect(bob.getByRole("dialog")).toBeVisible();
      await bob
        .getByRole("dialog")
        .getByRole("button", { name: "Close", exact: true })
        .click();
      const person = bob.locator(".avatar-tile").filter({ hasText: name });
      const meter = person.getByRole("meter");
      await expect(bob.locator(".call-tile")).toHaveCount(2);
      await expect(bob.locator(".call-dock")).toBeVisible();
      const equalTiles = async () => {
        await expect
          .poll(() =>
            bob.locator(".call-stage").evaluate((stage) => {
              const bounds = stage.getBoundingClientRect();
              const tiles = [...stage.querySelectorAll(".call-tile")].map(
                (tile) => ({
                  box: tile.getBoundingClientRect(),
                  video: tile.classList.contains("video-tile"),
                }),
              );
              return tiles.every(
                ({ box, video }, index) =>
                  box.width > 0 &&
                  Math.abs(box.width - box.height * (video ? 16 / 9 : 1)) < 2 &&
                  box.left >= bounds.left - 1 &&
                  box.top >= bounds.top - 1 &&
                  box.right <= bounds.right + 1 &&
                  box.bottom <= bounds.bottom + 1 &&
                  tiles
                    .slice(index + 1)
                    .every(
                      ({ box: other }) =>
                        box.right <= other.left + 1 ||
                        other.right <= box.left + 1 ||
                        box.bottom <= other.top + 1 ||
                        other.bottom <= box.top + 1,
                    ),
              );
            }),
          )
          .toBe(true);
      };
      const avatarGrid = async () => {
        await equalTiles();
        await expect(bob.locator(".call-tile.focused")).toHaveCount(0);
        await expect
          .poll(
            () =>
              bob.locator(".call-stage").evaluate((stage) => {
                const { width, height } = stage.getBoundingClientRect();
                const tiles = [...stage.querySelectorAll(".avatar-tile")];
                let best = 0;
                for (let columns = 1; columns <= tiles.length; columns++) {
                  const rows = Math.ceil(tiles.length / columns);
                  best = Math.max(
                    best,
                    Math.min(
                      (width - (columns - 1) * 8) / columns,
                      (height - (rows - 1) * 8) / rows,
                    ),
                  );
                }
                return Math.max(
                  ...tiles.map((tile) =>
                    Math.abs(tile.getBoundingClientRect().width - best),
                  ),
                );
              }),
            {
              message:
                "Voice-only grid gives each square the largest size that fits",
            },
          )
          .toBeLessThan(2);
      };
      const focusLayout = async () => {
        await expect(bob.locator(".call-tile.focused")).toBeVisible();
        assert(
          await bob.locator(".call-stage").evaluate((el) => {
            const box = el.getBoundingClientRect();
            const focus = el.querySelector(".focused").getBoundingClientRect();
            const ratio = el
              .querySelector(".focused")
              .classList.contains("video-tile")
              ? 16 / 9
              : 1;
            return (
              focus.width > 0 &&
              Math.abs(focus.width - focus.height * ratio) < 2 &&
              Math.abs(
                focus.left + focus.width / 2 - box.left - box.width / 2,
              ) < 2 &&
              focus.left >= box.left - 1 &&
              focus.right <= box.right + 1 &&
              focus.top >= box.top - 1 &&
              [...el.querySelectorAll(".call-tile:not(.focused)")].every(
                (tile) => {
                  const b = tile.getBoundingClientRect();
                  return b.top >= focus.bottom && b.bottom <= box.bottom + 1;
                },
              )
            );
          }),
          "Focused tile is centered, keeps its aspect ratio and fits above the other participants",
        );
      };
      await equalTiles();
      // The viewport itself must never scroll away from the fixed call stage
      // or dock, including below the former 430px document minimum height.
      for (const viewport of [
        { width: 1120, height: 380 },
        { width: 390, height: 680 },
        { width: 1120, height: 800 },
      ]) {
        await bob.setViewportSize(viewport);
        await expect
          .poll(() =>
            bob.evaluate(() => {
              const slot = document
                .querySelector(".voice-stage-slot")
                .getBoundingClientRect();
              const panel = document
                .querySelector(".call-panel.full")
                .getBoundingClientRect();
              return (
                Math.abs(slot.top - panel.top) +
                Math.abs(slot.height - panel.height)
              );
            }),
          )
          .toBeLessThan(2);
        await bob.mouse.move(viewport.width - 30, viewport.height / 2);
        await bob.mouse.wheel(0, 2500);
        await bob.mouse.wheel(0, -5000);
        const shell = await bob.evaluate(() => {
          window.scrollTo(0, 1000);
          const app = document.querySelector(".app").getBoundingClientRect();
          const dock = document
            .querySelector(".call-dock")
            .getBoundingClientRect();
          return {
            y: scrollY,
            top: app.top,
            bottom: app.bottom,
            height: innerHeight,
            document: document.documentElement.scrollHeight,
            dockBottom: dock.bottom,
          };
        });
        assert.equal(shell.y, 0);
        assert.equal(shell.top, 0);
        assert(
          shell.bottom <= shell.height + 1 &&
            shell.document <= shell.height + 1 &&
            shell.dockBottom <= shell.height + 1,
          "Voice controls and app stay within the viewport",
        );
      }
      await equalTiles();
      await person.click();
      await person.press("Enter");
      await avatarGrid();
      if (transport === "rtc") {
        const original = await bob.evaluate(() =>
          localStorage.getItem("chatxo-client-preferences-v1"),
        );
        const evidence = [];
        await bob.setViewportSize({ width: 1920, height: 1080 });
        await bob.evaluate(() => {
          window.hauntDesktop = {
            platform: "linux",
            windowState: async () => ({
              target: "main",
              maximized: false,
              fullscreen: false,
            }),
            onWindowState: () => () => {},
            onCallWindowClosed: () => () => {},
            windowControl: async () => {},
            setBadge: async () => {},
            notificationAvailable: async () => false,
            showNotification: async () => {},
            appearance: {
              set: async (request) => ({
                effect: request.mode,
                supported: true,
                restart: false,
              }),
            },
          };
        });
        for (const [name, theme, accentColor] of [
          ["charcoal", { preset: "charcoal" }, "#ff9a3d"],
          [
            "peach-material",
            {
              preset: "peach-noir",
              windowEffect: "material",
              sidebarOpacity: 30,
            },
            "#ffc39c",
          ],
          ["paper", { preset: "paper" }, "#4364b0"],
        ]) {
          await bob.evaluate(
            ({ theme, accentColor }) => {
              const key = "chatxo-client-preferences-v1";
              const current = JSON.parse(localStorage.getItem(key) ?? "{}");
              localStorage.setItem(
                key,
                JSON.stringify({ ...current, theme, accentColor }),
              );
              window.dispatchEvent(new StorageEvent("storage", { key }));
            },
            { theme, accentColor },
          );
          await expect(bob.locator("html")).toHaveAttribute(
            "data-window-effect",
            theme.windowEffect ?? "solid",
          );
          await avatarGrid();
          await bob.evaluate(() =>
            Promise.all(
              document
                .getAnimations()
                .filter((animation) => animation instanceof CSSTransition)
                .map((animation) => animation.finished.catch(() => {})),
            ),
          );
          const memberNames = [];
          for (const member of await bob
            .locator(".member-list .member-row")
            .all()) {
            const samples = [];
            const sample = async (state) => {
              samples.push(
                ...(await member.evaluate(async (row, state) => {
                  const names = [...row.querySelectorAll(".profile-user-name")];
                  const values = [];
                  for (let frame = 0; frame < 3; frame++) {
                    if (frame) await new Promise(requestAnimationFrame);
                    for (const name of names) {
                      const style = getComputedStyle(name);
                      values.push({
                        state,
                        frame,
                        name: name.textContent,
                        treatment: name.dataset.nameTreatment,
                        stroke: style.webkitTextStrokeWidth,
                        edge: style.webkitTextStrokeColor,
                        background: style.backgroundColor,
                        paintOrder: style.paintOrder,
                      });
                    }
                  }
                  return values;
                }, state)),
              );
            };
            await bob.mouse.move(400, 70);
            await sample("idle");
            await member.hover();
            await sample("hover");
            await member.focus();
            await sample("focus");
            await bob.mouse.move(400, 70);
            await sample("leave");
            await bob.keyboard.press("Tab");
            await sample("blur");
            assert.ok(
              samples.every(
                (sample) =>
                  sample.treatment === "outline" &&
                  sample.stroke === "4px" &&
                  ["rgb(0, 0, 0)", "rgb(255, 255, 255)"].includes(
                    sample.edge,
                  ) &&
                  sample.background === "rgba(0, 0, 0, 0)" &&
                  sample.paintOrder.split(" ")[0] === "stroke",
              ),
              JSON.stringify({ theme: name, samples }),
            );
            memberNames.push({
              names: await member
                .locator(".profile-user-name")
                .allTextContents(),
              samples,
            });
          }
          await bob.locator(".member-list .member-row").first().hover();
          await bob.screenshot({ path: `test-results/name-hover-${name}.png` });
          await bob.mouse.move(400, 70);
          const result = await person.evaluate((tile) => {
            const box = tile.getBoundingClientRect();
            const avatar = tile
              .querySelector(".avatar")
              .getBoundingClientRect();
            const style = getComputedStyle(
              tile.querySelector(".call-tile-label"),
            );
            return {
              imageWidth: tile.querySelector(".avatar img")?.naturalWidth,
              tile: { width: box.width, height: box.height },
              avatar: {
                width: avatar.width,
                height: avatar.height,
                centered:
                  Math.abs(
                    avatar.left + avatar.width / 2 - box.left - box.width / 2,
                  ) < 2,
              },
              label: { background: style.backgroundColor, color: style.color },
              levelHeight: tile
                .querySelector(".voice-level")
                .getBoundingClientRect().height,
              names: [...document.querySelectorAll(".profile-user-name")].map(
                (name) => ({
                  treatment: name.dataset.nameTreatment,
                  background: getComputedStyle(name).backgroundColor,
                  stroke: getComputedStyle(name).webkitTextStrokeWidth,
                }),
              ),
              initial: (() => {
                const avatar = [
                  ...document.querySelectorAll(".avatar-tile .avatar"),
                ].find((el) => !el.querySelector("img"));
                return {
                  text: avatar?.textContent,
                  size: avatar && getComputedStyle(avatar).fontSize,
                  selection: avatar && getComputedStyle(avatar).userSelect,
                };
              })(),
              serverIcon: (() => {
                const icon = document.querySelector(".server-icon-art");
                return {
                  inset: getComputedStyle(icon).top,
                  shadow: getComputedStyle(icon, "::after").boxShadow,
                  bevel: getComputedStyle(icon.parentElement).boxShadow,
                };
              })(),
              controls: [...document.querySelectorAll(".call-controls")].map(
                (bar) =>
                  getComputedStyle(bar.querySelector("button")).boxShadow,
              ),
              theme: JSON.parse(
                localStorage.getItem("chatxo-client-preferences-v1"),
              ).theme,
            };
          });
          assert.ok(
            result.avatar.width > 180 && result.avatar.centered,
            JSON.stringify(result),
          );
          assert.ok(result.imageWidth > 0);
          assert.ok(Math.abs(result.avatar.width - result.tile.width + 4) < 2);
          assert.ok(result.levelHeight >= 7);
          assert.equal(result.initial.selection, "none");
          assert.ok(parseFloat(result.initial.size) > 80);
          assert.ok(
            result.names.every(
              (name) =>
                name.treatment === "outline" &&
                name.background === "rgba(0, 0, 0, 0)",
            ),
          );
          assert.ok(
            result.names
              .filter((name) => name.treatment === "outline")
              .every((name) => name.stroke === "4px"),
          );
          assert.ok(
            result.serverIcon.shadow.includes("inset") &&
              result.serverIcon.bevel.includes("inset"),
          );
          assert.ok(Math.abs(result.avatar.width - result.avatar.height) < 1);
          assert.ok(
            result.controls.every((shadow) => shadow.includes("inset")),
          );
          evidence.push({ name, memberNames, ...result });
          await bob.screenshot({
            path: `test-results/call-filled-${name}.png`,
          });
          await person.locator(".call-avatar").click({ button: "right" });
          await expect(bob.getByRole("menu")).toHaveCount(0);
        }
        await fs.writeFile(
          "test-results/call-presentation.json",
          JSON.stringify(evidence, null, 2),
        );
        await bob.evaluate((original) => {
          const key = "chatxo-client-preferences-v1";
          if (original === null) localStorage.removeItem(key);
          else localStorage.setItem(key, original);
          window.dispatchEvent(new StorageEvent("storage", { key }));
          delete window.hauntDesktop;
        }, original);
        await bob.setViewportSize({ width: 1120, height: 800 });
      }
      await expect(bob.getByRole("menu")).toHaveCount(0);
      await person.click();
      await expect(bob.locator(".call-tile.focused")).toHaveCount(0);
      await equalTiles();
      await expect(person).toHaveAttribute("data-speaking", "true");
      await expect(row.locator(".speaking-mic")).toBeVisible();
      await expect
        .poll(async () => Number(await meter.getAttribute("aria-valuenow")))
        .toBeGreaterThan(0);
      await expect(
        alice.locator(".call-tile").filter({ hasText: name }),
      ).toHaveAttribute("data-speaking", "true");
      assert.equal(
        await bob.evaluate(() => window.activityContexts.length),
        1,
        "One activity context for the whole call",
      );
      await bob.screenshot({
        path: `test-results/voice-grid-${transport}.png`,
      });

      for (const host of [".call-dock", ".call-panel.full"]) {
        for (const purpose of ["Camera", "Screen-share"]) {
          const trigger = bob.locator(host).getByRole("button", {
            name: `${purpose} capture settings`,
            exact: true,
          });
          const overlay = await trigger.evaluate((button) => {
            const a = button.getBoundingClientRect();
            const b = button.parentElement
              .querySelector("button")
              .getBoundingClientRect();
            return (
              a.left < b.right &&
              a.right > b.left &&
              a.top < b.bottom &&
              a.bottom > b.top
            );
          });
          assert(
            overlay,
            "Capture settings trigger overlaps its camera/share button",
          );
          await trigger.click();
          const panel = bob.getByRole("dialog", {
            name: `${purpose} capture settings`,
            exact: true,
          });
          await expect(panel).toBeVisible();
          assert(
            await panel.evaluate((el) => {
              const r = el.getBoundingClientRect();
              return (
                r.left >= 8 &&
                r.right <= innerWidth - 7 &&
                r.top >= 8 &&
                r.bottom <= innerHeight - 7
              );
            }),
            "Capture settings stay inside the viewport",
          );
          await expect(bob.locator(".call-panel video")).toHaveCount(0);
          if (purpose === "Camera") {
            await panel
              .getByRole("button", { name: "Check camera modes", exact: true })
              .click();
            await expect(
              panel.getByLabel("Camera resolution", { exact: true }),
            ).toBeEnabled({ timeout: 30000 });
            await panel
              .getByLabel("Camera resolution", { exact: true })
              .selectOption("640x480");
          } else {
            await panel
              .getByLabel("Screen share frame rate", { exact: true })
              .selectOption("30");
          }
          await bob.screenshot({
            path: `test-results/capture-${purpose.toLowerCase()}-${host === ".call-dock" ? "dock" : "stage"}-${transport}.png`,
          });
          await bob.keyboard.press("Escape");
          await expect(panel).toHaveCount(0);
          await expect(trigger).toBeFocused();
        }
      }
      await bob
        .getByRole("button", { name: "Hide member list", exact: true })
        .click();
      await bob.setViewportSize({ width: 600, height: 500 });
      const qualityTrigger = bob.locator(".call-dock").getByRole("button", {
        name: "Screen-share capture settings",
        exact: true,
      });
      await qualityTrigger.click();
      const qualityPanel = bob.getByRole("dialog", {
        name: "Screen-share capture settings",
        exact: true,
      });
      await expect(qualityPanel).toBeVisible();
      await bob.setViewportSize({ width: 390, height: 340 });
      await expect
        .poll(() =>
          qualityPanel.evaluate((el) => {
            const r = el.getBoundingClientRect();
            return (
              r.left >= 8 &&
              r.right <= innerWidth - 7 &&
              r.top >= 8 &&
              r.bottom <= innerHeight - 7
            );
          }),
        )
        .toBe(true);
      await bob.screenshot({
        path: `test-results/capture-small-${transport}.png`,
      });
      await bob.keyboard.press("Escape");
      await bob.setViewportSize({ width: 1120, height: 800 });
      await bob
        .getByRole("button", { name: "Show member list", exact: true })
        .click();

      const initial = await row.locator("time").textContent();
      const requests = [];
      const capture = (request) => {
        if (/\/api\/v1\/(voice|conversations)/.test(request.url()))
          requests.push(request.url());
      };
      bob.on("request", capture);
      await expect(row.locator("time")).not.toHaveText(initial);
      bob.off("request", capture);
      assert.deepEqual(
        requests,
        [],
        "Timers must not fetch roster/history updates",
      );
      await row.dispatchEvent("contextmenu", { clientX: 1118, clientY: 798 });
      const menu = bob.locator(".context-menu");
      await expect(menu).toBeVisible();
      assert(
        await menu.evaluate((el) => {
          const b = el.getBoundingClientRect();
          return (
            b.left >= 0 &&
            b.top >= 0 &&
            b.right <= innerWidth &&
            b.bottom <= innerHeight
          );
        }),
        "Menu must fit viewport",
      );
      await slider(bob, "Microphone", 0);
      await expect(person).toHaveAttribute("data-speaking", "false");
      await expect(meter).toHaveAttribute("aria-valuenow", "0");
      await expect(row.locator(".speaking-mic")).toHaveCount(0);
      await slider(bob, "Microphone", 27);
      await slider(bob, "Camera audio", 43);
      await slider(bob, "Screen-share audio", 61);
      await expect
        .poll(() => audio("audio").evaluate((el) => el.volume))
        .toBe(0.27);
      await bob.keyboard.press("Escape");
      await expect(row).toBeFocused();
      await row.press("Shift+F10");
      await expect(bob.getByLabel("Camera audio volume")).toHaveValue("43");
      await bob.getByLabel("Camera audio volume").focus();
      await bob.keyboard.press("ArrowRight");
      await expect(bob.getByLabel("Camera audio volume")).toHaveValue("44");
      await bob.keyboard.press("Escape");
      await alice
        .getByRole("button", { name: "Account settings", exact: true })
        .click();
      await alice.getByRole("button", { name: "Devices", exact: true }).click();
      const device = await alice
        .getByLabel("Camera audio source")
        .locator("option")
        .nth(1)
        .getAttribute("value");
      assert(device);
      await alice.getByLabel("Camera audio source").selectOption(device);
      await alice
        .getByRole("dialog")
        .getByRole("button", { name: "Check camera modes", exact: true })
        .click();
      await expect(
        alice
          .getByRole("dialog")
          .getByLabel("Camera resolution", { exact: true }),
      ).toBeEnabled({ timeout: 20000 });
      await alice
        .getByRole("dialog")
        .getByLabel("Camera resolution", { exact: true })
        .selectOption("640x480");
      await alice.getByRole("button", { name: "Close", exact: true }).click();
      // Real browser capture video plus a deterministic test tone for screen audio.
      // Headless screen capture does not expose system audio; this specifically
      // checks separate transport/playback, not OS system-audio acquisition.
      await alice.evaluate(() => {
        const getDisplay = navigator.mediaDevices.getDisplayMedia.bind(
          navigator.mediaDevices,
        );
        navigator.mediaDevices.getDisplayMedia = async (constraints) => {
          const stream = await getDisplay({ ...constraints, audio: false });
          const ctx = new AudioContext(),
            oscillator = ctx.createOscillator(),
            destination = ctx.createMediaStreamDestination();
          await ctx.resume();
          oscillator.frequency.value = 523;
          oscillator.connect(destination);
          oscillator.start();
          stream.addTrack(destination.stream.getAudioTracks()[0]);
          window.callTestAudio = ctx;
          return stream;
        };
      });
      await alice
        .locator(".call-dock")
        .getByRole("button", { name: "Turn on camera", exact: true })
        .click();
      await expect(audio("camera_audio")).toHaveCount(1, { timeout: 30000 });
      await expect
        .poll(() => audio("camera_audio").evaluate((el) => el.volume))
        .toBe(0.44);
      for (const page of [alice, bob])
        await page.evaluate(() => {
          window.callTones = [];
        });
      await alice
        .locator(".call-dock")
        .getByRole("button", { name: "Share screen", exact: true })
        .click();
      await expect(audio("screen_audio")).toHaveCount(1, { timeout: 30000 });
      for (const page of [alice, bob])
        await expect
          .poll(() =>
            page.evaluate(
              () =>
                window.callTones.filter((n) => Math.abs(n - 698.46) < 0.1)
                  .length,
            ),
          )
          .toBe(1);

      await expect
        .poll(() => audio("screen_audio").evaluate((el) => el.volume))
        .toBe(0.61);
      await expect(bob.locator(".call-panel video")).toHaveCount(2);
      await expect(bob.locator(".call-tile")).toHaveCount(4);
      await equalTiles();
      await expect
        .poll(() =>
          bob
            .locator(".call-panel video")
            .evaluateAll((elements) =>
              elements.every((el) => el.videoWidth > 0 && el.videoHeight > 0),
            ),
        )
        .toBe(true);
      assert(
        await bob.locator(".call-stage").evaluate((stage) => {
          const mediaBottom = Math.max(
            ...[...stage.querySelectorAll(".video-tile")].map(
              (el) => el.getBoundingClientRect().bottom,
            ),
          );
          return [...stage.querySelectorAll(".avatar-tile")].every(
            (el) => el.getBoundingClientRect().top >= mediaBottom,
          );
        }),
        "All participant squares are below camera and screen tiles",
      );
      await bob.screenshot({
        path: `test-results/call-media-grid-${transport}.png`,
      });
      const videoFrames = await bob
        .locator(".call-panel video")
        .evaluateAll((elements) =>
          elements.map((el) => ({
            sourceWidth: el.videoWidth,
            sourceHeight: el.videoHeight,
            objectFit: getComputedStyle(el).objectFit,
            tileWidth: el.closest(".call-tile").getBoundingClientRect().width,
            tileHeight: el.closest(".call-tile").getBoundingClientRect().height,
          })),
        );
      assert.ok(videoFrames.every((frame) => frame.objectFit === "contain"));
      assert.ok(
        videoFrames.some(
          (frame) =>
            Math.abs(frame.sourceWidth / frame.sourceHeight - 16 / 9) > 0.05,
        ),
        "Exercise a source with a different aspect ratio",
      );
      await fs.writeFile(
        `test-results/call-video-frames-${transport}.json`,
        JSON.stringify(videoFrames, null, 2),
      );
      await bob
        .locator(".call-panel video")
        .first()
        .evaluate((el) => {
          window.originalCallVideo = el;
        });
      await audio("audio").evaluate((el) => {
        window.originalCallAudio = el;
      });
      const tile = bob.locator(".call-panel .video-tile").first();
      await tile.click();
      await expect(tile).toHaveAttribute("aria-pressed", "true");
      await focusLayout();
      await expect(bob.locator(".call-tile:not(.focused)")).toHaveCount(3);
      assert(
        await bob
          .locator(".call-panel video")
          .first()
          .evaluate((el) => el === window.originalCallVideo),
      );
      await bob.screenshot({
        path: `test-results/voice-focused-${transport}.png`,
      });
      await expect(bob.getByRole("menu")).toHaveCount(0);
      await expect
        .poll(() =>
          audio("audio").evaluate((el) => el === window.originalCallAudio),
        )
        .toBe(true);
      await tile.click();
      await expect(tile).toHaveAttribute("aria-pressed", "false");
      const shareTile = bob
        .locator(".call-tile")
        .filter({ hasText: `${name} · screen` });
      await shareTile.click();
      await focusLayout();
      await alice
        .locator(".call-dock")
        .getByRole("button", { name: "Stop sharing screen", exact: true })
        .click();
      await expect(shareTile).toHaveCount(0);
      await expect(bob.locator(".call-tile.focused")).toHaveCount(0);
      await equalTiles();
      await alice
        .locator(".call-dock")
        .getByRole("button", { name: "Share screen", exact: true })
        .click();
      await expect(audio("screen_audio")).toHaveCount(1);

      for (const source of ["audio", "camera_audio", "screen_audio"])
        assert(
          (await peak(audio(source))) > 0.01,
          `${transport} decodes ${source}`,
        );
      for (const page of [alice, bob])
        await page.evaluate(() => {
          window.callTones = [];
        });
      await alice
        .locator(".call-panel.full")
        .getByRole("button", { name: "Mute microphone", exact: true })
        .click();
      await expect(
        alice
          .locator(".call-dock")
          .getByRole("button", { name: "Unmute microphone", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(
        alice
          .locator(".call-panel.full")
          .getByRole("button", { name: "Unmute microphone", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      assert.equal(await row.locator("time").getAttribute("datetime"), joined);
      await expect(
        bob.locator(".call-tile.speaking").filter({ hasText: name }),
      ).toHaveCount(0);
      for (const value of await bob
        .locator(".call-tile")
        .filter({ hasText: name })
        .getByRole("meter", { name: /microphone level$/ })
        .all())
        await expect(value).toHaveAttribute("aria-valuenow", "0");
      for (const source of ["camera audio", "screen-share audio"])
        await expect
          .poll(async () =>
            Number(
              await bob
                .getByRole("meter", {
                  name: `${name} ${source} level`,
                  exact: true,
                })
                .getAttribute("aria-valuenow"),
            ),
          )
          .toBeGreaterThan(0);
      await expect(row.locator(".speaking-mic")).toHaveCount(0);
      await expect
        .poll(() => alice.evaluate(() => window.callTones.map(Math.round)))
        .toEqual([392, 294]);
      assert.deepEqual(await bob.evaluate(() => window.callTones), []);

      assert(
        (await peak(audio("camera_audio"))) > 0.01,
        "Mic mute leaves camera audio playing",
      );
      assert(
        (await peak(audio("screen_audio"))) > 0.01,
        "Mic mute leaves screen audio playing",
      );
      await alice
        .locator(".call-dock")
        .getByRole("button", { name: "Unmute microphone", exact: true })
        .click();
      await expect
        .poll(() => alice.evaluate(() => window.callTones.map(Math.round)))
        .toEqual([392, 294, 392, 587]);
      await bob
        .locator(".call-dock")
        .getByRole("button", { name: "Deafen", exact: true })
        .click();
      for (const value of await bob
        .locator(".call-tile")
        .filter({ hasText: name })
        .getByRole("meter")
        .all())
        await expect(value).toHaveAttribute("aria-valuenow", "0");
      await expect(row.locator(".speaking-mic")).toHaveCount(0);
      await expect
        .poll(() =>
          bob
            .locator(".call-panel audio")
            .evaluateAll((els) => els.every((el) => el.muted)),
        )
        .toBe(true);
      await bob
        .locator(".call-dock")
        .getByRole("button", { name: "Deafen", exact: true })
        .click();
      await expect
        .poll(() =>
          bob
            .locator(".call-panel audio")
            .evaluateAll((els) => els.every((el) => !el.muted)),
        )
        .toBe(true);
      await expect
        .poll(() => bob.evaluate(() => window.callTones.map(Math.round)))
        .toEqual([392, 294, 330, 262, 196, 392, 587, 262, 392, 659]);
      // Reconfiguration and reconnect restore source levels from stable user IDs.
      await alice
        .locator(".call-dock")
        .getByRole("button", { name: "Turn off camera", exact: true })
        .click();
      await expect(audio("camera_audio")).toHaveCount(0);
      await expect(audio("screen_audio")).toHaveCount(1);
      await alice
        .locator(".call-dock")
        .getByRole("button", { name: "Turn on camera", exact: true })
        .click();
      await expect(audio("camera_audio")).toHaveCount(1, { timeout: 30000 });
      await expect
        .poll(() => audio("camera_audio").evaluate((el) => el.volume))
        .toBe(0.44);
      // Floating geometry changes never replace playback elements.
      await audio("audio").evaluate((el) => {
        window.originalCallAudio = el;
      });
      await bob
        .locator(`[data-channel-id="${server.general}"] button.channel`)
        .click();
      const pip = bob.locator(".call-panel.mini");
      await expect(pip).toBeVisible();
      await expect(pip.locator(".call-controls")).toHaveCount(0);
      await expect(bob.locator(".call-dock")).toBeVisible();
      const before = await pip.boundingBox(),
        grip = await bob
          .getByRole("button", { name: "Move call window" })
          .boundingBox();
      await bob.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
      await bob.mouse.down();
      const moveX = before.x > 220 ? -200 : 200;
      await bob.mouse.move(grip.x + moveX, grip.y - 100, { steps: 8 });
      await bob.mouse.up();
      assert(
        Math.abs((await pip.boundingBox()).x - before.x) > 100,
        "PiP moves by dragging",
      );
      const small = await pip.boundingBox(),
        handle = await bob
          .getByRole("button", { name: "Resize call window" })
          .boundingBox();
      await bob.mouse.move(handle.x + 8, handle.y + 8);
      await bob.mouse.down();
      await bob.mouse.move(handle.x + 88, handle.y + 68, { steps: 8 });
      await bob.mouse.up();
      assert(
        (await pip.boundingBox()).width > small.width + 60,
        "PiP resizes by dragging",
      );
      await bob
        .locator(".avatar-tile .call-avatar")
        .first()
        .click({ position: { x: 4, y: 4 } });
      await expect(
        bob.getByRole("dialog", { name: "Member profile" }),
      ).toHaveCount(0);
      await expect(bob.locator(".avatar-tile.focused")).toHaveCount(0);
      await equalTiles();
      await bob
        .getByRole("button", { name: "Resize call window" })
        .press("ArrowUp");
      await bob
        .getByRole("button", { name: "Move call window" })
        .press("ArrowLeft");
      await bob
        .getByRole("button", { name: "Hide member list", exact: true })
        .click();
      await bob.setViewportSize({ width: 390, height: 844 });
      assert(
        await pip.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return (
            r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight
          );
        }),
        "PiP is clamped on viewport resize",
      );
      await bob.screenshot({ path: `test-results/call-pip-${transport}.png` });
      await bob.setViewportSize({ width: 1120, height: 800 });
      await expect
        .poll(() =>
          audio("audio").evaluate((el) => el === window.originalCallAudio),
        )
        .toBe(true);
      const saved = await bob.evaluate(() =>
        JSON.parse(localStorage.getItem("chatxo-call-window-v1")),
      );
      await bob
        .getByRole("button", { name: "Open voice channel", exact: true })
        .click();
      await expect(bob.locator(".call-panel.full")).toBeVisible();
      await expect
        .poll(() =>
          audio("audio").evaluate((el) => el === window.originalCallAudio),
        )
        .toBe(true);
      const other = transport === "rtc" ? fixtures.ws : fixtures.rtc;
      await bob
        .getByRole("button", { name: "Add server", exact: true })
        .click();
      await fillSignin(bob, other.url, "bob");
      await bob.getByLabel("Password", { exact: true }).fill(fixtures.password);
      await bob.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(bob.locator(".connection")).toHaveText("Connected");
      await expect(bob.locator(".call-dock")).toBeVisible();
      await expect(bob.locator(".call-panel.mini")).toBeVisible();
      assert(
        await audio("audio").evaluate((el) => el === window.originalCallAudio),
      );
      await bob
        .locator(".call-dock")
        .getByRole("button", { name: /^Return to call/ })
        .click();
      await expect(bob.locator(".call-panel.full")).toBeVisible();
      await bob.reload();
      // Restored accounts are ordered by their stored IDs, not by which
      // installation this test joined first. Select the call's server.
      await bob
        .getByRole("button", { name: `Open ${server.name}`, exact: true })
        .click();
      await expect(bob.locator(".connection")).toHaveText("Connected");
      await join(bob);
      for (const [source, level] of [
        ["audio", 0.27],
        ["camera_audio", 0.44],
        ["screen_audio", 0.61],
      ]) {
        await expect(audio(source)).toHaveCount(1, { timeout: 30000 });
        await expect
          .poll(() => audio(source).evaluate((el) => el.volume))
          .toBe(level);
      }
      assert.equal(
        await bob.evaluate(
          () =>
            window.callTones.filter((n) => Math.abs(n - 698.46) < 0.1).length,
        ),
        0,
        "Late join must not replay an existing screen share",
      );
      await bob
        .locator(`[data-channel-id="${server.general}"] button.channel`)
        .click();
      await expect
        .poll(() =>
          bob
            .locator(".call-panel.mini")
            .evaluate((el) => el.getBoundingClientRect().width),
        )
        .toBe(saved.width);
      await bob
        .getByRole("button", { name: "Open voice channel", exact: true })
        .click();
      await row.click({ button: "right" });
      await slider(bob, "Screen-share audio", 0);
      await expect
        .poll(() => audio("screen_audio").evaluate((el) => el.volume))
        .toBe(0);
      await expect
        .poll(() => audio("camera_audio").evaluate((el) => el.volume))
        .toBe(0.44);
      await bob.screenshot({
        path: `test-results/call-controls-${transport}.png`,
      });
      await bob.keyboard.press("Escape");
      if (transport === "rtc") {
        const guests = [];
        try {
          await bob.setViewportSize({ width: 1920, height: 1080 });
          for (const name of ["carol", "dana", "eli"]) {
            const context = await browser.newContext({
              permissions: ["microphone"],
            });
            guests.push(context);
            const page = await context.newPage();
            await login(page, name, true);
            await join(page);
          }
          await expect(bob.locator(".avatar-tile")).toHaveCount(5);
          await equalTiles();
          await bob.screenshot({
            path: "test-results/call-five-with-media.png",
          });
          assert(
            await bob.locator(".call-stage").evaluate((stage) => {
              const media = [...stage.querySelectorAll(".video-tile")].map(
                (el) => el.getBoundingClientRect(),
              );
              const avatars = [...stage.querySelectorAll(".avatar-tile")].map(
                (el) => el.getBoundingClientRect(),
              );
              return (
                avatars.every(
                  (r) => r.top >= Math.max(...media.map((r) => r.bottom)),
                ) && avatars.every((r) => Math.abs(r.top - avatars[0].top) < 2)
              );
            }),
            "Five participants fit in one row below the media",
          );
          for (const name of ["Turn off camera", "Stop sharing screen"])
            await alice
              .locator(".call-dock")
              .getByRole("button", { name, exact: true })
              .click();
          await expect(bob.locator(".video-tile")).toHaveCount(0);
          const memberToggle = bob.getByRole("button", {
            name: "Hide member list",
            exact: true,
          });
          if (await memberToggle.isVisible()) await memberToggle.click();
          for (const viewport of [
            { width: 1920, height: 1080 },
            { width: 1120, height: 800 },
            { width: 600, height: 500 },
          ]) {
            await bob.setViewportSize(viewport);
            await avatarGrid();
            assert(
              await bob.locator(".avatar-tile").evaluateAll((tiles) =>
                tiles.every((tile) => {
                  const box = tile.getBoundingClientRect();
                  const label = tile
                    .querySelector(".call-tile-label")
                    .getBoundingClientRect();
                  const center = document.elementFromPoint(
                    box.left + box.width / 2,
                    box.top + box.height / 2,
                  );
                  return (
                    box.width >= 80 &&
                    label.top >= box.top &&
                    !!center?.closest(".call-avatar")
                  );
                }),
              ),
              "Participant labels and meters leave the avatar center visible",
            );
            assert(
              await bob
                .locator(".voice-chat .composer")
                .evaluate((composer) => {
                  const box = composer.getBoundingClientRect();
                  const pane = composer
                    .closest(".voice-chat")
                    .getBoundingClientRect();
                  const center = document.elementFromPoint(
                    box.left + box.width / 2,
                    box.top + box.height / 2,
                  );
                  return (
                    box.top >= pane.top &&
                    box.bottom <= pane.bottom + 1 &&
                    center?.closest(".composer") === composer
                  );
                }),
              "Pinned chat composer fits beside the call without being covered",
            );
            await bob.screenshot({
              path: `test-results/call-five-grid-${viewport.width}.png`,
            });
          }
        } finally {
          for (const context of guests) await context.close();
        }
        await expect(bob.locator(".avatar-tile")).toHaveCount(2);
        await bob.setViewportSize({ width: 1120, height: 800 });
      }
      await alice
        .locator(".call-dock")
        .getByRole("button", { name: "Leave call", exact: true })
        .click();
      await expect(row).toHaveCount(0);
      await bob
        .locator(".call-dock")
        .getByRole("button", { name: "Leave call", exact: true })
        .click();
      await expect(bob.locator(".call-dock")).toHaveCount(0);
      assert(
        await bob.evaluate(() =>
          window.activityContexts.every((ctx) => ctx.state === "closed"),
        ),
        "Activity contexts close on leave",
      );
      assert.deepEqual(errors, []);
      console.log(
        `PASS ${transport}: fitted avatar grid, media stage and focused strip, local/remote speaking and meters, global dock across servers, UTC local timers, permission-aware context menus, keyboard sliders, three decoded audio sources, independent saved levels, local and room sounds, PiP drag/resize/fit/persistence, republish and reload`,
      );
    } catch (error) {
      await bob
        .screenshot({
          path: `test-results/call-controls-${transport}-failure.png`,
        })
        .catch(() => {});
      throw error;
    } finally {
      await a.close();
      await b.close();
    }
  }
}
