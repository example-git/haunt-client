import { it, expect } from "vitest";
import { UserPresence, type User } from "@haunt/core";
import { memberGroups } from "../packages/browser/src/member-groups";
it("sorts online members first by display name without pinning an offline owner", () => {
  const presence = new UserPresence();
  presence.receive(["b", "c"]);
  const users = [
    { id: "a", username: "owner", display_name: "Aaron", is_owner: true },
    { id: "b", username: "bob", display_name: "Zed" },
    { id: "c", username: "charlie", display_name: "alice" },
    { id: "d", username: "beta" },
  ] as User[];
  expect(
    memberGroups(users, presence.status).map((g) => [
      g.label,
      g.users.map((u) => u.id),
    ]),
  ).toEqual([
    ["Online", ["c", "b"]],
    ["Offline", ["a", "d"]],
  ]);
  expect(
    memberGroups(users, presence.status, "OWNER").map((g) => g.label),
  ).toEqual(["Offline"]);
  presence.clear();
  expect(memberGroups(users, presence.status).map((g) => g.label)).toEqual([
    "Status unavailable",
  ]);
});
it("groups online users by enabled role rank without duplicating users or hoisting offline members", () => {
  const presence = new UserPresence();
  presence.receive(["a", "b", "c", "d"]);
  const high = { id: "high", name: "Hosts", position: 20 };
  const low = { id: "low", name: "Friends", position: 10 };
  const users = [
    { id: "a", username: "Zoe", display_role: high },
    { id: "b", username: "adam", display_role: high },
    { id: "c", username: "charlie", display_role: low },
    { id: "d", username: "bob" },
    { id: "e", username: "owner", display_role: high, is_owner: true },
  ] as User[];
  expect(
    memberGroups(users, presence.status).map((g) => [
      g.id,
      g.users.map((u) => u.id),
    ]),
  ).toEqual([
    ["role:high", ["b", "a"]],
    ["role:low", ["c"]],
    ["online", ["d"]],
    ["offline", ["e"]],
  ]);
  expect(
    memberGroups(users, presence.status, "adam").map((g) => [
      g.label,
      g.users.length,
    ]),
  ).toEqual([["Hosts", 1]]);
  presence.receive(["c", "d"]);
  expect(memberGroups(users, presence.status).map((g) => g.id)).toEqual([
    "role:low",
    "online",
    "offline",
  ]);
  presence.clear();
  expect(memberGroups(users, presence.status).map((g) => g.id)).toEqual([
    "unknown",
  ]);
});
it("reflects role renames, ranks and removal without retaining stale sections", () => {
  const status = () => "online" as const;
  const users = [
    {
      id: "a",
      username: "adam",
      display_role: { id: "b", name: "Before", position: 5 },
    },
    {
      id: "b",
      username: "bob",
      display_role: { id: "a", name: "Peers", position: 5 },
    },
  ] as User[];
  expect(memberGroups(users, status).map((g) => g.id)).toEqual([
    "role:a",
    "role:b",
  ]);
  users[0].display_role = { id: "b", name: "After", position: 10 };
  expect(memberGroups(users, status).map((g) => g.label)).toEqual([
    "After",
    "Peers",
  ]);
  delete users[0].display_role;
  expect(memberGroups(users, status).map((g) => g.id)).toEqual([
    "role:a",
    "online",
  ]);
});
