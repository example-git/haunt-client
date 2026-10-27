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
let metadataDelay = 0;
try {
  await server.listen();
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    headless: true,
    ignoreDefaultArgs: ["--hide-scrollbars"],
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
      if (metadataDelay)
        await new Promise((resolve) => setTimeout(resolve, metadataDelay));
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
  await list.evaluate((node) => {
    const descriptor = Object.getOwnPropertyDescriptor(
      Element.prototype,
      "scrollTop",
    );
    window.scrollWrites = [];
    Object.defineProperty(node, "scrollTop", {
      configurable: true,
      get() {
        return descriptor.get.call(this);
      },
      set(value) {
        window.scrollWrites.push({ before: descriptor.get.call(this), value });
        descriptor.set.call(this, value);
      },
    });
    window.scrollFrames = [];
    window.recordScroll = true;
    const record = () => {
      if (!window.recordScroll) return;
      const bounds = node.getBoundingClientRect();
      const row = [...node.querySelectorAll("[data-message-row]")].find(
        (row) => {
          const rect = row.getBoundingClientRect();
          return rect.bottom > bounds.top && rect.top < bounds.bottom;
        },
      );
      window.scrollFrames.push(
        row
          ? {
              seq: Number(row.dataset.messageRow.split("-")[1]),
              top: row.getBoundingClientRect().top - bounds.top,
            }
          : null,
      );
      requestAnimationFrame(record);
    };
    requestAnimationFrame(record);
  });
  const requestsBeforeWheel = requested.size;
  metadataDelay = 150;
  const bounds = await list.boundingBox();
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  for (let step = 0; step < 40; step++) {
    await page.mouse.wheel(0, -110);
    await settle();
  }
  await expect(page.locator(".embed-loading")).toHaveCount(0);
  const wheel = await page.evaluate(() => {
    window.recordScroll = false;
    return { writes: window.scrollWrites, frames: window.scrollFrames };
  });
  assert.deepEqual(
    wheel.writes,
    [],
    "Rendering must not write scrollTop during wheel input",
  );
  assert.ok(wheel.frames.length > 40);
  assert.ok(
    wheel.frames.every(Boolean),
    "Prepared rows must cover every visible frame",
  );
  assert.ok(
    wheel.frames.at(-1).seq < wheel.frames[0].seq - 5,
    "Wheel input must traverse history",
  );
  for (let index = 1; index < wheel.frames.length; index++) {
    const before = wheel.frames[index - 1],
      after = wheel.frames[index];
    assert.ok(
      after.seq <= before.seq,
      `Upward wheel reversed from ${before.seq} to ${after.seq}`,
    );
    if (after.seq === before.seq)
      assert.ok(
        after.top >= before.top - 2,
        `Wheel moved backwards by ${before.top - after.top}px`,
      );
  }
  assert.ok(
    requested.size > requestsBeforeWheel,
    "New embed metadata must load during scrolling",
  );
  const buffer = await list.evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    const rows = [...node.querySelectorAll("[data-message-row]")];
    return {
      above: bounds.top - rows[0].getBoundingClientRect().top,
      below: rows.at(-1).getBoundingClientRect().bottom - bounds.bottom,
      height: node.clientHeight,
      rows: rows.length,
    };
  });
  assert.ok(buffer.above >= buffer.height * 2, JSON.stringify(buffer));
  assert.ok(buffer.below >= buffer.height * 2, JSON.stringify(buffer));
  report.push({
    check: "continuous wheel with delayed embeds",
    frames: wheel.frames.length,
    writes: wheel.writes.length,
    newRequests: requested.size - requestsBeforeWheel,
    buffer,
  });
  metadataDelay = 0;
  await latest.click();
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
  await list.focus();
  await page.keyboard.press("Home");
  await expect
    .poll(() => list.evaluate((node) => node.scrollTop))
    .toBeLessThan(1);
  await settle();
  const firstId = await page.evaluate(
    async () =>
      (await window.scrollClient.messages("channel", { limit: 100 }))[0].id,
  );
  await expect(
    page.locator(`[data-message-row="${firstId}"]`),
  ).toBeInViewport();
  await page.mouse.move(bounds.x + 200, bounds.y + 200);
  await page.mouse.wheel(0, -5000);
  await settle();
  assert.equal(await list.evaluate((node) => node.scrollTop), 0);
  await expect(latest).toBeVisible();
  await list.evaluate(() => {
    window.scrollWrites = [];
  });
  await page.keyboard.press("PageDown");
  await expect
    .poll(() => list.evaluate((node) => node.scrollTop))
    .toBeGreaterThan(100);
  await settle();
  const keyboardWrites = await page.evaluate(() => window.scrollWrites);
  assert.deepEqual(keyboardWrites, [], "Page navigation must remain native");
  await list.focus();
  await page.keyboard.press("End");
  await expect
    .poll(() =>
      list.evaluate(
        (node) => node.scrollHeight - node.scrollTop - node.clientHeight,
      ),
    )
    .toBeLessThan(2);
  await expect(page.locator("#message-message-502")).toBeInViewport();
  await expect(latest).toHaveCount(0);
  await page.mouse.wheel(0, 5000);
  await settle();
  assert.ok(
    await list.evaluate(
      (node) => node.scrollHeight - node.scrollTop - node.clientHeight < 2,
    ),
  );
  report.push({
    check: "native keyboard navigation and hard list boundaries",
    first: firstId,
    last: "message-502",
    keyboardWrites: keyboardWrites.length,
  });
  await page.keyboard.press("Home");
  await expect(latest).toBeVisible();
  await latest.click();
  await settle();
  assert.ok(
    await list.evaluate(
      (node) => node.scrollHeight - node.scrollTop - node.clientHeight < 2,
    ),
    "Return to latest must complete without scrolling animation",
  );
  await expect(page.locator("#message-message-502")).toBeInViewport();
  report.push({ check: "instant return from oldest loaded message" });
  const scrollbar = await list.evaluate((node) => {
    window.scrollWrites = [];
    const bounds = node.getBoundingClientRect();
    return {
      right: bounds.right,
      bottom: bounds.bottom,
      width: node.offsetWidth - node.clientWidth,
      top: node.scrollTop,
    };
  });
  assert.ok(
    scrollbar.width > 0,
    "Native scrollbar must be present for the drag check",
  );
  await page.mouse.move(
    scrollbar.right - scrollbar.width / 2,
    scrollbar.bottom - 30,
  );
  await page.mouse.down();
  await page.mouse.move(
    scrollbar.right - scrollbar.width / 2,
    scrollbar.bottom - 150,
    { steps: 12 },
  );
  await page.mouse.up();
  await settle();
  const dragged = await list.evaluate((node) => ({
    top: node.scrollTop,
    writes: window.scrollWrites,
  }));
  assert.ok(
    dragged.top < scrollbar.top - 200,
    JSON.stringify({ scrollbar, dragged }),
  );
  assert.deepEqual(
    dragged.writes,
    [],
    "Rendering must not write scrollTop during scrollbar dragging",
  );
  await expect(latest).toBeVisible();
  report.push({
    check: "native scrollbar drag",
    distance: scrollbar.top - dragged.top,
    writes: dragged.writes.length,
  });
  await latest.click();
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
