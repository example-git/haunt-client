import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { createServer } from "node:http";

const videoBytes = Buffer.alloc(9 * 1024 * 1024 + 7, 0x61);

export async function desktopDownloadFixture(desktop) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "haunt-desktop-downloads-"),
  );
  const server = createServer((request, response) => {
    const match = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range || "");
    if (!match) {
      response.writeHead(400).end();
      return;
    }
    let offset = Number(match[1]);
    const end = Math.min(Number(match[2]), videoBytes.length - 1);
    response.writeHead(206, {
      "Content-Type": "video/mp4",
      "Content-Range": `bytes ${offset}-${end}/${videoBytes.length}`,
    });
    const timer = setInterval(() => {
      const next = Math.min(offset + 256 * 1024, end + 1);
      response.write(videoBytes.subarray(offset, next));
      offset = next;
      if (offset > end) {
        clearInterval(timer);
        response.end();
      }
    }, 30);
    response.on("close", () => clearInterval(timer));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const video = `http://127.0.0.1:${server.address().port}/api/v1/conversations/${crypto.randomUUID()}/messages/${crypto.randomUUID()}/embeds/video?ticket=${"a".repeat(48)}`;
  await desktop.evaluate(({ BrowserWindow, dialog, shell }, directory) => {
    const session = BrowserWindow.getAllWindows()[0].webContents.session;
    session.on("will-download", (_event, item) => {
      const name = item.getSaveDialogOptions().defaultPath.split("/").pop();
      item.setSavePath(directory + "/" + name);
    });
    dialog.showSaveDialog = async (_parent, options) => ({
      canceled: false,
      filePath: directory + "/" + options.defaultPath.split("/").pop(),
    });
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [directory],
    });
    globalThis.revealedDownloads = [];
    shell.showItemInFolder = (file) => globalThis.revealedDownloads.push(file);
    shell.openPath = async (file) => {
      globalThis.revealedDownloads.push(file);
      return "";
    };
  }, directory);
  return {
    directory,
    video,
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await fs.rm(directory, { recursive: true, force: true });
    },
  };
}

