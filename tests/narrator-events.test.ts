import { describe, expect, it } from "vitest";
import { NarratorEvents } from "../packages/browser/src/narrator/events";
import {
  narrationText,
  narratorUserKey,
  normalizeNarratorSettings,
} from "../packages/browser/src/narrator/settings";
import type { CallSnapshot } from "../packages/browser/src/media/call";

const state = {
  muted: false,
  deafened: false,
  camera_off: true,
  screen_off: true,
};
function snapshot(
  users: string[],
  status: CallSnapshot["status"] = "connected",
) {
  return {
    status,
    state,
    participants: users.map((user, index) => ({
      user_id: user,
      participant_id: String(index),
      joined_at: "2026-10-19T00:00:00Z",
      state,
      tracks: [],
    })),
  };
}
function setup() {
  let now = 10_000;
  const settings = normalizeNarratorSettings({
    enabled: true,
    cooldownMs: 1500,
    voice: "configured_voice",
  });
  const events = new NarratorEvents(
    "self",
    "server-account",
    (id) => ({ username: id, displayName: id.toUpperCase() }),
    () => "Lounge",
    () => now,
  );
  return {
    settings,
    events,
    advance: () => {
      now += 2000;
    },
  };
}

describe("client voice narrator", () => {
  it("baselines initial occupants and reconnects, counting users rather than devices", () => {
    const { events, settings } = setup();
    expect(events.observe(snapshot(["self", "alice"]), settings)).toEqual([]);
    expect(
      events.observe(snapshot(["self", "alice", "alice"]), settings),
    ).toEqual([]);
    expect(
      events.observe(snapshot(["self", "alice", "bob"]), settings),
    ).toEqual([
      {
        text: "BOB joined Lounge",
        voice: "configured_voice",
        user: "bob",
        event: "joined",
      },
    ]);
    expect(events.observe(snapshot([], "reconnecting"), settings)).toEqual([]);
    expect(events.observe(snapshot(["self", "charlie"]), settings)).toEqual([]);
    expect(events.observe(snapshot([], "ended"), settings)).toEqual([]);
  });
  it("preserves extension-default selection and explicit voice changes", () => {
    const { events } = setup();
    const settings = normalizeNarratorSettings({
      enabled: true,
      provider: "example-tts",
    });
    events.observe(snapshot(["self"]), settings);
    expect(events.observe(snapshot(["self", "alice"]), settings)[0].voice).toBe(
      "",
    );
    settings.voice = "selected_voice";
    expect(
      events.observe(snapshot(["self", "alice", "bob"]), settings)[0].voice,
    ).toBe("selected_voice");
  });
  it("honors cooldowns, blanks, user ignores, account-scoped voices and live settings", () => {
    const { events, settings, advance } = setup();
    settings.users[narratorUserKey("another-server", "bob")] = {
      voice: "wrong",
      ignored: true,
    };
    settings.users[narratorUserKey("server-account", "bob")] = {
      voice: "en_us_ghostface",
      ignored: false,
    };
    events.observe(snapshot(["self"]), settings);
    expect(events.observe(snapshot(["self", "bob"]), settings)[0].voice).toBe(
      "en_us_ghostface",
    );
    expect(events.observe(snapshot(["self"]), settings)).toEqual([]);
    advance();
    events.observe(snapshot(["self", "bob"]), settings);
    settings.users[narratorUserKey("server-account", "bob")].ignored = true;
    advance();
    expect(events.observe(snapshot(["self"]), settings)).toEqual([]);
    settings.templates.joined = "";
    expect(events.observe(snapshot(["self", "charlie"]), settings)).toEqual([]);
    settings.enabled = false;
    events.observe(snapshot(["self", "alice"]), settings);
    settings.enabled = true;
    expect(events.observe(snapshot(["self", "alice"]), settings)).toEqual([]);
  });
  it("announces opted-in peer state changes once and stays silent while deafened", () => {
    const { events, settings } = setup();
    Object.assign(settings, { mute: true, deafen: true, screen: true });
    events.observe(snapshot(["self", "alice"]), settings);
    const changed = snapshot(["self", "alice"]);
    changed.participants[1].state = {
      ...state,
      muted: true,
      deafened: true,
      screen_off: false,
    };
    expect(events.observe(changed, settings).map((item) => item.event)).toEqual(
      ["muted", "deafened", "streamStarted"],
    );
    expect(events.observe(changed, settings)).toEqual([]);
    expect(
      events.observe(
        { ...snapshot(["self", "bob"]), state: { ...state, deafened: true } },
        settings,
      ),
    ).toEqual([]);
    expect(events.observe(snapshot(["self", "bob"]), settings)).toEqual([]);
  });
  it("bounds Unicode prompts by bytes without splitting characters and normalizes saved settings", () => {
    expect(
      new TextEncoder().encode(narrationText("👻".repeat(200))).length,
    ).toBe(500);
    const settings = normalizeNarratorSettings({
      volume: 200,
      rate: -1,
      enabled: "yes",
      users: [],
      templates: { joined: "" },
    });
    expect(settings.volume).toBe(100);
    expect(settings.rate).toBe(0.5);
    expect(settings.enabled).toBe(false);
    expect(settings.templates.joined).toBe("");
    expect(settings.users).toEqual({});
  });
});
