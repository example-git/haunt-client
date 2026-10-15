import { expect, it, vi } from "vitest";
import { UserPresence } from "@haunt/core";

it("replaces ephemeral presence and only notifies affected user subscriptions", () => {
  const presence = new UserPresence(),
    other = new UserPresence();
  const alice = vi.fn(),
    bob = vi.fn();
  const off = presence.subscribe("alice", alice);
  presence.subscribe("bob", bob);
  expect(presence.status("alice")).toBe("unknown");
  presence.receive(["alice"]);
  expect(presence.status("alice")).toBe("online");
  expect(presence.status("bob")).toBe("offline");
  expect(other.status("alice")).toBe("unknown");
  presence.receive(["alice", "alice"]);
  expect(alice).toHaveBeenCalledTimes(1);
  presence.receive(["alice", "bob"]);
  expect(alice).toHaveBeenCalledTimes(1);
  expect(bob).toHaveBeenCalledTimes(2);
  presence.receive(["bob"]);
  expect(presence.status("alice")).toBe("offline");
  presence.clear();
  expect(presence.status("bob")).toBe("unknown");
  expect(bob).toHaveBeenCalledTimes(3);
  off();
  presence.receive(["alice"]);
  expect(alice).toHaveBeenCalledTimes(3);
});

it("rejects malformed and oversized snapshots without losing last known state", () => {
  const presence = new UserPresence();
  presence.receive(["alice"]);
  for (const value of [
    null,
    {},
    [1],
    [""],
    ["x".repeat(65)],
    Array(513).fill("alice"),
  ]) {
    presence.receive(value);
    expect(presence.status("alice")).toBe("online");
  }
  presence.receive([]);
  expect(presence.status("alice")).toBe("offline");
});
it("updates section subscribers only on an actual presence change", () => {
  const presence = new UserPresence(),
    changed = vi.fn();
  const off = presence.subscribeRoster(changed);
  presence.receive(["alice"]);
  presence.receive(["alice", "alice"]);
  expect(changed).toHaveBeenCalledTimes(1);
  presence.receive(["bob", "alice"]);
  presence.receive(["alice", "bob"]);
  expect(changed).toHaveBeenCalledTimes(2);
  expect(presence.rosterRevision()).toBe(2);
  off();
  presence.clear();
  expect(changed).toHaveBeenCalledTimes(2);
});
