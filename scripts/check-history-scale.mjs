import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";
import fs from "node:fs/promises";
import path from "node:path";

const fixture = JSON.parse(await fs.readFile(process.argv[2], "utf8"));
const project = process.cwd();
const server = await createServer({
  configFile: path.join(project, "vite.config.ts"),
  plugins: [
    {
      name: "history-scale-page",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url !== "/__scale") return next();
          response.setHeader("Content-Type", "text/html");
          response.end("<html><body>History scale check</body></html>");
        });
      },
    },
  ],
  server: {
    host: "127.0.0.1",
    port: 0,
    strictPort: false,
    hmr: false,
    proxy: {
      "/api": {
        target: fixture.origin,
        ws: true,
        changeOrigin: true,
        rewriteWsOrigin: true,
        configure(proxy) {
          proxy.on("proxyRes", (response, request) => {
            if (response.statusCode >= 400)
              console.error(
                "Scale proxy response",
                request.url,
                response.statusCode,
              );
          });
        },
      },
    },
  },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    headless: true,
  });
  const page = await browser.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") console.error(message.text());
  });
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/__scale`,
  );
  const results = await page.evaluate(
    async ({ fixture, project }) => {
      const { InstanceClient, MemoryVault } = await import(
        `/@fs/${project}/packages/core/src/index.ts`
      );
      const { IndexedDBStore } = await import(
        `/@fs/${project}/packages/browser/src/storage.ts`
      );
      const instance = await (await fetch("/api/v1/instance")).json();
      const store = new IndexedDBStore("scale-history");
      let requests = 0,
        bytes = 0;
      const client = new InstanceClient(
        { origin: location.origin, instance, login: fixture.login },
        {
          fetch: async (...args) => {
            requests++;
            const response = await fetch(...args);
            bytes += (await response.clone().arrayBuffer()).byteLength;
            return response;
          },
          socket: (url) => new WebSocket(url),
          randomUUID: () => crypto.randomUUID(),
        },
        store,
        new MemoryVault(),
      );
      const report = [];
      for (const state of ["cold", "warm"]) {
        requests = 0;
        bytes = 0;
        const started = performance.now();
        await client.syncHistory(fixture.conversation);
        const visible = await client.messages(fixture.conversation, {
          limit: 100,
        });
        if (visible.at(-1)?.seq !== fixture.messages)
          throw Error("Latest history was not available");
        report.push({
          state,
          messages: fixture.messages,
          requests,
          bytes,
          elapsed_ms: performance.now() - started,
          latest_seq: visible.at(-1).seq,
        });
      }
      window.scaleClient = client;
      window.scaleStore = store;
      window.scaleConversation = fixture.conversation;
      return report;
    },
    { fixture, project },
  );
  console.log(JSON.stringify({ client_history_scale: results }));
  if (process.env.HAUNT_SCALE_LATEST === "1" && fixture.messages === 10000) {
    await page.evaluate(async (project) => {
      const client = window.scaleClient;
      for (let before = 9901; before > 8701; before -= 100)
        await client.loadOlder(window.scaleConversation, before);
      const { mount } = await import(
        `/@fs/${project}/scripts/history-scale-ui.tsx`
      );
      mount(client, window.scaleConversation);
    }, project);
    await expect
      .poll(() => page.locator("[data-message-row]").count())
      .toBeGreaterThan(0);
    const settle = () => page.waitForTimeout(120);
    for (let i = 0; i < 10; i++) {
      await page.locator(".messages").evaluate((node) => {
        node.scrollTop = 0;
      });
      await settle();
      await page
        .getByRole("button", { name: "Show older messages", exact: true })
        .click();
      await expect(
        page.getByRole("button", {
          name: "Loading older messages…",
          exact: true,
        }),
      ).toHaveCount(0);
      await settle();
      if ((await page.locator("[data-message-row]").count()) > 80)
        throw Error("Unbounded mounted message rows");
    }
    await page.evaluate(() => {
      const client = window.scaleClient;
      const original = client.loadOlder.bind(client);
      client.loadOlder = (...args) => {
        window.olderFinished = (async () => {
          await new Promise((resolve) => {
            window.finishOlder = resolve;
          });
          return original(...args);
        })();
        return window.olderFinished;
      };
      window.restoreOlder = () => {
        client.loadOlder = original;
      };
    });
    await page.locator(".messages").evaluate((node) => {
      node.scrollTop = 0;
    });
    await settle();
    await page
      .getByRole("button", { name: "Show older messages", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Loading older messages…",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Return to latest messages", exact: true })
      .click();
    await settle();
    await page.evaluate(async () => {
      window.finishOlder();
      window.restoreOlder();
      await window.olderFinished;
      await window.scaleClient.messages(window.scaleConversation, {
        limit: 100,
      });
    });
    await settle();
    await expect(
      page.getByRole("button", { name: "Show newer messages", exact: true }),
    ).toHaveCount(0);
    const ui = await page.locator(".messages").evaluate((node) => ({
      rows: node.querySelectorAll("[data-message-row]").length,
      bottomGap: node.scrollHeight - node.scrollTop - node.clientHeight,
    }));
    if (ui.bottomGap > 120)
      throw Error(
        "Latest messages did not stay visible: " + JSON.stringify(ui),
      );
    if (process.env.HAUNT_SCALE_UI_ONLY === "1") {
      const reference = page.locator(".message-reply-reference").last();
      await expect(reference).toContainText("Scale history message");
      await reference.click();
      await expect(page.locator(".message.highlighted")).toHaveCount(1);
      await expect(
        page.locator(".message.highlighted .message-body"),
      ).toContainText("Scale history message");
      await page
        .getByRole("button", { name: "Return to latest messages", exact: true })
        .click();
      await expect(page.locator(".message-reply-reference")).toHaveCount(1);
      ui.replyNavigation = true;
    }
    console.log(JSON.stringify({ history_ui: ui }));
    let searchRequests = 0;
    const countSearch = (request) => {
      if (request.url().includes("/api/")) {
        searchRequests++;
        console.log("Local search request", request.method(), request.url());
      }
    };
    page.on("request", countSearch);
    await page
      .getByRole("searchbox", {
        name: "Search downloaded messages",
        exact: true,
      })
      .click();
    await page
      .getByRole("searchbox", {
        name: "Search downloaded messages",
        exact: true,
      })
      .fill("representative reference");
    await expect(page.locator(".history-search-results button")).toHaveCount(
      50,
    );
    await page.locator(".history-search-results button").first().click();
    await expect(page.locator(".message.highlighted")).toHaveCount(1);
    page.off("request", countSearch);
    if (searchRequests)
      throw Error(
        `Local search/navigation made ${searchRequests} API requests`,
      );
    await page.screenshot({ path: "test-results/history-local-search.png" });
    console.log(
      JSON.stringify({
        local_search: {
          results: 50,
          api_requests: searchRequests,
          navigation: true,
        },
      }),
    );
  }
  if (process.env.HAUNT_SCALE_LATEST === "1") {
    const connected = await page.evaluate(
      async ({ project, fixture }) => {
        const { InstanceClient, MemoryVault } = await import(
          `/@fs/${project}/packages/core/src/index.ts`
        );
        const { IndexedDBStore } = await import(
          `/@fs/${project}/packages/browser/src/storage.ts`
        );
        const instance = await (await fetch("/api/v1/instance")).json();
        const store = new IndexedDBStore("scale-connect");
        let requests = 0;
        const forward = [];
        const archiveTimes = [];
        const runtime = {
          fetch: async (...args) => {
            requests++;
            const query = new URL(
              args[0] instanceof Request ? args[0].url : args[0],
            ).searchParams;
            if (query.has("after")) {
              forward.push(Number(query.get("after")));
              archiveTimes.push(performance.now());
            }
            return fetch(...args);
          },
          socket: (url) => new WebSocket(url),
          randomUUID: () => crypto.randomUUID(),
        };
        const account = {
          origin: location.origin,
          instance,
          login: fixture.login,
        };
        const client = new InstanceClient(
          account,
          runtime,
          store,
          new MemoryVault(),
        );
        await client.selectConversation(fixture.conversation);
        const started = performance.now();
        await client.connect();
        const result = {
          elapsed_ms: performance.now() - started,
          status: client.snapshot.status,
          requests,
          latest_seq: (
            await client.messages(fixture.conversation, { limit: 1 })
          )[0]?.seq,
          unread:
            client.snapshot.readStates[fixture.conversation]?.unread_count,
          error: client.snapshot.error,
        };
        if (
          result.status !== "online" ||
          result.latest_seq !== fixture.messages ||
          result.unread !== fixture.messages
        ) {
          client.stop();
          throw Error("Full connection failed: " + JSON.stringify(result));
        }
        const archiveKey = JSON.stringify([
          client.scope,
          "history",
          fixture.conversation,
          "archive",
        ]);
        const waitFor = async (condition) => {
          const deadline = performance.now() + 10000;
          while (!(await condition())) {
            if (performance.now() > deadline)
              throw Error("Archive download did not advance");
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        };
        try {
          await waitFor(async () => (await store.cursor(archiveKey)) >= 200);
          if (
            archiveTimes.length >= 2 &&
            archiveTimes[1] - archiveTimes[0] < 1900
          )
            throw Error("Archive request budget was bypassed");
          const { mount } = await import(
            `/@fs/${project}/scripts/history-scale-ui.tsx`
          );
          mount(client, fixture.conversation);
          await waitFor(() =>
            [...document.querySelectorAll(".history-tools button")].some(
              (button) => button.textContent === "Pause archive",
            ),
          );
          [...document.querySelectorAll(".history-tools button")]
            .find((button) => button.textContent === "Pause archive")
            .click();
          await waitFor(
            () =>
              client.snapshot.archives?.[fixture.conversation]?.state ===
              "paused",
          );
          const pausedRequests = forward.length;
          await new Promise((resolve) => setTimeout(resolve, 2200));
          if (forward.length !== pausedRequests)
            throw Error("Paused archive still downloaded");
          await client.loadOlder(fixture.conversation, fixture.messages - 100);
          const pausedCursor = await store.cursor(archiveKey);
          [...document.querySelectorAll(".history-tools button")]
            .find((button) => button.textContent === "Download history")
            .click();
          await waitFor(
            async () => (await store.cursor(archiveKey)) > pausedCursor,
          );
          result.archive_request_interval_ms =
            archiveTimes[1] - archiveTimes[0];
          result.archive_pause_resume_ui = true;
        } finally {
          client.stop();
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
        const checkpoint = await store.cursor(archiveKey);
        if (checkpoint >= fixture.messages)
          throw Error("Foreground startup waited for the complete archive");
        const firstResumeRequest = forward.length;
        const resumed = new InstanceClient(
          account,
          runtime,
          store,
          new MemoryVault(),
        );
        try {
          await resumed.selectConversation(fixture.conversation);
          await resumed.connect();
          if (resumed.snapshot.status !== "online")
            throw Error("Archive reconnect failed");
          await waitFor(
            async () => (await store.cursor(archiveKey)) > checkpoint,
          );
          if (forward[firstResumeRequest] !== checkpoint)
            throw Error("Archive restarted instead of resuming");
          result.archive_resumed_after = checkpoint;
          result.archive_after_reconnect = await store.cursor(archiveKey);
        } finally {
          resumed.stop();
          await new Promise((resolve) => setTimeout(resolve, 500));
          await store.close();
        }
        return result;
      },
      { project, fixture },
    );
    console.log(
      JSON.stringify({
        full_connection: connected,
        messages: fixture.messages,
      }),
    );
    if (process.env.HAUNT_SCALE_REPORT)
      await fs.writeFile(
        `${process.env.HAUNT_SCALE_REPORT}.connection.json`,
        JSON.stringify(connected, null, 2),
      );
  }
  if (fixture.messages === 1000000) {
    const search = await page.evaluate(async (project) => {
      const { IndexedDBStore } = await import(
        `/@fs/${project}/packages/browser/src/storage.ts`
      );
      const store = new IndexedDBStore("scale-local-search");
      const total = 100000;
      const started = performance.now();
      for (let offset = 0; offset < total; offset += 500) {
        await store.merge(
          "scale-account",
          Array.from({ length: 500 }, (_, n) => {
            const seq = offset + n + 1;
            return {
              id: String(seq),
              seq,
              conversation_id: "scale-room",
              author_id: "author",
              request_id: String(seq),
              created_at: "2026-10-26T00:00:00Z",
              deleted: false,
              attachment_ids: [],
              body: `Message ${seq}: representative channel discussion about history downloads and cache reuse${seq % 100 === 0 ? " needle" : ""}`,
            };
          }),
        );
      }
      const indexedAt = performance.now();
      let indexedAgain = 0;
      const result = await store.search(
        "scale-account",
        "scale-room",
        "needle history",
        { onProgress: (n) => (indexedAgain += n) },
      );
      const first = performance.now();
      const older = await store.search(
        "scale-account",
        "scale-room",
        "needle history",
        { before: result.messages.at(-1).seq },
      );
      const second = performance.now();
      if (
        indexedAgain !== 0 ||
        result.messages.length !== 50 ||
        !result.hasMore ||
        result.messages[0].seq !== total ||
        older.messages[0].seq !== 95000
      )
        throw Error(
          "Indexed local search returned incomplete or repeated results",
        );
      await store.close();
      return {
        messages: total,
        indexing_ms: indexedAt - started,
        search_ms: first - indexedAt,
        older_page_ms: second - first,
        results: result.messages.length,
        reindexed: indexedAgain,
      };
    }, project);
    console.log(JSON.stringify({ local_search_scale: search }));
    if (process.env.HAUNT_SCALE_REPORT)
      await fs.writeFile(
        `${process.env.HAUNT_SCALE_REPORT}.search.json`,
        JSON.stringify(search, null, 2),
      );
  }
  await page.evaluate(() => window.scaleStore.close());
  if (process.env.HAUNT_SCALE_REPORT)
    await fs.writeFile(
      `${process.env.HAUNT_SCALE_REPORT}.client.json`,
      JSON.stringify(results, null, 2),
    );
} finally {
  await browser?.close();
  await server.close();
}
