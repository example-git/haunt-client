import { fillSignin } from "./signin-fields.mjs";
import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

export async function checkAIServer(browser, fixtures) {
  const contexts = [],
    pages = [],
    errors = [],
    checked = [];
  const server = fixtures.rtc;
  assert(
    server.ai_channel && server.ai_preset,
    "AI server fixtures are required",
  );
  const channelPath = `/api/v1/channels/${server.ai_channel}/ai`;
  const login = async (username) => {
    const context = await browser.newContext({
      viewport: { width: 1400, height: 1000 },
    });
    contexts.push(context);
    const page = await context.newPage();
    pages.push(page);
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(server.url);
    await page.getByRole("button", { name: "Add server", exact: true }).click();
    await fillSignin(page, server.url, username);
    await page.getByLabel("Password", { exact: true }).fill(fixtures.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator(".connection")).toHaveText("Connected", {
      timeout: 30000,
    });
    await page
      .locator(`[data-channel-id="${server.ai_channel}"] .channel`)
      .click();
    await expect(
      page.getByRole("region", { name: "AI provider and model" }),
    ).toContainText("Claude Sonnet 4.6");
    const response = await context.request.post(
      server.url + "/api/v1/auth/login",
      {
        data: {
          username,
          password: fixtures.password,
          device_name: "AI integration assertion",
          remember: false,
        },
      },
    );
    assert.equal(response.status(), 200, `API assertion login for ${username}`);
    const credential = await response.json();
    const api = async (path, method = "GET", body) => {
      const response = await context.request.fetch(server.url + path, {
        method,
        headers: { Authorization: `Bearer ${credential.token}` },
        ...(body === undefined ? {} : { data: body }),
      });
      assert(
        response.ok(),
        `${method} ${path}: ${response.status()} ${response.ok() ? "" : await response.text()}`,
      );
      return response.status() === 204 ? undefined : response.json();
    };
    return { page, context, api };
  };
  try {
    const owner = await login("owner"),
      alice = await login("alice"),
      bob = await login("bob");
    const send = async (participant, body, channel = server.ai_channel) => {
      const pending = participant.page.waitForResponse(
        (r) =>
          r.url().endsWith(`/conversations/${channel}/messages`) &&
          r.request().method() === "POST",
      );
      await participant.page
        .getByRole("textbox", { name: "Message", exact: true })
        .fill(body);
      await participant.page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      const response = await pending;
      assert(response.ok(), `Send message failed: ${response.status()}`);
      const message = await response.json();
      await expect(
        participant.page.locator(`#message-${message.id}`),
      ).toBeVisible();
      return message;
    };
    const completed = async (trigger) => {
      let result;
      await expect
        .poll(
          async () => {
            const { turns } = await owner.api(channelPath + "/turns");
            result = turns.find(
              (turn) => turn.trigger_message_id === trigger.id,
            );
            if (
              ["failed", "requires_auth", "interrupted"].includes(
                result?.status,
              )
            )
              throw Error(`AI turn ${result.status}: ${result.error_code}`);
            return result?.status;
          },
          { timeout: 45000 },
        )
        .toBe("completed");
      const history = await owner.api(
        `/api/v1/conversations/${server.ai_channel}/messages?limit=100`,
      );
      const reply = history.messages
        .filter((m) => m.ai_author && m.seq > trigger.seq)
        .at(-1);
      assert(reply, "Completed turn produces an AI-authored message");
      await expect(alice.page.locator(`#message-${reply.id}`)).toContainText(
        reply.body,
      );
      await expect(bob.page.locator(`#message-${reply.id}`)).toContainText(
        reply.ai_author.name,
      );
      return reply;
    };
    const first = await send(
      alice,
      "Alice asks about this shared conversation",
    );
    const firstReply = await completed(first);
    assert.match(firstReply.body, /users=alice/);
    const second = await send(bob, "Bob follows up in the shared conversation");
    const secondReply = await completed(second);
    assert.match(secondReply.body, /users=alice,bob/);
    checked.push(
      "Two real browser users post; native Claude adapter receives distinct server-owned authors and both clients render AI replies",
    );
    const { presets } = await owner.api(channelPath + "/presets");
    const preset = presets.find((p) => p.id === server.ai_preset);
    assert(preset);
    const batchChannel = await owner.api("/api/v1/channels", "POST", {
      name: "queue-check",
      kind: "ai",
    });
    const batchPath = `/api/v1/channels/${batchChannel.id}/ai`;
    const configured = await owner.api(channelPath);
    await owner.api(batchPath, "PUT", {
      account_id: configured.account_id,
      provider: configured.provider,
      model: configured.model,
      name: "Guide",
      instructions: "",
      max_bytes: configured.max_bytes,
    });
    const batchPreset = await owner.api(batchPath + "/presets", "POST", {
      name: "Researcher",
    });
    const openChannel = (participant, id) =>
      participant.page.locator(`[data-channel-id="${id}"] .channel`).click();
    for (const member of [alice, bob])
      await openChannel(member, batchChannel.id);
    const queue = (member, text) => send(member, text, batchChannel.id);
    const hold = await queue(
      alice,
      "Hold this fixture response until cancellation.",
    );
    let heldTurn;
    await expect
      .poll(async () => {
        const { turns } = await owner.api(batchPath + "/turns");
        heldTurn = turns.find((t) => t.trigger_message_id === hold.id);
        return heldTurn?.status;
      })
      .toBe("running");
    const firstQueued = await queue(alice, "Queue check one");
    await queue(bob, "Queue check two");
    await queue(bob, `<@ai:${batchPreset.id}> Queue check three`);
    await queue(alice, "Queue check four");
    await owner.api(batchPath + "/turns/" + heldTurn.id + "/cancel", "POST");
    const replies = async () => {
      const history = await owner.api(
        `/api/v1/conversations/${batchChannel.id}/messages?limit=100`,
      );
      return history.messages
        .filter((m) => m.ai_author && m.seq > firstQueued.seq)
        .sort((a, b) => a.seq - b.seq);
    };
    await expect
      .poll(async () => (await replies()).map((m) => m.body))
      .toEqual([
        expect.stringContaining("persona=Guide; batch authors=alice,bob"),
        expect.stringContaining(
          `persona=${batchPreset.name}; batch authors=bob,alice`,
        ),
      ]);
    checked.push(
      "Four posts during a busy response reach the provider as two attributed user messages, split at the personality change",
    );
    for (const member of [alice, bob])
      await openChannel(member, server.ai_channel);
    const input = alice.page.getByRole("textbox", {
      name: "Message",
      exact: true,
    });
    await input.fill("@" + preset.name.slice(0, 2));
    await alice.page
      .getByRole("option")
      .filter({ hasText: preset.name })
      .filter({ hasText: "AI preset" })
      .click();
    await expect(input.locator("[data-ai-mention]")).toHaveText(
      "@" + preset.name,
    );
    const selected = await send(alice, `<@ai:${preset.id}> Use this persona`);
    const presetReply = await completed(selected);
    assert.equal(presetReply.ai_author.id, preset.id);
    assert.equal(presetReply.ai_author.name, preset.name);
    assert(presetReply.body.includes(`persona=${preset.name}`));
    await bob.page
      .locator(`#message-${presetReply.id} .message-meta button.user-name`)
      .click();
    const profile = bob.page.getByRole("dialog", {
      name: "AI personality profile",
    });
    await expect(
      profile.getByRole("heading", { name: preset.name }),
    ).toBeVisible();
    await bob.page.keyboard.press("Escape");
    checked.push(
      "Stable preset mention updates shared selection and the selecting message's response identity",
    );
    const png = await fs.readFile(
      new URL("../static/icon.png", import.meta.url),
    );
    const uploaded = bob.page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/v1/conversations/${server.ai_channel}/attachments` &&
        response.request().method() === "POST",
    );
    await bob.page.locator('.composer input[type="file"]').setInputFiles({
      name: "vision.png",
      mimeType: "image/png",
      buffer: png,
    });
    const uploadResponse = await uploaded;
    assert(
      uploadResponse.ok(),
      `Attachment upload failed: ${uploadResponse.status()} ${await uploadResponse.text()}`,
    );
    await expect(bob.page.locator(".attachment-chips")).toContainText(
      "vision.png",
    );
    await expect(
      bob.page.getByRole("button", { name: "Send message", exact: true }),
    ).toBeEnabled();
    const imageMessage = await send(
      bob,
      "Read this image with both participants identified",
    );
    const imageReply = await completed(imageMessage);
    assert.match(imageReply.body, /images=1/);
    assert.match(imageReply.body, /users=alice,bob/);
    assert(imageReply.body.includes(`persona=${preset.name}`));
    checked.push(
      "Actual attachment upload reaches authorized vision context and native provider image blocks",
    );
    const toolMessage = await send(
      alice,
      "Read https://example.org/ using the URL tool",
    );
    const toolReply = await completed(toolMessage);
    assert.match(toolReply.body, /tools=read_url; tool_ok=true/);
    assert.match(toolReply.body, /users=alice,bob/);
    checked.push(
      "Native provider tool call executes URL reading and returns its result through provider continuation",
    );
    await owner.page
      .locator(`[data-channel-id="${server.ai_channel}"] .channel`)
      .click({ button: "right" });
    await owner.page
      .getByRole("menuitem", { name: "Edit channel", exact: true })
      .click();
    await owner.page
      .getByRole("button", { name: "AI settings", exact: true })
      .click();
    await expect(
      owner.page.getByRole("combobox", { name: "Model", exact: true }),
    ).not.toHaveValue("");
    await owner.page
      .getByLabel("Allow the agent to switch personalities")
      .check();
    await owner.page
      .getByRole("button", { name: "Save AI settings", exact: true })
      .click();
    await expect
      .poll(async () => (await owner.api(channelPath)).allow_agent_switch)
      .toBe(true);
    await expect(
      owner.page.getByRole("button", { name: "Connect account", exact: true }),
    ).toBeDisabled();
    await owner.page
      .getByRole("button", { name: "Close", exact: true })
      .click();
    checked.push(
      "Web edits real server settings; provider connection is explicitly desktop-only",
    );
    const { roles } = await owner.api("/api/v1/roles");
    const everyone = roles.find((role) => role.is_default);
    assert(everyone);
    await owner.api(
      `/api/v1/channels/${server.ai_channel}/permissions/${everyone.id}`,
      "PUT",
      { allow: 3, deny: (1 << 18) | (1 << 19) },
    );
    await expect(bob.page.locator(".ai-conversation-status")).toContainText(
      "Your role cannot request AI responses.",
    );
    await bob.page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("@" + preset.name.slice(0, 2));
    await expect(
      bob.page.getByRole("option").filter({ hasText: "AI preset" }),
    ).toHaveCount(0);
    const denied = await send(
      bob,
      "Denied invocation still allows a visible human message",
    );
    await expect(alice.page.locator(`#message-${denied.id}`)).toBeVisible();
    assert(
      !(await owner.api(channelPath + "/turns")).turns.some(
        (t) => t.trigger_message_id === denied.id,
      ),
    );
    checked.push(
      "Role-denied invocation preserves visible posting and creates no durable turn",
    );
    const latest = await owner.api(channelPath);
    await bob.context.setOffline(true);
    await owner.api(channelPath, "PUT", {
      account_id: latest.account_id,
      provider: latest.provider,
      model: latest.model,
      name: latest.name,
      instructions: latest.instructions,
      max_bytes: 4096,
    });
    const boundaries = [];
    for (let i = 0; i < 6; i++) {
      await alice.api(
        `/api/v1/conversations/${server.ai_channel}/messages`,
        "POST",
        {
          request_id: crypto.randomUUID(),
          body: `Storage cycle ${i}: ` + "history ".repeat(180),
          attachment_ids: [],
        },
      );
      boundaries.push((await owner.api(channelPath + "/usage")).pruned_through);
    }
    assert(
      boundaries.at(-1) > first.seq,
      "Repeated pressure advances the durable prune boundary",
    );
    assert(
      boundaries.at(-1) > boundaries[0],
      "More than one pressure cycle prunes history",
    );
    const surviving = await alice.api(
      `/api/v1/conversations/${server.ai_channel}/messages`,
      "POST",
      {
        request_id: crypto.randomUUID(),
        body: "Retained after storage pruning",
        attachment_ids: [],
      },
    );
    await bob.context.setOffline(false);
    await expect(bob.page.locator(".connection")).toHaveText("Connected", {
      timeout: 30000,
    });
    await expect(bob.page.locator(`#message-${first.id}`)).toHaveCount(0);
    await expect(bob.page.locator(`#message-${firstReply.id}`)).toHaveCount(0);
    await expect(bob.page.locator(`#message-${surviving.id}`)).toContainText(
      surviving.body,
    );
    const retained = await owner.api(
      `/api/v1/conversations/${server.ai_channel}/messages?limit=100`,
    );
    assert(retained.messages.some((message) => message.id === surviving.id));
    assert((retained.messages ?? []).every((m) => m.seq > boundaries.at(-1)));
    const usage = await owner.api(channelPath + "/usage");
    assert(usage.channel_bytes <= usage.channel_max_bytes);
    checked.push(
      "Repeated storage pressure prunes oldest server history and offline cache after reconnect while preserving retained messages",
    );
    await bob.page.screenshot({
      path: "test-results/ai-server.png",
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    await fs.writeFile(
      "test-results/ai-server.json",
      JSON.stringify(
        {
          source:
            "Production client, HTTP API, PostgreSQL, AI workers, and native Claude transport; isolated upstream fixture",
          checked,
          providerLiveOAuth: false,
          providerLiveInference: false,
          pruneBoundaries: boundaries,
        },
        null,
        2,
      ),
    );
    console.log("Real-server AI browser scenarios passed.");
  } catch (error) {
    for (let i = 0; i < pages.length; i++)
      await pages[i]
        .screenshot({
          path: `test-results/ai-server-failure-${i}.png`,
          fullPage: true,
        })
        .catch(() => {});
    throw error;
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
}
