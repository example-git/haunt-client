import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const project = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(project, "test-results/message-scroll");
await fs.mkdir(output, { recursive: true });
const server = await createServer({
  configFile: path.join(project, "vite.config.ts"),
  plugins: [
    {
      name: "scroll-check",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url !== "/__scroll") return next();
          res.setHeader("Content-Type", "text/html");
          res.end("<!doctype html><html><body></body></html>");
        });
      },
    },
  ],
  server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false },
});
let browser, page;
const report = [];
const errors = [];
let releaseMetadata;
const metadataReady = new Promise((resolve) => {
  releaseMetadata = resolve;
});
let releaseImages;
const imagesReady = new Promise((resolve) => {
  releaseImages = resolve;
});
const requested = new Set();
let arriving = [];
try {
  await server.listen();
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    headless: true,
  });
  page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const match = /\/messages\/message-(\d+)\/embeds$/.exec(url.pathname);
    if (match) {
      const seq = Number(match[1]);
      requested.add(seq);
      await metadataReady;
      await route
        .fulfill({
          json: {
            embeds: [
              {
                index: 0,
                url: `https://x.com/example/status/${seq}`,
                kind: "post",
                provider: "x",
                image: true,
                title: `Post ${seq}`,
                description: "Expanded preview text. ".repeat((seq % 7) + 1),
                media: [
                  {
                    kind: "image",
                    width: seq % 2 ? 400 : 900,
                    height: seq % 2 ? 800 : 500,
                  },
                ],
              },
            ],
          },
        })
        .catch(() => {});
    } else if (url.pathname.endsWith("/embeds/image")) {
      await imagesReady;
      await route
        .fulfill({
          contentType: "image/png",
          body: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvZkAAAAASUVORK5CYII=",
            "base64",
          ),
        })
        .catch(() => {});
    } else if (url.pathname.endsWith("/messages")) {
      await route.fulfill({
        json: {
          messages: arriving.filter(
            (message) =>
              message.seq > Number(url.searchParams.get("after") ?? 0),
          ),
          has_more: false,
          last_seq: arriving.at(-1)?.seq ?? 500,
          pruned_through: 0,
          event_cursor: 0,
          gap: false,
        },
      });
    } else await route.fulfill({ status: 404, json: { error: "not_found" } });
  });
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/__scroll`,
  );
  await page.evaluate(async (project) => {
    const { InstanceClient, MemoryStore, MemoryVault } = await import(
      `/@fs/${project}/packages/core/src/index.ts`
    );
    const { mount } = await import(
      `/@fs/${project}/scripts/history-scale-ui.tsx`
    );
    const store = new MemoryStore();
    const client = new InstanceClient(
      {
        origin: location.origin,
        instance: {
          instance_id: "scroll",
          capabilities: ["messages.embeds"],
          limits: {},
        },
        login: { token: "A".repeat(43), user: { id: "owner" } },
      },
      {
        fetch: (...args) => fetch(...args),
        randomUUID: () => crypto.randomUUID(),
        socket: (url) => new WebSocket(url),
      },
      store,
      new MemoryVault(),
    );
    const messages = Array.from({ length: 500 }, (_, index) => ({
      id: `message-${index + 1}`,
      conversation_id: "channel",
      author_id: "owner",
      body:
        `Archive item ${index + 1}. ` +
        "Message text. ".repeat(index % 9) +
        (index % 3 === 0 ? `https://x.com/example/status/${index + 1}` : ""),
      seq: index + 1,
      created_at: new Date(1700000000000 + index * 60000).toISOString(),
      attachment_ids: [],
      deleted: false,
    }));
    await store.merge(client.scope, messages);
    window.scrollClient = client;
    mount(client, "channel");
  }, project);
  const list = page.locator(".messages");
  const latest = page.getByRole("button", {
    name: "Return to latest messages",
    exact: true,
  });
  const settle = () =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  const anchor = () =>
    list.evaluate((node) => {
      const top = node.getBoundingClientRect().top;
      const row = [...node.querySelectorAll("[data-message-row]")].find(
        (row) =>
          row.getBoundingClientRect().bottom > top &&
          row.getBoundingClientRect().top < top + node.clientHeight,
      );
      return (
        row && {
          id: row.dataset.messageRow,
          top: row.getBoundingClientRect().top - top,
        }
      );
    });
  const assertAnchor = async (before, label) => {
    await settle();
    const after = await page
      .locator(`[data-message-row="${before.id}"]`)
      .evaluate(
        (row) =>
          new Promise((resolve) =>
            requestAnimationFrame(() =>
              setTimeout(
                () =>
                  resolve(
                    row.getBoundingClientRect().top -
                      row.closest(".messages").getBoundingClientRect().top,
                  ),
                0,
              ),
            ),
          ),
      );
    assert.ok(
      Math.abs(after - before.top) <= 2,
      `${label}: ${before.id} moved ${after - before.top}px`,
    );
    report.push({ check: label, drift: after - before.top });
  };
  await expect(page.locator("#message-message-500")).toBeInViewport();
  await expect.poll(() => requested.size).toBeGreaterThan(0);
  await list.evaluate((node) => {
    node.scrollTop -= 600;
  });
  await settle();
  const beforeMetadata = await anchor();
  assert.ok(beforeMetadata);
  await expect(latest).toBeVisible();
  releaseMetadata();
  await expect
    .poll(() => page.locator(".embed-card").count())
    .toBeGreaterThan(0);
  await expect(page.locator(".embed-loading")).toHaveCount(0);
  await assertAnchor(beforeMetadata, "delayed metadata above viewport");
  await expect(latest).toBeVisible();
  const beforeImages = await anchor();
  releaseImages();
  await expect
    .poll(() => page.locator(".embed-picture img").count())
    .toBeGreaterThan(0);
  await assertAnchor(beforeImages, "delayed image geometry");
  const prepared = await list.evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    return [...node.querySelectorAll(".embed-card")].filter((card) => {
      const r = card.getBoundingClientRect();
      return r.bottom < bounds.top || r.top > bounds.bottom;
    }).length;
  });
  assert.ok(prepared > 0, "Offscreen cards must already be expanded");
  report.push({
    check: "offscreen preparation",
    prepared,
    requests: requested.size,
  });
  const rowCount = await page.locator("[data-message-row]").count();
  assert.ok(rowCount < 100, `Bounded mounted rows: ${rowCount}`);
  await latest.click();
  await expect
    .poll(() =>
      list.evaluate(
        (node) => node.scrollHeight - node.scrollTop - node.clientHeight,
      ),
    )
    .toBeLessThan(2);
  await expect(latest).toHaveCount(0);
  for (let pass = 0; pass < 3; pass++) {
    await list.evaluate((node) => {
      node.scrollTop -= 1700;
    });
    await settle();
    await expect(page.locator(".embed-loading")).toHaveCount(0);
    const before = await anchor();
    await assertAnchor(before, `remount ${pass}`);
    await list.evaluate((node) => {
      node.scrollTop += 1400;
    });
    await settle();
  }
  await list.evaluate((node) => {
    node.scrollTop = 0;
  });
  await settle();
  const beforePrepend = await anchor();
  await page
    .getByRole("button", { name: "Show older messages", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Loading older messages…" }),
  ).toHaveCount(0);
  await assertAnchor(beforePrepend, "prepend downloaded history");
  await expect(
    page.locator('[data-message-row="message-400"] .embed-card'),
  ).toBeVisible();
  await expect(page.locator(".embed-loading")).toHaveCount(0);
  await assertAnchor(beforePrepend, "prepended embeds finish expanding");
  await page
    .getByRole("searchbox", { name: "Search downloaded messages", exact: true })
    .fill("Archive item 12");
  await page
    .locator(".history-search-results button")
    .filter({ hasText: "Archive item 12." })
    .click();
  await expect(page.locator("#message-message-12")).toBeInViewport();
  await latest.click();
  await expect(page.locator("#message-message-500")).toBeInViewport();
  await expect
    .poll(() =>
      list.evaluate(
        (node) => node.scrollHeight - node.scrollTop - node.clientHeight,
      ),
    )
    .toBeLessThan(2);
  report.push({
    check: "local search and return to current chat",
    latest: 500,
  });
  await page
    .getByRole("searchbox", { name: "Search downloaded messages", exact: true })
    .fill("Archive item 497");
  await page
    .locator(".history-search-results button")
    .filter({ hasText: "Archive item 497." })
    .click();
  await expect(page.locator("#message-message-497")).toBeInViewport();
  await latest.click();
  report.push({ check: "navigate to an already mounted message", target: 497 });
  await list.evaluate((node) => {
    node.scrollTop -= 1000;
  });
  await settle();
  const beforeResize = await anchor();
  await page.evaluate(() => {
    document.body.firstElementChild.style.width = "520px";
  });
  await assertAnchor(beforeResize, "width resize");
  await latest.click();
  const arrive = async (seq) => {
    arriving = await page.evaluate(async (seq) => {
      const client = window.scrollClient;
      const previous = (await client.messages("channel", { limit: 1 }))[0];
      return [
        {
          ...previous,
          id: `message-${seq}`,
          seq,
          body: `New live message ${seq}`,
          created_at: new Date().toISOString(),
        },
      ];
    }, seq);
    await page.evaluate(() => window.scrollClient.syncHistory("channel"));
  };
  await arrive(501);
  await expect(page.locator("#message-message-501")).toBeInViewport();
  await expect
    .poll(() =>
      list.evaluate(
        (node) => node.scrollHeight - node.scrollTop - node.clientHeight,
      ),
    )
    .toBeLessThan(2);
  await list.evaluate((node) => {
    node.scrollTop -= 900;
  });
  await settle();
  const beforeArrival = await anchor();
  await arrive(502);
  await assertAnchor(beforeArrival, "new arrival while reading history");
  await expect(latest).toBeVisible();
  await latest.click();
  await expect(page.locator("#message-message-502")).toBeInViewport();
  report.push({ check: "follow new messages only at latest", latest: 502 });
  await page
    .getByRole("searchbox", { name: "Search downloaded messages" })
    .focus();
  await expect
    .poll(() =>
      list.evaluate(
        (node) => node.scrollHeight - node.scrollTop - node.clientHeight,
      ),
    )
    .toBeLessThan(2);
  await page.screenshot({ path: path.join(output, "history.png") });
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(output, "report.json"),
    JSON.stringify({ report, errors }, null, 2) + "\n",
  );
  console.log(JSON.stringify({ report, errors }));
} catch (error) {
  await page
    ?.screenshot({ path: path.join(output, "failure.png") })
    .catch(() => {});
  console.error(JSON.stringify(report));
  throw error;
} finally {
  releaseMetadata();
  releaseImages();
  await browser?.close();
  await server.close();
}
