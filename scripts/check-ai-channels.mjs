import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
const project = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(project, "test-results/ai-channels");
await fs.mkdir(output, { recursive: true });
const server = await createServer({
  configFile: path.join(project, "vite.config.ts"),
  mode: "development",
  server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false },
});
let browser, page;
try {
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const now = new Date().toISOString();
  const own = {
    id: "11111111-1111-4111-8111-111111111111",
    username: "owner",
    is_owner: false,
    created_at: now,
  };
  const peer = {
    id: "22222222-2222-4222-8222-222222222222",
    username: "sage",
    display_name: "Human Sage",
    is_owner: false,
    created_at: now,
  };
  const channel = {
    id: "33333333-3333-4333-8333-333333333333",
    name: "ai-room",
    kind: "ai",
    permissions: 1 | 2 | 16 | (1 << 18) | (1 << 19),
    category_id: null,
  };
  const accountID = "44444444-4444-4444-8444-444444444444";
  const preset = {
    id: "55555555-5555-4555-8555-555555555555",
    name: "Sage Research",
    description: "Finds and checks original sources.",
    channel_id: channel.id,
    instructions: "Be clear.",
    revision: 1,
  };
  const portraitPath = `/api/v1/channels/${channel.id}/ai/presets/${preset.id}/avatar?v=11111111111111111111111111111111`;
  preset.avatar_url = portraitPath;
  const pixel = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/5RAAAAAASUVORK5CYII=",
    "base64",
  );
  let portraitReads = 0;
  const aiReads = [];
  const created = [];
  const roster = [preset];
  let settings = {
    channel_id: channel.id,
    provider: "claude",
    provider_name: "Claude",
    account_id: accountID,
    model: "claude-test",
    model_name: "Claude Test",
    instructions: "Respond to the conversation.",
    name: "Guide",
    max_bytes: 67108864,
    revision: 1,
    connection_status: "connected",
    active_preset_id: preset.id,
  };
  let turns = [];
  let through = 0;
  let permissions = 1 | 2 | 16 | 16384 | (1 << 18) | (1 << 19);
  let eventID = 1;
  const instance = {
    instance_id: "ai-client-check",
    name: "AI Community",
    api_version: "v1",
    public_url: base,
    capabilities: [
      "sessions.persistent",
      "events.account_feed",
      "messages.read_state",
      "messages.replies",
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
        id: "66666666-6666-4666-8666-666666666666",
        device_name: "AI check",
        created_at: now,
        expires_at: null,
      },
    },
  };
  const messages = [
    {
      id: "77777777-7777-4777-8777-777777777771",
      conversation_id: channel.id,
      author_id: "",
      ai_author: { id: preset.id, name: "Sage", avatar_url: portraitPath },
      body: "First AI reply",
      seq: 1,
      created_at: now,
      request_id: "77777777-7777-4777-8777-777777777772",
      attachment_ids: [],
      deleted: false,
    },
    {
      id: "77777777-7777-4777-8777-777777777773",
      conversation_id: channel.id,
      author_id: "",
      ai_author: {
        id: "88888888-8888-4888-8888-888888888888",
        name: "Guide",
        avatar_url: portraitPath,
      },
      body: "Second AI reply",
      seq: 2,
      created_at: now,
      request_id: "77777777-7777-4777-8777-777777777774",
      attachment_ids: [],
      deleted: false,
    },
  ];
  const posted = [],
    sockets = new Set(),
    errors = [];
  const send = (event) => {
    for (const socket of sockets) socket.send(JSON.stringify(event));
  };
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
    const req = route.request(),
      url = new URL(req.url()),
      p = url.pathname;
    if (url.pathname + url.search === portraitPath) {
      portraitReads++;
      await route.fulfill({ body: pixel, contentType: "image/png" });
      return;
    }
    if (req.method() === "GET" && p.includes(`/channels/${channel.id}/ai`))
      aiReads.push(p);
    let body;
    if (p === "/api/v1/instance") body = instance;
    else if (p === "/api/v1/me")
      body = {
        user: own,
        session_id: account.login.session.id,
        permissions,
        role_position: 100,
      };
    else if (p === "/api/v1/channels") body = { channels: [channel] };
    else if (p === "/api/v1/categories") body = { categories: [] };
    else if (p === "/api/v1/users") body = { users: [own, peer] };
    else if (p === "/api/v1/conversations") body = { conversations: [] };
    else if (p === "/api/v1/read-state")
      body = {
        states: [
          {
            kind: "channel",
            conversation_id: channel.id,
            read_seq: messages.length,
            last_seq: messages.length,
            unread_count: 0,
            mention_count: 0,
            event_cursor: eventID,
          },
        ],
      };
    else if (p.endsWith("/messages") && req.method() === "POST") {
      const input = req.postDataJSON();
      posted.push(input);
      body = {
        id: crypto.randomUUID(),
        conversation_id: channel.id,
        author_id: own.id,
        ...input,
        seq: messages.length + 1,
        created_at: new Date().toISOString(),
        attachment_ids: [],
        deleted: false,
      };
      messages.push(body);
    } else if (p.endsWith("/messages"))
      body = {
        messages: messages.filter((m) => m.seq > through),
        last_seq: messages.length,
        pruned_through: through,
        event_cursor: eventID,
        gap: false,
      };
    else if (p.endsWith("/read"))
      body = {
        kind: "channel",
        conversation_id: channel.id,
        read_seq: messages.length,
        last_seq: messages.length,
        unread_count: 0,
        mention_count: 0,
        event_cursor: eventID,
      };
    else if (p === `/api/v1/channels/${channel.id}/ai`) {
      if (req.method() === "PUT")
        settings = {
          ...settings,
          ...req.postDataJSON(),
          revision: settings.revision + 1,
        };
      body = settings;
    } else if (p.endsWith("/ai/presets")) {
      if (req.method() === "POST") {
        const payload = req.postDataJSON();
        created.push(payload);
        body = {
          id: payload.request_id,
          channel_id: channel.id,
          name: payload.name,
          description: payload.description,
          instructions: payload.instructions,
          revision: 1,
        };
        roster.push(body);
      } else body = { presets: roster };
    } else if (p.endsWith("/ai/turns")) body = { turns };
    else if (p.endsWith("/ai/usage"))
      body = {
        channel_bytes: 1024,
        channel_max_bytes: 67108864,
        global_bytes: 1024,
        global_max_bytes: 134217728,
        pruned_through: through,
      };
    else if (p === "/api/v1/ai/accounts")
      body = {
        accounts: [
          {
            id: accountID,
            provider: "claude",
            status: "connected",
            label: "Shared Claude",
            created_at: now,
          },
        ],
      };
    else if (p.endsWith("/models"))
      body = {
        models: [{ id: "claude-test", name: "Claude Test", vision: true }],
      };
    else if (p === "/api/v1/ai/providers")
      body = {
        providers: [
          {
            id: "claude",
            name: "Claude",
            models: [{ id: "claude-test", name: "Claude Test", vision: true }],
          },
          { id: "codex", name: "Codex / ChatGPT", models: [] },
          { id: "antigravity", name: "Antigravity", models: [] },
        ],
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
      socket.send(
        JSON.stringify({
          type:
            {
              authenticate: "ready",
              "events.watch": "events.watching",
              subscribe: "subscribed",
              "voice.watch": "voice.watching",
              "presence.watch": "presence.watching",
            }[event.type] ?? event.type + ".accepted",
          instance_id: instance.instance_id,
          event_cursor: eventID,
          conversations: [],
        }),
      );
    });
  });
  await page.addInitScript(
    (saved) =>
      localStorage.setItem(
        "chatxo-remembered-v1:" + saved.instance.instance_id,
        JSON.stringify(saved),
      ),
    account,
  );
  await page.goto(base);
  await page
    .getByRole("button", { name: "Open AI Community", exact: true })
    .click();
  const input = page.getByRole("textbox", { name: "Message", exact: true });
  await expect(input).toBeVisible();
  await expect(
    page.locator(".message-meta").filter({ hasText: "Sage" }),
  ).toHaveCount(1);
  await expect(
    page.locator(".message-meta").filter({ hasText: "Guide" }),
  ).toHaveCount(1);
  await expect.poll(() => portraitReads).toBe(1);
  const header = page.getByRole("region", { name: "AI provider and model" });
  await expect(header).toContainText("Claude Test");
  const configBar = await header.boundingBox();
  const search = await page
    .getByRole("searchbox", { name: "Search downloaded messages" })
    .boundingBox();
  assert(configBar.y + configBar.height <= search.y);
  const firstMessage = page.locator(`#message-${messages[0].id}`);
  const readsBeforeProfile = aiReads.length;
  await firstMessage.locator(".message-meta button.user-name").click();
  const profile = page.getByRole("dialog", { name: "AI personality profile" });
  await expect(
    profile.getByRole("heading", { name: preset.name }),
  ).toBeVisible();
  await expect(profile.getByText(preset.description)).toBeVisible();
  await expect(profile.locator(".ai-profile-portrait img")).toBeVisible();
  const portrait = await profile.locator(".ai-profile-portrait").boundingBox();
  const heading = await profile
    .getByRole("heading", { name: preset.name })
    .boundingBox();
  assert(portrait.width >= 100 && portrait.x + portrait.width <= heading.x);
  await page.setViewportSize({ width: 390, height: 780 });
  await expect(profile).toBeVisible();
  const narrowCard = await profile.boundingBox();
  const narrowPortrait = await profile
    .locator(".ai-profile-portrait")
    .boundingBox();
  const narrowInfo = await profile.locator(".ai-profile-info").boundingBox();
  assert(narrowCard.x >= 0 && narrowCard.x + narrowCard.width <= 390);
  assert(narrowPortrait.x + narrowPortrait.width <= narrowInfo.x);
  assert(narrowInfo.x + narrowInfo.width <= narrowCard.x + narrowCard.width);
  await profile.screenshot({
    path: path.join(output, "personality-profile-mobile.png"),
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.keyboard.press("Escape");
  await page
    .locator(`#message-${messages[1].id} .message-avatar button`)
    .click();
  await expect(profile.getByRole("heading", { name: "Guide" })).toBeVisible();
  await expect(profile.locator(".ai-profile-info")).toHaveCSS(
    "text-align",
    "center",
  );
  await profile.getByRole("button", { name: "Close" }).click();
  assert.equal(portraitReads, 1);
  assert.equal(aiReads.length, readsBeforeProfile);
  await input.fill("@Sa");
  await expect(
    page.getByRole("option", { name: "Sage Research AI preset" }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: "Human Sage @sage" }),
  ).toBeVisible();
  await page.getByRole("option", { name: "Sage Research AI preset" }).click();
  await expect(input.locator('[contenteditable="false"]')).toHaveText(
    "@Sage Research",
  );
  await expect(input).not.toContainText(preset.id);
  await input.press("Home");
  await input.press("Delete");
  await expect(input.locator("[data-ai-mention]")).toHaveCount(0);
  await input.fill("@Sage Res");
  await page.getByRole("option", { name: "Sage Research AI preset" }).click();
  await input.press("End");
  await input.press("Enter");
  await expect.poll(() => posted.length).toBe(1);
  assert.equal(posted[0].body, `<@ai:${preset.id}> `);
  const readsBeforeActivity = aiReads.length;
  const turn = {
    id: "99999999-9999-4999-8999-999999999999",
    channel_id: channel.id,
    trigger_message_id: messages.at(-1).id,
    actor_id: own.id,
    status: "running",
    revision: 3,
    action: "read_url",
    detail: "Reading example.org",
    last_progress_at: now,
    partial_text: "Streaming answer",
    created_at: now,
    updated_at: now,
  };
  turns = [turn];
  send({ type: "ai.turn.updated", data: turn, conversation_id: channel.id });
  await expect(
    page.getByText("Reading example.org", { exact: false }),
  ).toBeVisible();
  await firstMessage.hover();
  await firstMessage
    .getByRole("button", { name: "Reply", exact: true })
    .click();
  const statusStrip = page.locator(".composer-wrap .ai-conversation-status");
  const replyStrip = page.locator(".composer-wrap .composer-reply");
  await expect(replyStrip).toBeVisible();
  const activityBounds = await statusStrip.boundingBox();
  const replyBounds = await replyStrip.boundingBox();
  assert.equal(activityBounds.x, replyBounds.x);
  assert.equal(activityBounds.width, replyBounds.width);
  assert(activityBounds.y + activityBounds.height <= replyBounds.y);
  await expect(statusStrip).toHaveCSS(
    "background-color",
    await replyStrip.evaluate((el) => getComputedStyle(el).backgroundColor),
  );
  await page.getByRole("button", { name: "Cancel reply" }).click();
  send({
    type: "ai.turn.updated",
    data: { ...turn, revision: 2, partial_text: "Stale answer" },
    conversation_id: channel.id,
  });
  await expect(page.getByText("Stale answer", { exact: true })).toHaveCount(0);
  turns = [{ ...turn, status: "completed", revision: 4 }];
  send({
    type: "ai.turn.updated",
    data: turns[0],
    conversation_id: channel.id,
  });
  await expect(
    page.getByText("Reading example.org", { exact: false }),
  ).toHaveCount(0);
  assert.equal(aiReads.length, readsBeforeActivity);
  await page
    .locator(`[data-channel-id="${channel.id}"] .channel`)
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Edit channel", exact: true })
    .click();
  await page.getByRole("button", { name: "AI settings", exact: true }).click();
  const channelDialog = page.getByRole("dialog", {
    name: `Channel settings · ${channel.name}`,
  });
  assert((await channelDialog.boundingBox()).width > 750);
  await expect(
    channelDialog.getByRole("button", { name: "Expand settings" }),
  ).toBeVisible();
  await channelDialog.screenshot({
    path: path.join(output, "channel-settings.png"),
  });
  await page.setViewportSize({ width: 390, height: 780 });
  await expect(channelDialog).toBeVisible();
  const fields = channelDialog.locator(".channel-settings-pair");
  const fieldBounds = await fields
    .getByRole("combobox", { name: "Integration", exact: true })
    .boundingBox();
  const accountBounds = await fields
    .getByRole("combobox", { name: "Account", exact: true })
    .boundingBox();
  assert(fieldBounds.x >= 0 && fieldBounds.x + fieldBounds.width <= 390);
  assert(accountBounds.y >= fieldBounds.y + fieldBounds.height);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(
    page.getByRole("combobox", { name: "Model", exact: true }),
  ).toHaveValue("claude-test");
  await page.getByRole("button", { name: "Add personality" }).click();
  const form = page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "Save personality" }) });
  await form.getByLabel("Name", { exact: true }).fill("Field Guide");
  await form.getByLabel("Description").fill("Checks citations");
  const largePicture = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1600;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "navy";
    ctx.fillRect(0, 0, 1600, 1600);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await form.getByLabel("Profile picture").setInputFiles({
    name: "large.png",
    mimeType: "image/png",
    buffer: Buffer.from(largePicture, "base64"),
  });
  await expect(form.getByAltText("Selected picture preview")).toBeVisible();
  await form.getByRole("button", { name: "Save personality" }).click();
  await expect.poll(() => created.length).toBe(1);
  const resized = Buffer.from(created[0].avatar_data, "base64");
  assert.equal(resized.readUInt32BE(16), 256);
  assert.equal(resized.readUInt32BE(20), 256);
  assert.equal(created[0].description, "Checks citations");
  assert.match(created[0].request_id, /^[a-f0-9-]{36}$/);
  await page.getByLabel("Allow the agent to switch personalities").check();
  const timing = page.getByLabel("When to switch personalities");
  await expect(timing).toHaveValue("next");
  await timing.selectOption("immediate");
  await page
    .getByRole("button", { name: "Save AI settings", exact: true })
    .click();
  await expect.poll(() => settings.allow_agent_switch).toBe(true);
  await expect.poll(() => settings.switch_during_reply).toBe(true);
  await expect(
    page.getByRole("button", { name: "Connect account", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Use Haunt desktop to connect or reconnect an account.", {
      exact: false,
    }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  channel.permissions = 3;
  permissions = 3;
  send({ type: "directory.changed" });
  await expect(
    page.getByText("Your role cannot request AI responses.", { exact: false }),
  ).toBeVisible();
  await input.fill("@Sa");
  await expect(
    page.getByRole("option", { name: "Sage Research AI preset" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("option", { name: "Human Sage @sage" }),
  ).toBeVisible();
  await input.fill("Human discussion continues");
  await input.press("Enter");
  await expect.poll(() => posted.length).toBe(2);
  assert.equal(posted[1].body, "Human discussion continues");
  through = 2;
  send({
    id: ++eventID,
    type: "history.pruned",
    conversation_id: channel.id,
    data: { pruned_through: through },
  });
  await expect(page.getByText("First AI reply", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByText("Second AI reply", { exact: true })).toHaveCount(
    0,
  );
  await page.screenshot({
    path: path.join(output, "ai-channel.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(output, "report.json"),
    JSON.stringify(
      {
        source: "real client UI with isolated API and websocket fixtures",
        passed: [
          "AI-only initial channel selection",
          "separate AI authors",
          "AI speaker names and portraits open the channel profile with cached image data",
          "provider and model header uses the channel settings snapshot",
          "AI activity stacks and aligns with the reply header",
          "expandable wide channel settings",
          "stable preset mention distinct from human mention",
          "active tool above the composer without additional reads",
          "historical avatar requests shared across rows",
          "multiword mention chip deletion and stable wire ID",
          "picture preview and automatic 256px conversion during creation",
          "stream revisions",
          "channel settings persistence",
          "desktop-only browser login notice",
          "denied invocation still posts",
          "pruned cache eviction",
        ],
        providerOAuth: "not exercised",
        providerInference: "not exercised",
      },
      null,
      2,
    ),
  );
  console.log("AI channel client scenarios passed.");
} catch (error) {
  if (page)
    await page
      .screenshot({ path: path.join(output, "failure.png"), fullPage: true })
      .catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