export async function checkDesktopTools(
  page,
  desktop,
  downloadFixture,
  fixtures,
) {
  const { directory } = downloadFixture;
  await page.setViewportSize({ width: 1280, height: 900 });
  const marker = "Desktop archive worker fixture";
  await page.getByLabel("Message", { exact: true }).fill(marker);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const row = page
    .locator(".message")
    .filter({ has: page.locator(".message-body", { hasText: marker }) });
  await expect(row).toBeVisible();
  const id = (await row.getAttribute("id")).slice(8);
  await row.hover();
  await row
    .getByRole("button", { name: "Message options", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Copy message link", exact: true })
    .click();
  const link = await desktop.evaluate(({ clipboard }) => clipboard.readText());
  assert.equal(new URL(link).searchParams.get("message"), id);
  for (let attempt = 0; attempt < 5; attempt++) {
    await page
      .getByRole("button", {
        name: "Direct messages and notifications",
        exact: true,
      })
      .click();
    await desktop.evaluate(
      ({ app }, link) => app.emit("second-instance", {}, ["haunt", link]),
      link,
    );
    await expect(page.locator(`#message-${id}`)).toHaveClass(/highlight/);
    await expect(page.locator(`#message-${id}`)).not.toHaveClass(/highlight/);
    await expect(page.locator(`#message-${id}`)).toBeVisible();
  }
  const latest = page.getByRole("button", {
    name: "Return to latest messages",
    exact: true,
  });
  if (await latest.isVisible()) await latest.click();
  await page.getByLabel("Message", { exact: true }).fill(link);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator(`#message-${id}`)).not.toHaveClass(/highlight/);
  await page
    .locator(".message-body")
    .getByRole("link", { name: link, exact: true })
    .click();
  await expect(page.locator(`#message-${id}`)).toHaveClass(/highlight/);
  await page
    .getByRole("button", { name: "Search downloaded messages", exact: true })
    .click();
  await page
    .getByLabel("Search downloaded messages", { exact: true })
    .fill(marker);
  await expect(page.locator(".history-search-results")).toContainText(marker);
  console.log("PASS desktop message links and local worker search");
  let workers = 0;
  const activeWorkers = new Set();
  page.on("worker", (worker) => {
    workers++;
    activeWorkers.add(worker);
    worker.on("close", () => activeWorkers.delete(worker));
  });
  await page
    .getByRole("button", { name: "Account settings", exact: true })
    .click();
  await page
    .getByRole("button", { name: "History & downloads", exact: true })
    .click();
  const transfer = await page.evaluate(
    (url) => window.hauntDesktop.downloads.start(url, "range-fixture.mp4"),
    downloadFixture.video,
  );
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.hauntDesktop.downloads.list())).find(
          (item) => item.id === transfer,
        )?.received,
    )
    .toBeGreaterThan(0);
  const active = page.getByRole("article", {
    name: "Download range-fixture.mp4",
    exact: true,
  });
  await active
    .getByRole("button", { name: "Cancel download", exact: true })
    .click();
  await expect(active).toContainText("cancelled");
  await expect
    .poll(async () =>
      (await fs.readdir(directory)).some((name) => name.endsWith(".part")),
    )
    .toBe(false);
  await active
    .getByRole("button", { name: "Retry download", exact: true })
    .click();
  await expect
    .poll(async () =>
      (await page.evaluate(() => window.hauntDesktop.downloads.list())).some(
        (item) =>
          item.name === "range-fixture.mp4" && item.state === "completed",
      ),
    )
    .toBe(true);
  assert(
    (await fs.readFile(path.join(directory, "range-fixture.mp4"))).equals(
      videoBytes,
    ),
  );
  await page
    .getByRole("button", { name: "Choose download folder", exact: true })
    .click();
  await expect(
    page.getByText("Download folder: " + directory, { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Media cache budget (MiB)").fill("32");
  await page
    .getByRole("button", { name: "Save cache budget", exact: true })
    .click();
  await expect(
    page.getByText("Media cache budget saved.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear media cache", exact: true })
    .click();
  await expect(
    page.getByText("Media cache cleared.", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/desktop-storage.png" });
  console.log(
    "PASS desktop ranged download progress/cancel/retry/complete bytes and cache settings",
  );
  await page
    .getByRole("button", { name: "Backup & restore", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Browse saved text", exact: true })
    .click();
  await expect(page.locator(".text-archive-backups")).toContainText(marker);
  await page
    .getByRole("button", { name: "Export message text", exact: true })
    .click();
  await expect
    .poll(async () =>
      (await page.evaluate(() => window.hauntDesktop.downloads.list())).some(
        (item) => item.name.endsWith(".jsonl.gz") && item.state === "completed",
      ),
    )
    .toBe(true);
  const exported = (
    await page.evaluate(() => window.hauntDesktop.downloads.list())
  ).find(
    (item) => item.name.endsWith(".jsonl.gz") && item.state === "completed",
  );
  assert(exported.filePath.startsWith(directory + "/"));
  const bytes = await fs.readFile(exported.filePath);
  assert(gunzipSync(bytes).toString().includes(marker));
  assert(workers > 0, "Archive operations did not use a worker");
  await page
    .getByLabel("Message text archive file")
    .setInputFiles(exported.filePath);
  await page
    .getByRole("button", { name: "Import message text", exact: true })
    .click();
  await expect(
    page.getByText(
      "Text restored to the private archive. Live chat is unchanged.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/desktop-archive.png" });
  const records = gunzipSync(bytes).toString().trim().split("\n");
  const template = JSON.parse(records[1]);
  const large = [records[0]];
  for (let index = 0; index < 30000; index++)
    large.push(
      JSON.stringify({
        ...template,
        message: {
          ...template.message,
          id: crypto.randomUUID(),
          seq: 1000000000 + index,
          body: "Archive cancellation fixture ".repeat(100),
        },
      }),
    );
  await page.getByLabel("Message text archive file").setInputFiles({
    name: "cancel.jsonl.gz",
    mimeType: "application/gzip",
    buffer: gzipSync(large.join("\n") + "\n"),
  });
  await page
    .getByRole("button", { name: "Import message text", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Cancel archive operation", exact: true })
    .click();
  await expect(
    page.getByText("Archive operation cancelled.", { exact: true }),
  ).toBeVisible();
  await expect.poll(() => activeWorkers.size).toBe(0);
  await page
    .getByRole("button", { name: "History & downloads", exact: true })
    .click();
  const download = page.getByRole("article", {
    name: `Download ${exported.name}`,
    exact: true,
  });
  await download
    .getByRole("button", { name: "Show in folder", exact: true })
    .click();
  assert(
    (await desktop.evaluate(() => globalThis.revealedDownloads)).includes(
      exported.filePath,
    ),
  );
  await download
    .getByRole("button", { name: "Remove from list", exact: true })
    .click();
  assert((await fs.readFile(exported.filePath)).equals(bytes));
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await desktop.evaluate(
    ({ app }, server) =>
      app.emit("second-instance", {}, [
        "haunt",
        `haunt://open?server=${encodeURIComponent(server)}&channel=invalid`,
      ]),
    fixtures.rtc.url,
  );
  await expect(
    page.getByText("Invalid channel or message in Haunt link.", {
      exact: true,
    }),
  ).toBeVisible();
  console.log(
    "PASS desktop controls: native downloads/save paths/reveal, archive worker export and import, decompressed text, cache clearing preserves archives, worker search, warm message deep link and invalid-link feedback.",
  );
}
