import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const project = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(project, "test-results/chat-stability");
await fs.mkdir(output, { recursive: true });
const server = await createServer({
  configFile: path.join(project, "vite.config.ts"),
  mode: "development",
  server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false },
});
let browser;
let page;
const report = [];
try {
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const now = new Date().toISOString();
  const own = {
    id: "11111111-1111-4111-8111-111111111111",
    username: "owner",
    is_owner: true,
    created_at: now,
  };
  const peer = {
    id: "22222222-2222-4222-8222-222222222222",
    username: "alice",
    display_name: "Alice",
    is_owner: false,
    created_at: now,
  };
  const channel = {
    id: "33333333-3333-4333-8333-333333333333",
    name: "general",
    kind: "text",
    permissions: 262143,
    category_id: null,
  };
  const dm = {
    id: "44444444-4444-4444-8444-444444444444",
    kind: "dm",
    members: [own.id, peer.id],
  };
  const instance = {
    instance_id: "chat-stability",
    name: "Community",
    api_version: "v1",
    public_url: base,
    capabilities: [
      "sessions.persistent",
      "events.account_feed",
      "messages.read_state",
    ],
    media_transport: "webrtc",
    authentication: {
      scheme: "bearer",
      registration: "invitation",
      session_days: 30,
    },
    limits: {
      text_max_bytes: 256000000,
      text_retention_days: 30,
      image_max_bytes: 2097152,
      video_max_bytes: 10485760,
      attachment_max_bytes: 1073741824,
      attachment_retention_days: 7,
    },
  };
  const account = {
    origin: base,
    instance,
    remember: true,
    login: {
      instance_id: instance.instance_id,
      token: "A".repeat(43),
      token_type: "Bearer",
      user: own,
      session: {
        id: "55555555-5555-4555-8555-555555555555",
        device_name: "Browser regression",
        created_at: now,
        expires_at: null,
      },
    },
  };
  const messages = new Map(
    [channel.id, dm.id].map((id, index) => [
      id,
      [
        {
          id: `66666666-6666-4666-8666-66666666666${index}`,
          conversation_id: id,
          author_id: peer.id,
          body: "Stable message history",
          seq: 1,
          created_at: now,
          request_id: `77777777-7777-4777-8777-77777777777${index}`,
          attachment_ids: [],
          deleted: false,
        },
      ],
    ]),
  );
  let conversations = [dm];
  let channels = [channel];
  const sockets = new Set();
  const errors = [];
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    let body;
    if (url.pathname === "/api/v1/instance") body = instance;
    else if (url.pathname === "/api/v1/me")
      body = {
        user: own,
        session_id: account.login.session.id,
        permissions: 262143,
        role_position: 100,
      };
    else if (url.pathname === "/api/v1/channels") body = { channels };
    else if (url.pathname === "/api/v1/categories") body = { categories: [] };
    else if (url.pathname === "/api/v1/users") body = { users: [own, peer] };
    else if (url.pathname === "/api/v1/conversations") body = { conversations };
    else if (url.pathname === "/api/v1/read-state")
      body = {
        states: [...channels, ...conversations].map((entry) => ({
          kind: entry.kind === "dm" ? "dm" : "channel",
          conversation_id: entry.id,
          read_seq: 1,
          last_seq: 1,
          unread_count: 0,
          mention_count: 0,
          event_cursor: 1,
        })),
      };
    else if (url.pathname.endsWith("/messages"))
      body = {
        messages: messages.get(url.pathname.split("/")[4]) ?? [],
        last_seq: 1,
        pruned_through: 0,
        event_cursor: 1,
        gap: false,
      };
    else if (url.pathname.endsWith("/read"))
      body = {
        kind: "channel",
        conversation_id: url.pathname.split("/")[4],
        read_seq: 1,
        last_seq: 1,
        unread_count: 0,
        mention_count: 0,
        event_cursor: 1,
      };
    else {
      await route.fulfill({ status: 404, json: { error: "not_found" } });
      return;
    }
    await route.fulfill({ json: body });
  });
  await page.route("**/readyz", (route) =>
    route.fulfill({ json: { status: "ok" } }),
  );
  await page.routeWebSocket("**/api/v1/events", (socket) => {
    sockets.add(socket);
    socket.onClose(() => sockets.delete(socket));
    socket.onMessage((raw) => {
      const event = JSON.parse(String(raw));
      const types = {
        authenticate: "ready",
        "events.watch": "events.watching",
        subscribe: "subscribed",
        "voice.watch": "voice.watching",
        "presence.watch": "presence.watching",
      };
      socket.send(
        JSON.stringify({
          type: types[event.type] ?? event.type + ".accepted",
          instance_id: instance.instance_id,
          event_cursor: 1,
          conversations: [],
        }),
      );
    });
  });
  await page.addInitScript((saved) => {
    localStorage.setItem(
      "chatxo-remembered-v1:" + saved.instance.instance_id,
      JSON.stringify(saved),
    );
  }, account);
  await page.goto(base);
  const input = page.getByRole("textbox", { name: "Message", exact: true });
  const frames = () =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  async function observe(name) {
    await expect(page.locator(".messages .message")).toHaveCount(1);
    await input.fill("Keep this draft and selection");
    await input.evaluate((node) => {
      window.chatProbe?.observer.disconnect();
      node.setSelectionRange(5, 9);
      const probe = {
        node,
        notice: document.querySelector(".dm-info"),
        noticeText: document.querySelector(".dm-info")?.textContent,
        row: document.querySelector(".message"),
        removed: 0,
        blur: 0,
        noticeChanges: 0,
      };
      node.addEventListener("blur", () => probe.blur++);
      probe.observer = new MutationObserver((records) => {
        for (const record of records) {
          if (probe.notice?.contains(record.target)) probe.noticeChanges++;
          for (const removed of record.removedNodes)
            if (
              [probe.node, probe.notice, probe.row].some(
                (tracked) =>
                  tracked &&
                  (removed === tracked || removed.contains?.(tracked)),
              )
            )
              probe.removed++;
        }
      });
      probe.observer.observe(document.getElementById("root"), {
        childList: true,
        subtree: true,
        characterData: true,
      });
      window.chatProbe = probe;
    });
    report.push({ view: name, updates: [] });
  }
  async function stable(label) {
    await frames();
    const observed = await page.evaluate(() => {
      const probe = window.chatProbe;
      return {
        sameInput:
          document.querySelector('textarea[aria-label="Message"]') ===
          probe.node,
        sameNotice: document.querySelector(".dm-info") === probe.notice,
        sameRow: document.querySelector(".message") === probe.row,
        noticeText:
          document.querySelector(".dm-info")?.textContent === probe.noticeText,
        focused: document.activeElement === probe.node,
        connected: probe.node.isConnected,
        selection: [probe.node.selectionStart, probe.node.selectionEnd],
        draft: probe.node.value,
        removed: probe.removed,
        blur: probe.blur,
        noticeChanges: probe.noticeChanges,
      };
    });
    assert.deepEqual(
      observed,
      {
        sameInput: true,
        sameNotice: true,
        sameRow: true,
        noticeText: true,
        focused: true,
        connected: true,
        selection: [5, 9],
        draft: "Keep this draft and selection",
        removed: 0,
        blur: 0,
        noticeChanges: 0,
      },
      label,
    );
    report.at(-1).updates.push(label);
  }
  async function restore() {
    await page.evaluate(async () => {
      const { applySyncBackup, collectSyncBackup } =
        await import("/src/sync-backup.ts");
      await applySyncBackup(await collectSyncBackup());
    });
  }
  async function refresh(afterChange = false) {
    await page.evaluate(async (changed) => {
      const { client } = await import("/src/runtime.ts");
      const instance = client.instances.values().next().value;
      if (changed) await instance.refreshAfterChange();
      else await instance.refresh();
    }, afterChange);
  }
  async function verifyUpdates() {
    for (let pass = 0; pass < 3; pass++) {
      await restore();
      await stable("sync restore " + pass);
      await refresh();
      await stable("directory and history refresh " + pass);
    }
    for (const socket of sockets)
      socket.send(JSON.stringify({ type: "directory.changed" }));
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const { client } = await import("/src/runtime.ts");
          return client.instances.values().next().value.snapshot.status;
        }),
      )
      .toBe("online");
    await refresh();
    await stable("gateway directory notification");
    await page.evaluate(async () => {
      const { client } = await import("/src/runtime.ts");
      await client.instances.values().next().value.connect();
    });
    await stable("connection re-established");
    await page.keyboard.insertText("typed");
    await expect(input).toHaveValue("Keep typed draft and selection");
    await expect(input).toBeFocused();
  }
  const comparePixels = (before, after) =>
    page.evaluate(
      async ([before, after]) => {
        const pixels = async (base64) => {
          const image = await createImageBitmap(
            await (await fetch(`data:image/png;base64,${base64}`)).blob(),
          );
          const canvas = document.createElement("canvas");
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext("2d");
          context.drawImage(image, 0, 0);
          image.close();
          return context.getImageData(0, 0, canvas.width, canvas.height).data;
        };
        const a = await pixels(before),
          b = await pixels(after);
        let max = 0,
          edgePixels = 0;
        for (let i = 0; i < a.length; i += 4) {
          const delta = Math.max(
            ...[0, 1, 2, 3].map((channel) =>
              Math.abs(a[i + channel] - b[i + channel]),
            ),
          );
          max = Math.max(max, delta);
          if (delta > 4) edgePixels++;
        }
        return a.length === b.length && max <= 10 && edgePixels <= 4;
      },
      [before.toString("base64"), after.toString("base64")],
    );
  const rail = page.locator(".server-rail");
  const peopleSearch = page.getByRole("combobox", {
    name: "Search direct messages",
  });
  for (const effect of ["opaque", "transparent", "material"]) {
    await page.evaluate((effect) => {
      document.documentElement.dataset.windowEffect = effect;
    }, effect);
    await peopleSearch.press("Escape");
    await peopleSearch.blur();
    await frames();
    const before = await rail.screenshot({ animations: "disabled" });
    const bounds = await rail.boundingBox();
    await peopleSearch.focus();
    await expect(
      page.getByRole("listbox", { name: "People across your servers" }),
    ).toBeVisible();
    for (let frame = 0; frame < 8; frame++) {
      await peopleSearch.press(frame % 2 ? "ArrowUp" : "ArrowDown");
      await frames();
      const after = await rail.screenshot({ animations: "disabled" });
      assert.deepEqual(await rail.boundingBox(), bounds);
      const unchanged = await comparePixels(before, after);
      if (!unchanged) {
        await fs.writeFile(
          path.join(output, `rail-${effect}-before.png`),
          before,
        );
        await fs.writeFile(
          path.join(output, `rail-${effect}-after.png`),
          after,
        );
      }
      assert.ok(
        unchanged,
        `Search must not repaint the server rail (${effect}, frame ${frame})`,
      );
    }
    await peopleSearch.press("Escape");
    await expect(peopleSearch).toBeFocused();
    await expect(
      page.getByRole("listbox", { name: "People across your servers" }),
    ).toHaveCount(0);
    report.push({ view: `people-search-${effect}`, stableRailFrames: 8 });
  }
  await page.evaluate(() => {
    document.documentElement.dataset.windowEffect = "opaque";
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(rail).toBeHidden();
  await page.getByRole("button", { name: "Show servers", exact: true }).click();
  await expect(rail).toBeVisible();
  await expect
    .poll(async () => Math.round((await rail.boundingBox()).x))
    .toBe(0);
  assert.equal(Math.round((await rail.boundingBox()).width), 62);
  await page
    .getByRole("button", {
      name: "Direct messages and notifications",
      exact: true,
    })
    .click();
  await expect(rail).toBeHidden();
  await expect(peopleSearch).toBeVisible();
  await page.screenshot({ path: path.join(output, "mobile-home.png") });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(rail).toBeVisible();
  assert.equal(Math.round((await rail.boundingBox()).x), 0);
  await page.screenshot({ path: path.join(output, "desktop-home.png") });
  report.push({ view: "mobile-navigation", openedAndClosed: true });
  await page
    .getByRole("button", { name: "Message Alice via Community", exact: true })
    .click();
  await expect(page.locator(".dm-info")).toContainText(
    "This server does not support encrypted DMs yet.",
  );
  await observe("dm");
  await verifyUpdates();
  await observe("dm account membership");
  await page.evaluate(async () => {
    const { client } = await import("/src/runtime.ts");
    const existing = client.instances.values().next().value;
    const extra = new existing.constructor(
      {
        ...existing.account,
        instance: { ...existing.account.instance, instance_id: "extra" },
        login: { ...existing.account.login, instance_id: "extra" },
      },
      client.runtime,
      client.store,
      client.vault,
    );
    client.instances.set("extra", extra);
    window.dispatchEvent(new Event("haunt-sync-restored"));
  });
  await stable("unrelated account added");
  await page.evaluate(async () => {
    const { client } = await import("/src/runtime.ts");
    client.instances.delete("extra");
    window.dispatchEvent(new Event("haunt-sync-restored"));
  });
  await stable("unrelated account removed");
  await page
    .getByRole("button", { name: "Open Community", exact: true })
    .click();
  await observe("channel");
  await verifyUpdates();
  channels = [];
  await refresh(true);
  await expect(input).toHaveCount(0);
  await expect(page.locator(".empty-conversation")).toBeVisible();
  channels = [channel];
  await refresh(true);
  await expect(input).toBeVisible();
  await page
    .getByRole("button", {
      name: "Direct messages and notifications",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Message Alice via Community", exact: true })
    .click();
  conversations = [];
  await refresh(true);
  await expect(page.locator(".dm-unavailable")).toBeVisible();
  await expect(input).toHaveCount(0);
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(output, "report.json"),
    JSON.stringify(
      { checks: report, removedConversationsHidden: true, errors },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      checks: report,
      removedConversationsHidden: true,
      errors,
    }),
  );
} catch (error) {
  await page
    ?.screenshot({ path: path.join(output, "failure.png") })
    .catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
