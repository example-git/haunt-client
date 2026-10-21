import { describe, expect, it } from "vitest";
import { merge, SyncConflict } from "../packages/browser/src/sync/engine";
describe("sync merge", () => {
  it("preserves simultaneous independent changes and deletions", () => {
    const before = { a: "old", b: "old", c: "remove" };
    expect(
      merge(
        { local: before, remote: before, revision: 3 },
        { a: "local", b: "old" },
        { a: "old", b: "cloud", c: "remove" },
      ),
    ).toEqual({ a: "local", b: "cloud" });
  });
  it("requires a visible decision for conflicting edits", () => {
    const before = { theme: "old", sound: "old" },
      local = { theme: "local", sound: "old" },
      remote = { theme: "cloud", sound: "new" };
    expect(() =>
      merge({ local: before, remote: before, revision: 1 }, local, remote),
    ).toThrow(SyncConflict);
    expect(
      merge(
        { local: before, remote: before, revision: 1 },
        local,
        remote,
        "local",
      ),
    ).toEqual({ theme: "local", sound: "new" });
    expect(
      merge(
        { local: before, remote: before, revision: 1 },
        local,
        remote,
        "cloud",
      ),
    ).toEqual(remote);
  });
  const account = (
    token: string,
    user = "alice",
    origin = "https://one.test",
    instance = "one",
  ) => ({
    origin,
    instance: { instance_id: instance },
    login: { token, session: { id: token }, user: { id: user } },
  });
  it("merges independent sessions for the same account without changing conflict choices", () => {
    const before = { "account:one": account("original") };
    const local = { "account:one": account("local-session") };
    const remote = { "account:one": account("remote-session") };
    const baseline = { local: before, remote: before, revision: 1 };
    expect(merge(baseline, local, remote)).toEqual(local);
    expect(merge(baseline, local, remote, "local")).toEqual(local);
    expect(merge(baseline, local, remote, "cloud")).toEqual(remote);
    expect(
      merge({ local, remote: before, revision: 1 }, local, remote),
    ).toEqual(remote);
  });
  it.each([
    account("remote-session", "bob"),
    account("remote-session", "alice", "https://other.test"),
    account("remote-session", "alice", "https://one.test", "replacement"),
  ])("requires a decision when account identity differs", (remoteAccount) => {
    const before = { "account:one": account("original") };
    expect(() =>
      merge(
        { local: before, remote: before, revision: 1 },
        { "account:one": account("local-session") },
        { "account:one": remoteAccount },
      ),
    ).toThrow(SyncConflict);
  });
  it("preserves account deletion conflicts and unrelated preference conflicts", () => {
    const before = { "account:one": account("original"), theme: "old" };
    const local = { "account:one": account("local-session"), theme: "local" };
    expect(() =>
      merge({ local: before, remote: before, revision: 1 }, local, {
        theme: "old",
      }),
    ).toThrow(SyncConflict);
    try {
      merge({ local: before, remote: before, revision: 1 }, local, {
        "account:one": account("remote-session"),
        theme: "cloud",
      });
      expect.fail("Expected a preference conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(SyncConflict);
      expect((error as SyncConflict).fields).toEqual(["theme"]);
    }
  });
  it("merges server usage timestamps without overriding explicit choices", () => {
    const server = {
      origin: "https://one.test",
      instanceId: "one",
      username: "alice",
      name: "Community",
      lastUsed: 1,
    };
    const key = 'server:["https://one.test","alice"]';
    const before = { [key]: server };
    const local = { [key]: { ...server, lastUsed: 3 } };
    const remote = { [key]: { ...server, lastUsed: 2 } };
    const baseline = { local: before, remote: before, revision: 1 };
    expect(merge(baseline, local, remote)).toEqual(local);
    expect(merge(baseline, remote, local)).toEqual(local);
    expect(merge(baseline, local, remote, "cloud")).toEqual(remote);
    expect(merge(baseline, local, remote, "local")).toEqual(local);
    expect(merge({ local, remote, revision: 2 }, local, remote)).toEqual(
      remote,
    );
    expect(() =>
      merge(baseline, local, {
        [key]: { ...server, name: "Different community", lastUsed: 2 },
      }),
    ).toThrow(SyncConflict);
    expect(() => merge(baseline, local, {})).toThrow(SyncConflict);
  });
  it("recognizes the same value independently of JSON property order", () => {
    expect(
      merge(
        { local: { value: {} }, remote: { value: {} }, revision: 1 },
        { value: { a: 1, b: 2 } },
        { value: { b: 2, a: 1 } },
      ),
    ).toEqual({ value: { b: 2, a: 1 } });
  });
});
