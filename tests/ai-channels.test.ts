import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import http from "node:http";
import { once } from "node:events";
import {
  archivedText,
  packTextChunk,
  unpackTextChunk,
  messageAuthorKey,
  messageAuthorName,
  aiMention,
  aiMentions,
  mentions,
  AIClient,
  type AITurn,
  type InstanceClient,
  type Message,
} from "@haunt/core";
import { IndexedDBStore } from "../packages/browser/src/storage";
const { AIOAuth } = createRequire(import.meta.url)(
  "../apps/desktop/ai-oauth.cjs",
);
const ai = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Sage",
  avatar_url: "/api/v1/channels/22222222-2222-4222-8222-222222222222/ai/avatar",
};
const scope = JSON.stringify(["server", "user"]);
const message = (seq: number, name = "Sage"): Message => ({
  id: `message-${seq}`,
  conversation_id: "room",
  author_id: "",
  ai_author: { ...ai, name },
  body: `AI response ${seq}`,
  seq,
  created_at: "2026-11-14T12:00:00Z",
  deleted: false,
  attachment_ids: [],
  request_id: `request-${seq}`,
});
const stores: IndexedDBStore[] = [];
const store = (name = crypto.randomUUID()) => {
  const db = new IndexedDBStore(name);
  stores.push(db);
  return db;
};
afterEach(async () => {
  await Promise.all(stores.splice(0).map((s) => s.close()));
});
it("preserves AI snapshot identity through archive serialization and distinguishes human mentions", async () => {
  const row = archivedText(message(1))!;
  const packed = await packTextChunk({ scope, conversation: "room", part: 0 }, [
    row,
  ]);
  expect((await unpackTextChunk(packed))[0].ai_author).toEqual(ai);
  expect(messageAuthorKey(message(1))).toBe(`ai:${ai.id}`);
  expect(
    messageAuthorKey({ ...message(1), ai_author: { ...ai, id: "different" } }),
  ).not.toBe(messageAuthorKey(message(1)));
  expect(messageAuthorName(message(1), [])).toBe("Sage");
  const text = `@sage ${aiMention(ai.id)}`;
  expect(mentions(text).map((m) => m.username)).toEqual(["sage"]);
  expect(aiMentions(text).map((m) => m.id)).toEqual([ai.id]);
});
it("prunes AI text, searches and archives and prevents resurrection by stale fetch or import after reopen", async () => {
  const name = crypto.randomUUID();
  let db = store(name);
  await db.merge(scope, [
    message(1),
    message(2),
    message(3),
    { ...message(1), id: "other", conversation_id: "other" },
  ]);
  const old = await db.textArchiveChunks();
  await db.pruneHistory(scope, "room", 2);
  expect((await db.messages(scope, "room")).map((m) => m.seq)).toEqual([3]);
  expect(
    (await db.search(scope, "room", "response")).messages.map((m) => m.seq),
  ).toEqual([3]);
  expect(
    (await db.archivedMessages(scope)).messages
      .filter((m) => m.conversation_id === "room")
      .map((m) => m.seq),
  ).toEqual([3]);
  await db.close();
  db = store(name);
  await db.merge(scope, [message(1), message(2)]);
  await db.restoreTextArchive(old);
  expect((await db.messages(scope, "room")).map((m) => m.seq)).toEqual([3]);
  expect(
    (await db.archivedMessages(scope)).messages
      .filter((m) => m.conversation_id === "room")
      .map((m) => m.seq),
  ).toEqual([3]);
  expect(await db.messages(scope, "other")).toHaveLength(1);
  await db.pruneHistory(scope, "room", 3);
  await db.merge(scope, [message(4)]);
  expect((await db.messages(scope, "room")).map((m) => m.seq)).toEqual([4]);
});
it("keeps streaming revisions monotonic and refreshes authoritative state on reconnect", async () => {
  const channel = "22222222-2222-4222-8222-222222222222";
  const turn: AITurn = {
    id: "turn",
    channel_id: channel,
    actor_id: "user",
    trigger_message_id: "trigger",
    status: "running",
    revision: 3,
    partial_text: "Current",
    created_at: "2026-11-14T12:00:00Z",
    updated_at: "2026-11-14T12:00:01Z",
  };
  const pruneAIHistory = vi.fn();
  const request = vi.fn(async (path: string) =>
    path.endsWith("/presets")
      ? { presets: [] }
      : path.endsWith("/turns")
        ? { turns: [turn] }
        : path.endsWith("/usage")
          ? { pruned_through: 4 }
          : { channel_id: channel, revision: 1 },
  );
  const client = new AIClient({
    aiRequest: request,
    pruneAIHistory,
    snapshot: { channels: [{ id: channel, kind: "ai" }] },
  } as unknown as InstanceClient);
  const unwatch = client.watch(channel);
  client.receive({ type: "ai.turn.updated", data: turn });
  client.receive({
    type: "ai.turn.updated",
    data: { ...turn, revision: 2, partial_text: "Old" },
  });
  expect(client.channel(channel).turns[0].partial_text).toBe("Current");
  client.reconnect();
  await vi.waitFor(() =>
    expect(pruneAIHistory).toHaveBeenCalledWith(channel, 4),
  );
  expect(client.channel(channel).turns[0].revision).toBe(3);
  client.receive({ type: "subscription.revoked", conversation_id: channel });
  expect(client.channel(channel).turns).toHaveLength(0);
  unwatch();
});
it("shows the latest failures after loading newest-first server history", async () => {
  const channel = "22222222-2222-4222-8222-222222222222";
  const newestFirst: AITurn[] = Array.from({ length: 8 }, (_, i) => ({
    id: `turn-${8 - i}`,
    channel_id: channel,
    actor_id: "user",
    trigger_message_id: `trigger-${8 - i}`,
    status: "failed",
    revision: 1,
    created_at: `2026-11-14T12:00:0${8 - i}Z`,
    updated_at: `2026-11-14T12:00:0${8 - i}Z`,
  }));
  const client = new AIClient({
    aiRequest: async (path: string) =>
      path.endsWith("/presets")
        ? { presets: [] }
        : path.endsWith("/turns")
          ? { turns: newestFirst }
          : path.endsWith("/usage")
            ? { pruned_through: 0 }
            : { channel_id: channel, revision: 1 },
    pruneAIHistory: async () => {},
    snapshot: { channels: [{ id: channel, kind: "ai" }] },
  } as unknown as InstanceClient);
  await client.refresh(channel);
  expect(
    client
      .channel(channel)
      .turns.slice(-5)
      .map((turn) => turn.id),
  ).toEqual(["turn-4", "turn-5", "turn-6", "turn-7", "turn-8"]);
  client.receive({
    type: "ai.turn.updated",
    data: {
      ...newestFirst[0],
      id: "turn-9",
      status: "running",
      created_at: "2026-11-14T12:00:09Z",
    },
  });
  expect(client.channel(channel).turns.at(-1)?.id).toBe("turn-9");
});
it("reloads shared settings when a newer event arrives during an older request", async () => {
  const channel = "22222222-2222-4222-8222-222222222222";
  let revision = 1;
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pruneAIHistory = vi.fn().mockImplementationOnce(() => waiting);
  const request = vi.fn(async (path: string) =>
    path.endsWith("/presets")
      ? { presets: [] }
      : path.endsWith("/turns")
        ? { turns: [] }
        : path.endsWith("/usage")
          ? { pruned_through: 0 }
          : {
              channel_id: channel,
              revision,
              name: revision === 1 ? "Guide" : "Sage",
            },
  );
  const client = new AIClient({
    aiRequest: request,
    pruneAIHistory,
    snapshot: { channels: [{ id: channel, kind: "ai" }] },
  } as unknown as InstanceClient);
  const refreshing = client.refresh(channel);
  await vi.waitFor(() => expect(pruneAIHistory).toHaveBeenCalledOnce());
  revision = 2;
  client.receive({
    type: "ai.settings.updated",
    conversation_id: channel,
    data: { revision },
  });
  release();
  await refreshing;
  expect(client.channel(channel).settings?.name).toBe("Sage");
  expect(client.channel(channel).settings?.revision).toBe(2);
  expect(pruneAIHistory).toHaveBeenCalledTimes(1);
});
it("does not restore revoked AI state when an in-flight refresh finishes", async () => {
  const channel = "22222222-2222-4222-8222-222222222222";
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pruneAIHistory = vi.fn(() => waiting);
  const client = new AIClient({
    aiRequest: async (path: string) =>
      path.endsWith("/presets")
        ? { presets: [] }
        : path.endsWith("/turns")
          ? { turns: [] }
          : path.endsWith("/usage")
            ? { pruned_through: 0 }
            : { channel_id: channel, revision: 1 },
    pruneAIHistory,
    snapshot: { channels: [{ id: channel, kind: "ai" }] },
  } as unknown as InstanceClient);
  const refreshing = client.refresh(channel);
  await vi.waitFor(() => expect(pruneAIHistory).toHaveBeenCalledOnce());
  client.receive({ type: "subscription.revoked", conversation_id: channel });
  release();
  await refreshing;
  expect(client.channel(channel).settings).toBeUndefined();
  expect(client.channel(channel).loading).toBeUndefined();
});
it("hydrates shared viewers once and handles activity and ordinary messages without extra reads", async () => {
  const channel = "22222222-2222-4222-8222-222222222222";
  const request = vi.fn(async (path: string) =>
    path.endsWith("/presets")
      ? { presets: [] }
      : path.endsWith("/turns")
        ? { turns: [] }
        : path.endsWith("/usage")
          ? { pruned_through: 0 }
          : { channel_id: channel, revision: 1 },
  );
  const client = new AIClient({
    aiRequest: request,
    pruneAIHistory: async () => {},
    snapshot: { channels: [{ id: channel, kind: "ai" }], status: "online" },
  } as unknown as InstanceClient);
  const first = client.watch(channel),
    second = client.watch(channel);
  await vi.waitFor(() => expect(client.channel(channel).loading).toBe(false));
  for (let revision = 1; revision <= 20; revision++) {
    client.receive({
      type: "message.created",
      conversation_id: channel,
      data: { author_id: "person" },
    });
    client.receive({
      type: "ai.turn.updated",
      conversation_id: channel,
      data: {
        id: "turn",
        channel_id: channel,
        revision,
        status:
          revision === 1 ? "queued" : revision === 20 ? "completed" : "running",
      },
    });
  }
  expect(request).toHaveBeenCalledTimes(4);
  first();
  second();
  client.reconnect();
  expect(request).toHaveBeenCalledTimes(4);
});
it("reserves Claude callback before browser launch and accepts only matching state", async () => {
  let callback = "";
  const oauth = new AIOAuth(async () => {
    const bad = await fetch(callback + "?code=wrong&state=wrong");
    expect(bad.status).toBe(400);
    const response = await fetch(callback + "?code=accepted&state=expected");
    expect(response.status).toBe(200);
  });
  try {
    const reserved = await oauth.reserve("claude", 1);
    callback = reserved.redirect_uri.replace("localhost", "127.0.0.1");
    expect((await fetch(callback)).status).toBe(400);
    const url = new URL("https://claude.com/cai/oauth/authorize");
    url.searchParams.set("redirect_uri", reserved.redirect_uri);
    url.searchParams.set("state", "expected");
    await expect(oauth.launch(reserved.id, url.href, 2)).rejects.toThrow(
      "unavailable",
    );
    await expect(oauth.launch(reserved.id, url.href, 1)).resolves.toEqual({
      code: "accepted",
      state: "expected",
    });
  } finally {
    oauth.shutdown();
  }
});
it("fails Codex's fixed-port conflict explicitly and keeps hosted-paste redirect exact", async () => {
  const listener = http.createServer();
  listener.listen(1455, "127.0.0.1");
  await once(listener, "listening");
  const oauth = new AIOAuth(vi.fn());
  try {
    await expect(oauth.reserve("codex", 1)).rejects.toThrow("1455");
    const reservation = await oauth.reserve("antigravity", 1);
    expect(reservation.redirect_uri).toBe(
      "https://antigravity.google/oauth-callback",
    );
    const url = new URL("https://accounts.google.com/o/oauth2/auth");
    url.searchParams.set("redirect_uri", reservation.redirect_uri);
    url.searchParams.set("state", "state");
    await expect(oauth.launch(reservation.id, url.href, 1)).resolves.toEqual({
      paste: true,
    });
  } finally {
    oauth.shutdown();
    listener.close();
  }
});
