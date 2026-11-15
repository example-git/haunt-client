import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const project = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(project, "test-results/reply-navigation");
await fs.mkdir(output, { recursive: true });
const server = await createServer({
  configFile: path.join(project, "vite.config.ts"),
  plugins: [
    {
      name: "reply-navigation-check",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url !== "/__reply") return next();
          response.setHeader("Content-Type", "text/html");
          response.end("<!doctype html><html><body></body></html>");
        });
      },
    },
  ],
  server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false },
});
let browser;
const checked = [],
  errors = [];
try {
  await server.listen();
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1100, height: 900 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/__reply`,
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
          instance_id: "reply-navigation",
          capabilities: [],
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
    const messages = Array.from({ length: 106 }, (_, index) => ({
      id: `message-${index + 1}`,
      conversation_id: "channel",
      author_id: "owner",
      body:
        index === 0
          ? "Original archive message"
          : `Archive message ${index + 1}`,
      seq: index + 1,
      created_at: new Date(1700000000000 + index * 60000).toISOString(),
      attachment_ids: [],
      deleted: false,
      ...(index === 105 ? { reply_to_id: "message-1" } : {}),
    }));
    await store.merge(client.scope, messages);
    window.replyFixture = { client, store, messages };
    mount(client, "channel");
  }, project);
  const preview = page.locator(".message-reply-reference");
  const target = page.locator("#message-message-1");
  const latest = page.getByRole("button", {
    name: "Return to latest messages",
    exact: true,
  });
  await expect(preview).toContainText("Original archive message");
  await preview.click();
  await expect(target).toHaveClass(/highlighted/);
  await expect(target).toBeInViewport();
  checked.push("A loaded reply navigates to and highlights its original");
  await latest.click();
  await expect(preview).toContainText("Original archive message");
  await page.evaluate(() => {
    const fixture = window.replyFixture;
    fixture.read = fixture.store.message.bind(fixture.store);
    fixture.pending = [];
    fixture.store.message = async (...args) => {
      if (args[2] === "message-1")
        await new Promise((resolve) => fixture.pending.push(resolve));
      return fixture.read(...args);
    };
    fixture.client.changedMessages("channel");
  });
  await expect(preview).toHaveText("Load original message");
  await preview.click();
  await expect
    .poll(() => page.evaluate(() => window.replyFixture.pending.length))
    .toBeGreaterThanOrEqual(2);
  await page.evaluate(() => {
    const fixture = window.replyFixture;
    fixture.store.message = fixture.read;
    for (const resolve of fixture.pending) resolve();
  });
  await expect(target).toHaveClass(/highlighted/);
  await expect(target).toBeInViewport();
  checked.push(
    "A reply click during preview refresh loads and highlights its original",
  );

  await latest.click();
  await expect(preview).toContainText("Original archive message");
  await page.evaluate(async () => {
    const { client, store, messages } = window.replyFixture;
    await store.merge(client.scope, [
      { ...messages[0], deleted: true, body: "" },
    ]);
    client.changedMessages("channel");
  });
  await expect(preview).toContainText("Message deleted");
  await preview.click();
  await expect(target).toHaveClass(/highlighted/);
  await expect(target.locator(".deleted")).toHaveText("Message deleted");
  checked.push(
    "A deleted original remains navigable and displays its tombstone",
  );

  await latest.click();
  await page.evaluate(async () => {
    const { client, store, messages } = window.replyFixture;
    await store.clear(client.scope);
    await store.merge(client.scope, messages.slice(1));
    client.changedMessages("channel");
  });
  await expect(preview).toHaveText("Load original message");
  await preview.click();
  await expect(
    page.getByText(
      "This message is unavailable or you no longer have access to it.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(target).toHaveCount(0);
  checked.push(
    "An unavailable original reports the navigation error without a false target",
  );
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(output, "report.json"),
    JSON.stringify({ checked }, null, 2),
  );
  console.log(`PASS reply navigation: ${checked.length} scenarios`);
} finally {
  await browser?.close();
  await server.close();
}
