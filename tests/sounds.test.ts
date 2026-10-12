import { describe, expect, it } from "vitest";
import { VoiceCues, type Cue } from "../packages/browser/src/sounds";
import type { CallSnapshot } from "../packages/browser/src/media/call";
const state = {
  muted: false,
  deafened: false,
  camera_off: true,
  screen_off: true,
};
function snapshot(
  status: CallSnapshot["status"],
  users: string[],
  deafened = false,
) {
  return {
    status,
    state: { ...state, deafened },
    participants: users.map((user, i) => ({
      participant_id: `device-${i}`,
      user_id: user,
      joined_at: "2026-10-10T00:00:00Z",
      state,
      tracks: [],
    })),
  };
}
describe("voice interface sounds", () => {
  it("announces real membership changes without replaying initial room occupants or duplicate events", () => {
    const cues: Cue[] = [],
      sounds = new VoiceCues("self", (cue) => cues.push(cue));
    sounds.observe(snapshot("joining", ["self", "alice"]));
    sounds.observe(snapshot("connected", ["self", "alice"]));
    sounds.observe(snapshot("connected", ["self", "alice"]));
    sounds.observe(snapshot("connected", ["self", "alice", "alice"]));
    sounds.observe(snapshot("connected", ["self", "alice", "bob"]));
    sounds.observe(snapshot("connected", ["self", "bob"]));
    sounds.observe(snapshot("ended", []));
    sounds.observe(snapshot("ended", []));
    expect(cues).toEqual(["connected", "joined", "left", "disconnected"]);
  });
  it("resets the roster baseline on reconnect and suppresses peer sounds while deafened", () => {
    const cues: Cue[] = [],
      sounds = new VoiceCues("self", (cue) => cues.push(cue));
    sounds.observe(snapshot("connected", ["self", "alice"]));
    sounds.observe(snapshot("reconnecting", []));
    sounds.observe(snapshot("connected", ["self", "bob"]));
    sounds.observe(snapshot("connected", ["self", "bob", "charlie"], true));
    sounds.observe(snapshot("connected", ["self"], true));
    sounds.observe(snapshot("connected", ["self"]));
    expect(cues).toEqual(["connected", "connected", "deafened", "undeafened"]);
  });
  it("does not announce a disconnect for a call that never connected", () => {
    const cues: Cue[] = [],
      sounds = new VoiceCues("self", (cue) => cues.push(cue));
    sounds.observe(snapshot("joining", []));
    sounds.observe(snapshot("ended", []));
    expect(cues).toEqual([]);
  });
});

it("plays local state transitions once and announces screen starts only to established room listeners", () => {
  const local: Cue[] = [],
    remote: Cue[] = [];
  const a = new VoiceCues("self", (cue) => local.push(cue)),
    b = new VoiceCues("alice", (cue) => remote.push(cue));
  let value = snapshot("connected", ["self", "alice"]);
  a.observe(value);
  b.observe(value);
  value = { ...value, state: { ...value.state, muted: true } };
  a.observe(value);
  a.observe(value);
  value = { ...value, state: { ...value.state, muted: false, deafened: true } };
  a.observe(value);
  value = { ...value, state: { ...value.state, deafened: false } };
  a.observe(value);
  const sharing = {
    ...value,
    participants: value.participants.map((p) =>
      p.user_id === "self"
        ? { ...p, state: { ...p.state, screen_off: false } }
        : p,
    ),
  };
  a.observe(sharing);
  b.observe(sharing);
  a.observe(sharing);
  b.observe(sharing);
  expect(local).toEqual([
    "connected",
    "muted",
    "unmuted",
    "deafened",
    "undeafened",
    "screen_started",
  ]);
  expect(remote).toEqual(["connected", "screen_started"]);
  const late: Cue[] = [],
    newcomer = new VoiceCues("third", (cue) => late.push(cue));
  newcomer.observe(sharing);
  newcomer.observe({ ...sharing, status: "reconnecting" });
  newcomer.observe(sharing);
  expect(late).toEqual(["connected", "connected"]);
  b.observe({ ...value, state: { ...value.state, deafened: true } });
  b.observe({ ...sharing, state: { ...value.state, deafened: true } });
  b.observe(sharing);
  expect(remote).toEqual([
    "connected",
    "screen_started",
    "deafened",
    "undeafened",
  ]);
});
