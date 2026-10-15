import { beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import "fake-indexeddb/auto";
import {
  mentions,
  shouldNotify,
  type InstanceClient,
  type WireEvent,
} from "@haunt/core";
import { NotificationCenter } from "../packages/browser/src/notifications";
import {
  getPreferences,
  setPreferences,
  customSound,
  saveCustomSound,
} from "../packages/browser/src/preferences";
const { validateNotification, validateBadge } = createRequire(import.meta.url)(
  "../apps/desktop/notifications.cjs",
);
const policy = {
  enabled: true,
  mentions: true,
  directMessages: true,
  channelMessages: false,
  whileViewing: false,
};
const event = { own: false, mentioned: false, direct: false, viewing: false };
beforeEach(() =>
  setPreferences({ ...policy, servers: {}, channels: {}, users: {} }),
);
describe("mentions and notification rules", () => {
  it("recognizes whole immutable usernames with punctuation and preserves text offsets", () => {
    const text = "🙂 (@Alice), @bob! @owner_123\n@CAROL";
    expect(
      mentions(text).map((m) => [m.username, text.slice(m.start, m.end)]),
    ).toEqual([
      ["alice", "@Alice"],
      ["bob", "@bob"],
      ["owner_123", "@owner_123"],
      ["carol", "@CAROL"],
    ]);
    expect(
      mentions(
        "a@alice.test https://host/@bob @ab @abcdefghijklmnopqrstuvwxyz123456789",
      ),
    ).toEqual([]);
  });
  it("defaults to mentions and DMs, silencing own messages and the focused conversation", () => {
    expect(shouldNotify(policy, event)).toBe(false);
    expect(shouldNotify(policy, { ...event, mentioned: true })).toBe(true);
    expect(shouldNotify(policy, { ...event, direct: true })).toBe(true);
    expect(shouldNotify(policy, { ...event, direct: true, own: true })).toBe(
      false,
    );
    expect(
      shouldNotify(policy, { ...event, direct: true, viewing: true }),
    ).toBe(false);
    expect(
      shouldNotify(
        { ...policy, whileViewing: true },
        { ...event, direct: true, viewing: true },
      ),
    ).toBe(true);
  });
  it("respects explicit channel rules, server mutes and the global master switch", () => {
    expect(shouldNotify(policy, { ...event, serverRule: "all" })).toBe(true);
    expect(
      shouldNotify(policy, {
        ...event,
        serverRule: "all",
        channelRule: "mentions",
      }),
    ).toBe(false);
    expect(
      shouldNotify(policy, {
        ...event,
        serverRule: "mentions",
        channelRule: "all",
      }),
    ).toBe(true);
    expect(
      shouldNotify(policy, {
        ...event,
        serverRule: "mute",
        channelRule: "all",
        mentioned: true,
      }),
    ).toBe(false);
    expect(
      shouldNotify(policy, {
        ...event,
        serverRule: "all",
        channelRule: "mute",
        direct: true,
      }),
    ).toBe(false);
    expect(
      shouldNotify(
        { ...policy, enabled: false },
        { ...event, channelRule: "all", mentioned: true },
      ),
    ).toBe(false);
  });
});
function fixture(center: NotificationCenter) {
  let wire: (event: WireEvent) => void = () => {},
    change = () => {};
  const fake = {
    scope: '["server","self"]',
    liveEventCursor: 100,
    account: {
      instance: { instance_id: "server", name: "Server" },
      login: { user: { id: "self", username: "owner" } },
    },
    snapshot: {
      status: "online",
      channels: [{ id: "channel", name: "general" }],
      conversations: [{ id: "dm", kind: "dm" }],
      users: [{ id: "other", username: "alice" }],
    },
    subscribe: (fn: () => void) => {
      change = fn;
      return () => {
        change = () => {};
      };
    },
    onWire: (fn: (event: WireEvent) => void) => {
      wire = fn;
      return () => {
        wire = () => {};
      };
    },
  };
  const stop = center.attach(fake as unknown as InstanceClient);
  const send = (
    id: number,
    patch: Record<string, unknown> = {},
    type = "message.created",
  ) =>
    wire({
      type,
      id,
      conversation_id: "channel",
      data: {
        id: `m${id}`,
        body: "Hello @owner",
        author_id: "other",
        conversation_id: "channel",
        ...patch,
      },
    });
  return {
    fake,
    send,
    emit: (value: WireEvent) => wire(value),
    changed: () => change(),
    stop,
  };
}
describe("notification delivery", () => {
  it("applies server-scoped sender rules to live DMs without muting their channel messages", () => {
    const center = new NotificationCenter(),
      f = fixture(center);
    const delivered: string[] = [];
    center.deliver = (p) => delivered.push(p.id);
    setPreferences({ users: { '["server","other"]': "mute" } });
    // Send a correctly routed DM gateway event.
    const dm = (id: number) =>
      f.emit({
        type: "message.created",
        id,
        conversation_id: "dm",
        data: {
          id: `dm${id}`,
          body: "Hello",
          author_id: "other",
          conversation_id: "dm",
        },
      });
    dm(102);
    expect(delivered).toHaveLength(0);
    f.send(103);
    expect(delivered).toHaveLength(1);
    setPreferences({ channels: { '["server","dm"]': "all" } });
    dm(104);
    expect(delivered).toHaveLength(2);
    setPreferences({
      channels: {},
      users: { '["other-server","other"]': "mute" },
    });
    dm(105);
    expect(delivered).toHaveLength(3);
    f.stop();
  });

  it("deduplicates live/recovered events and ignores old history, edits, self messages and malformed input", () => {
    const center = new NotificationCenter(),
      f = fixture(center);
    const delivered: string[] = [];
    center.deliver = (p) => delivered.push(p.id);
    f.send(99);
    f.send(101);
    f.send(101);
    f.send(101, {}, "message.discovered");
    f.send(102, {}, "message.updated");
    f.send(103, { author_id: "self" });
    f.send(104, { body: 4 });
    expect(delivered).toHaveLength(1);
    expect(center.getSnapshot()).toHaveLength(1);
    f.emit({ type: "ready", event_cursor: 200 });
    f.send(199);
    f.send(201);
    expect(delivered).toHaveLength(2);
    f.fake.snapshot.status = "syncing";
    f.send(202);
    expect(delivered).toHaveLength(2);
    f.stop();
    expect(center.getSnapshot()).toHaveLength(0);
    f.send(203);
    expect(delivered).toHaveLength(2);
  });
  it("updates inbox previews and removes deleted messages without another ping", () => {
    const center = new NotificationCenter(),
      f = fixture(center);
    let delivered = 0;
    center.deliver = () => {
      delivered++;
    };
    f.send(101);
    f.send(102, { id: "m101", body: "Corrected message" }, "message.updated");
    expect(center.getSnapshot()[0].body).toBe("Corrected message");
    f.send(103, { id: "m101" }, "message.deleted");
    expect(center.getSnapshot()).toHaveLength(0);
    expect(delivered).toBe(1);
    f.stop();
  });
  it("bounds the inbox and clears only the requested conversation or revoked account", () => {
    const center = new NotificationCenter(),
      f = fixture(center);
    for (let i = 101; i < 165; i++) f.send(i);
    expect(center.getSnapshot()).toHaveLength(50);
    center.clear(f.fake.scope, "dm");
    expect(center.getSnapshot()).toHaveLength(50);
    f.emit({ type: "subscription.revoked", conversation_id: "channel" });
    expect(center.getSnapshot()).toHaveLength(0);
    f.send(170);
    f.fake.snapshot.status = "signed-out";
    f.changed();
    expect(center.getSnapshot()).toHaveLength(0);
    f.stop();
  });
  it("silences matching foreground conversations and disabled preferences", () => {
    const center = new NotificationCenter(),
      f = fixture(center);
    center.viewing = (_, id) => id === "channel";
    f.send(101);
    expect(center.getSnapshot()).toHaveLength(0);
    center.viewing = () => false;
    setPreferences({ enabled: false });
    f.send(102);
    expect(center.getSnapshot()).toHaveLength(0);
    setPreferences({ enabled: true });
    f.send(103);
    expect(center.getSnapshot()).toHaveLength(1);
    f.fake.snapshot.channels = [];
    f.changed();
    expect(center.getSnapshot()).toHaveLength(0);
    f.stop();
  });
  it("waits for new DM metadata and suppresses old replay before delivering once", () => {
    const center = new NotificationCenter(),
      f = fixture(center);
    let delivered = 0;
    center.deliver = () => delivered++;
    const data = {
      id: "new-message",
      conversation_id: "new-dm",
      author_id: "other",
      body: "A direct message",
    };
    f.emit({
      type: "message.created",
      id: 99,
      conversation_id: "new-dm",
      data,
    });
    f.emit({
      type: "message.created",
      id: 101,
      conversation_id: "new-dm",
      data,
    });
    expect(delivered).toBe(0);
    f.fake.snapshot.conversations.push({ id: "new-dm", kind: "dm" });
    f.changed();
    expect(delivered).toBe(1);
    f.changed();
    expect(delivered).toBe(1);
    f.stop();
  });
  it("rejects unbounded badge counts and non-PNG/local icon payloads", () => {
    const value = {
      count: 12,
      unread: true,
      icon: "data:image/png;base64,iVBORw0KGgo=",
      overlay: "data:image/png;base64,iVBORw0KGgo=",
    };
    expect(validateBadge({ ...value, arbitrary: "ignored" })).toEqual(value);
    for (const bad of [
      null,
      {},
      { ...value, count: -1 },
      { ...value, count: 1000000 },
      { ...value, count: 1.5 },
      { ...value, unread: "yes" },
      { ...value, icon: "https://x.test/icon.png" },
      { ...value, icon: value.icon + "A".repeat(32768) },
    ])
      expect(() => validateBadge(bad)).toThrow("Invalid badge");
  });
  it("stores custom audio locally and removes it without affecting other preferences", async () => {
    await saveCustomSound(new Blob(["audio"], { type: "audio/wav" }));
    expect(await (await customSound())?.text()).toBe("audio");
    await saveCustomSound(null);
    expect(await customSound()).toBeUndefined();
    expect(getPreferences().enabled).toBe(true);
  });
  it("validates the desktop notification bridge and drops arbitrary payload fields", () => {
    const good = {
      title: "Alice",
      body: "Hello",
      instance: "00000000-0000-0000-0000-000000000001",
      conversation: "00000000-0000-0000-0000-000000000002",
    };
    expect(
      validateNotification({ ...good, url: "https://untrusted.test" }),
    ).toEqual(good);
    expect(
      validateNotification({ ...good, instance: "named-server_123" }).instance,
    ).toBe("named-server_123");
    expect(() =>
      validateNotification({ ...good, instance: "x".repeat(129) }),
    ).toThrow("Invalid notification");
    for (const bad of [
      null,
      {},
      { ...good, title: "x".repeat(241) },
      { ...good, body: "x".repeat(401) },
      { ...good, conversation: "https://test" },
      { ...good, instance: [] },
    ])
      expect(() => validateNotification(bad)).toThrow("Invalid notification");
  });
});
