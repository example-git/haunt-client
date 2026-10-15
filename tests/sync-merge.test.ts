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
