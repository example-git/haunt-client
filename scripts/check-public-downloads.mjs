import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash, verify } from "node:crypto";
import { expect } from "@playwright/test";
import { fillSignin } from "./signin-fields.mjs";

export async function checkPublicDownloads(browser, fixtures) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  try {
    const fixture = fixtures.rtc,
      errors = [],
      requests = [];
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) =>
      requests.push({
        url: request.url(),
        authorization: !!request.headers().authorization,
      }),
    );
    const response = await fetch(
      fixture.url + "/api/v1/client-updates/installers",
    );
    assert.equal(response.status, 200);
    const metadata = await response.json();
    const config = JSON.parse(await fs.readFile("static/updates.json", "utf8"));
    const payloadBytes = Buffer.from(metadata.manifest.payload, "base64");
    assert.ok(
      verify(
        null,
        payloadBytes,
        config.publicKey,
        Buffer.from(metadata.manifest.signature, "base64"),
      ),
    );
    const payload = JSON.parse(payloadBytes),
      installer = payload.targets["linux-x64"].installer;
    const address = `https://github.com/${config.repository}/releases/download/client-v${payload.version}/${installer.file}`;
    assert.equal(metadata.downloads["linux-x64"], address);
    const legacy = await fetch(
      fixture.url +
        `/api/v1/client-updates/client-v${payload.version}/${installer.file}`,
      { redirect: "manual" },
    );
    assert.equal(legacy.status, 302);
    assert.equal(legacy.headers.get("location"), address);
    assert.ok(Number(legacy.headers.get("content-length")) < 1024);
    await page.goto(fixture.url);
    await page.getByRole("button", { name: "Add server", exact: true }).click();
    await fillSignin(page, fixture.url, "owner");
    await page.getByLabel("Password", { exact: true }).fill(fixtures.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator(".connection")).toHaveText("Connected");
    const link = page.getByRole("link", { name: "Desktop app" });
    await expect(link).toHaveAttribute("href", address);
    const headerContrast = async () => {
      const colors = await link.evaluate((el) => ({
        link: getComputedStyle(el).color,
        header: getComputedStyle(el.closest(".app-titlebar")).color,
      }));
      assert.equal(colors.link, colors.header);
    };
    await headerContrast();
    await page.screenshot({ path: "test-results/public-downloads.png" });
    await page
      .getByRole("button", { name: "Account settings", exact: true })
      .click();
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await page.getByRole("button", { name: "Rose Slate", exact: true }).click();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await headerContrast();
    await page.screenshot({ path: "test-results/public-downloads-rose.png" });
    const downloading = page.waitForEvent("download", { timeout: 60000 });
    await link.click();
    const download = await downloading;
    assert.equal(download.suggestedFilename(), installer.file);
    const filename = await download.path();
    assert.equal(await download.failure(), null);
    assert.equal((await fs.stat(filename)).size, installer.size);
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(filename)) hash.update(chunk);
    assert.equal(hash.digest("hex"), installer.sha256);
    await download.delete();
    const metadataRequests = requests.filter((r) =>
      r.url.endsWith("/client-updates/installers"),
    );
    assert.ok(metadataRequests.length > 0);
    assert.ok(metadataRequests.every((r) => !r.authorization));
    assert.ok(requests.some((r) => r.url === address && !r.authorization));
    assert.ok(
      requests
        .filter((r) => new URL(r.url).origin !== new URL(fixture.url).origin)
        .every((r) => !r.authorization),
    );
    assert.ok(
      !requests.some(
        (r) =>
          r.url.startsWith(fixture.url + "/api/v1/client-updates/") &&
          !r.url.endsWith("installers"),
      ),
    );
    assert.deepEqual(errors, []);
    await fs.writeFile(
      "test-results/public-downloads.json",
      JSON.stringify(
        {
          version: payload.version,
          download: address,
          size: installer.size,
          sha256: installer.sha256,
          signatureVerified: true,
          downloadHashVerified: true,
          anonymousMetadata: true,
          noCredentialsToGitHub: true,
          legacyRedirect: true,
          noArtifactProxy: true,
          darkAndPastelHeaderContrast: true,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(
      "Production browser: signed metadata, anonymous direct GitHub installer click and exact file hash, and legacy updater redirect passed.",
    );
  } finally {
    await context.close();
  }
}
