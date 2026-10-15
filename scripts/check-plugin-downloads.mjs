import { fillSignin } from "./signin-fields.mjs";
import { expect } from "@playwright/test";
import assert from "node:assert/strict";
export async function checkPluginDownloads(page, fixtures, label = "browser") {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.setDefaultTimeout(20000);
  await page.addInitScript(() => {
    window.pluginGate = false;
    window.pluginFail = false;
    window.modelRequests = 0;
    window.admissions = 0;
    window.publishedAudio = [];
    window.failPluginWorker = false;
    const WorkerClass = window.Worker;
    window.Worker = class extends WorkerClass {
      postMessage(data, ...rest) {
        if (window.failPluginWorker && data?.type === "init" && data.plugin) {
          window.failPluginWorker = false;
          queueMicrotask(() =>
            this.dispatchEvent(
              new MessageEvent("message", { data: { type: "error" } }),
            ),
          );
          return;
        }
        super.postMessage(data, ...rest);
      }
    };
    window.readinessBlocked = sessionStorage.readinessBlocked === "yes";
    const add = RTCPeerConnection.prototype.addTrack;
    RTCPeerConnection.prototype.addTrack = function (track, ...args) {
      if (track.kind === "audio") window.publishedAudio.push(track.id);
      return add.call(this, track, ...args);
    };
    const original = window.fetch;
    window.fetch = async (...args) => {
      const url = String(args[0]?.url ?? args[0]);
      if (url.endsWith("/readyz") && window.readinessBlocked)
        return new Response('{"status":"unavailable"}', { status: 503 });
      if (
        url.endsWith("/api/v1/audio-plugins") &&
        sessionStorage.catalogBlocked === "yes"
      )
        return new Response("Service restarting", { status: 503 });
      if (url.includes("/admissions")) window.admissions++;
      if (!url.includes("/audio-plugins/") || !url.endsWith(".wasm"))
        return original(...args);
      window.modelRequests++;
      while (!window.pluginGate) await new Promise((r) => setTimeout(r, 25));
      if (window.pluginFail) throw new TypeError("Test model download failed");
      const response = await original(...args);
      const bytes = new Uint8Array(await response.arrayBuffer());
      let offset = 0;
      return new Response(
        new ReadableStream({
          async pull(controller) {
            await new Promise((r) => setTimeout(r, 120));
            if (offset >= bytes.length) return controller.close();
            controller.enqueue(bytes.slice(offset, (offset += 21)));
          },
        }),
        { status: response.status, headers: response.headers },
      );
    };
  });
  await page.reload();
  await page.getByRole("button", { name: "Add server", exact: true }).click();
  await fillSignin(page, fixtures.rtc.url, "owner");
  await page.getByLabel("Password", { exact: true }).fill(fixtures.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".connection")).toHaveText("Connected");
  const modal = page.getByRole("dialog", { name: "Prepare voice call" });
  const join = async () => {
    await page
      .getByRole("button", { name: "lounge Join", exact: true })
      .click();
    await expect(modal).toBeVisible();
    await expect(
      modal.getByRole("button", { name: "Join", exact: true }),
    ).toBeDisabled();
  };
  const connected = () =>
    expect(page.locator(".call-panel header small")).toContainText(
      "1 in the room",
    );
  const leave = async () => {
    await page
      .locator(".call-dock")
      .getByRole("button", { name: "Leave call", exact: true })
      .click();
    await expect(page.locator(".call-dock")).toHaveCount(0);
  };
  const cold = async () => {
    await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open("haunt-audio-plugins-v1", 2);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction(["assets", "assetInfo"], "readwrite");
        tx.objectStore("assets").clear();
        tx.objectStore("assetInfo").clear();
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    });
    await page.reload();
    await page
      .getByRole("button", { name: `Open ${fixtures.rtc.name}`, exact: true })
      .click();
    await expect(page.locator(".connection")).toHaveText("Connected");
  };
  await join();
  assert.equal(await page.evaluate(() => window.admissions), 0);
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(modal).toHaveCount(0);
  assert.equal(await page.evaluate(() => window.admissions), 0);
  await join();
  await modal.getByRole("button", { name: "Join now", exact: true }).click();
  await connected();
  await expect(page.locator(".call-plugin-notice")).toContainText(
    "unfiltered audio",
  );
  const track = await page.evaluate(() => window.publishedAudio[0]);
  assert(track);
  await page.evaluate(() => {
    window.pluginFail = true;
    window.pluginGate = true;
  });
  await expect(page.locator(".call-plugin-notice")).toHaveAttribute(
    "data-state",
    "fallback",
  );
  await expect(page.locator(".call-plugin-notice")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Account settings", exact: true })
    .click();
  await expect
    .poll(() =>
      page
        .locator(".call-plugin-notice")
        .evaluate((el) => !!el.closest("dialog[open]")),
    )
    .toBe(true);
  await page.evaluate(() => {
    window.pluginFail = false;
  });
  await page
    .getByRole("button", { name: "Retry noise suppression", exact: true })
    .click();
  await expect
    .poll(() =>
      page
        .locator(".call-plugin-notice progress")
        .evaluate((el) => el.value > 0 && el.value < el.max)
        .catch(() => false),
    )
    .toBe(true);
  await expect(page.locator(".call-plugin-notice")).toHaveAttribute(
    "data-state",
    "active",
  );
  await page
    .getByRole("button", { name: "Dismiss audio plugin notice", exact: true })
    .click();
  await expect(page.locator(".call-plugin-notice")).toHaveCount(0);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  assert.deepEqual(
    await page.evaluate(() => window.publishedAudio),
    [track],
    "Activating the filter keeps the published track",
  );
  await page.screenshot({ path: `test-results/plugin-join-now-${label}.png` });
  await leave();
  // A new renderer restores catalog + verified bytes even while the plugin
  // endpoint restarts. A broken health route is advisory and never gates login.
  await page.evaluate(() => {
    sessionStorage.catalogBlocked = "yes";
    sessionStorage.readinessBlocked = "yes";
  });
  await page.reload();
  await page
    .getByRole("button", { name: `Open ${fixtures.rtc.name}`, exact: true })
    .click();
  await expect(page.locator(".connection")).toHaveText("Connected");
  await page.getByRole("button", { name: "lounge Join", exact: true }).click();
  if (await modal.isVisible()) {
    await expect(
      modal.getByRole("button", { name: "Join", exact: true }),
    ).toBeEnabled();
    await modal.getByRole("button", { name: "Join", exact: true }).click();
  }
  await connected();
  await expect(page.locator(".call-panel")).toHaveAttribute(
    "data-noise-suppression",
    "active",
  );
  assert.equal(
    await page.evaluate(() => window.modelRequests),
    0,
    "Restart reuses verified cached model with zero downloads",
  );
  await leave();
  // A processor failure is different from a download failure. Refreshing its
  // already-cached catalog must restart that processor without changing options.
  await page.evaluate(() => {
    window.failPluginWorker = true;
  });
  await page.getByRole("button", { name: "lounge Join", exact: true }).click();
  await connected();
  await expect(page.locator(".call-panel")).toHaveAttribute(
    "data-noise-suppression",
    "fallback",
  );
  await page
    .getByRole("button", { name: "Account settings", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Server audio plugins", exact: true })
    .click();
  await expect(page.locator(".call-panel")).toHaveAttribute(
    "data-noise-suppression",
    "active",
  );
  await expect(
    page.locator('.call-plugin-notice[data-state="fallback"]'),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Dismiss audio plugin notice", exact: true })
    .click();
  await expect(page.locator(".call-plugin-notice")).toHaveCount(0);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  assert.equal(await page.evaluate(() => window.modelRequests), 0);
  await leave();
  await page.evaluate(() => {
    delete sessionStorage.catalogBlocked;
    delete sessionStorage.readinessBlocked;
  });
  await cold();
  await join();
  await page.evaluate(() => {
    window.pluginGate = true;
  });
  await expect(
    modal.getByRole("button", { name: "Join", exact: true }),
  ).toBeEnabled();
  assert.equal(
    await page.evaluate(() => window.admissions),
    0,
    "Ready alone never joins after cancellation or waiting",
  );
  await page.screenshot({
    path: `test-results/plugin-join-ready-${label}.png`,
  });
  await modal.getByRole("button", { name: "Join", exact: true }).click();
  await connected();
  await expect(page.locator(".call-panel")).toHaveAttribute(
    "data-noise-suppression",
    "active",
  );
  await leave();
  await cold();
  await join();
  await modal.getByRole("button", { name: "Join now", exact: true }).click();
  await connected();
  await leave();
  const admissions = await page.evaluate(() => window.admissions);
  await page.evaluate(() => {
    window.pluginGate = true;
  });
  // Settings expose completion after leaving without causing a late call join.
  await page
    .getByRole("button", { name: "Account settings", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Server audio plugins", exact: true })
    .click();
  await expect(page.locator(".plugin-download-file").first()).toHaveAttribute(
    "data-phase",
    "ready",
  );
  assert.equal(await page.evaluate(() => window.admissions), admissions);
  await expect(page.locator(".call-dock")).toHaveCount(0);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await cold();
  await join();
  await modal.getByRole("button", { name: "Join now", exact: true }).click();
  await connected();
  await page
    .getByRole("button", { name: "Account settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Devices", exact: true }).click();
  await page.getByLabel("Noise suppression", { exact: true }).uncheck();
  await page.evaluate(() => {
    window.pluginGate = true;
  });
  await page
    .getByRole("button", { name: "Server audio plugins", exact: true })
    .click();
  await expect(page.locator(".plugin-download-file").first()).toHaveAttribute(
    "data-phase",
    "ready",
  );
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator(".call-panel")).toHaveAttribute(
    "data-noise-suppression",
    "off",
  );
  await leave();
  assert.deepEqual(errors, []);
  console.log(
    `PASS ${label}: download progress, cancel, join now, retry failure, automatic enable with stable track, wait then join, leave while downloading, explicit opt-out preserved`,
  );
}
