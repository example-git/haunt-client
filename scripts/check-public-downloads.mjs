import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { expect } from "@playwright/test";
import { fillSignin } from "./signin-fields.mjs";
const require = createRequire(import.meta.url);
const {
  verifyManifest,
  requestURL,
  response: updateResponse,
  download: updateDownload,
} = require("../apps/desktop/updates.cjs");

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
    const release = verifyManifest(metadata.manifest, config, "linux", "x64"),
      installer = release.installer;
    const address = `https://github.com/example-git/haunt/releases/download/v${release.version}/${installer.file}`;
    assert.equal(metadata.downloads["linux-x64"], address);
    const legacy = await fetch(
      fixture.url +
        `/api/v1/client-updates/client-v${release.version}/${installer.file}`,
      { redirect: "manual" },
    );
    assert.equal(legacy.status, 302);
    const location = requestURL(legacy.headers.get("location"), config);
    assert.ok(
      (await legacy.arrayBuffer()).byteLength <
        Buffer.byteLength(location.href) + 1024,
    );
    const temporary = await fs.mkdtemp(
      path.join(os.tmpdir(), "haunt-public-updater-"),
    );
    try {
      await updateDownload(
        await updateResponse(location.href, config),
        path.join(temporary, installer.file),
        installer,
      );
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
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
          version: release.version,
          download: address,
          size: installer.size,
          sha256: installer.sha256,
          signatureVerified: true,
          downloadHashVerified: true,
          anonymousMetadata: true,
          noCredentialsToGitHub: true,
          legacyRedirect: true,
          legacyDownloadHashVerified: true,
          noArtifactProxy: true,
          darkAndPastelHeaderContrast: true,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(
      "Production browser: signed metadata, anonymous installer click, and exact browser and legacy updater file hashes passed.",
    );
  } finally {
    await context.close();
  }
}
