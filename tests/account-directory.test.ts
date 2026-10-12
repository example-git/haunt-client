import { expect, it, vi } from "vitest";
import {
  serverAddress,
  userAddress,
  type InstanceClient,
  type Snapshot,
} from "@haunt/core";
import {
  AccountDirectory,
  findAccounts,
} from "../packages/browser/src/account-directory";

function account(host: string) {
  const listeners = new Set<() => void>();
  const instance = {
    scope: JSON.stringify([host, "me"]),
    origin: `https://alias.${host}`,
    account: {
      instance: { name: host, public_url: `https://${host}` },
      login: { user: { id: "me" } },
    },
    snapshot: {
      status: "online",
      users: [
        { id: "me", username: "owner" },
        { id: "peer", username: "alice", display_name: "Alice Example" },
      ],
    },
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  } as unknown as InstanceClient;
  return {
    instance,
    change(patch: Partial<Snapshot>) {
      instance.snapshot = { ...instance.snapshot, ...patch };
      listeners.forEach((fn) => fn());
    },
  };
}

it("uses the canonical server address, preserves ports, and falls back for older saved accounts", () => {
  const { instance } = account("haunt.xo.vg:8443");
  expect(userAddress(instance, { username: "alice" })).toBe(
    "alice@haunt.xo.vg:8443",
  );
  instance.account.instance.public_url = "";
  expect(serverAddress(instance)).toBe("alias.haunt.xo.vg:8443");
  instance.account.instance.public_url = "javascript:example";
  expect(serverAddress(instance)).toBe("alias.haunt.xo.vg:8443");
});

it("keeps matching usernames scoped, searches local rosters, and ignores unrelated gateway activity", () => {
  const a = account("one.test"),
    b = account("two.test");
  const directory = new AccountDirectory();
  const stop = directory.start([a.instance, b.instance]);
  const changed = vi.fn();
  directory.subscribe(changed);
  const initial = directory.getSnapshot();
  expect(initial.map((e) => e.address)).toEqual([
    "alice@one.test",
    "alice@two.test",
  ]);
  expect(new Set(initial.map((e) => e.key)).size).toBe(2);
  expect(
    findAccounts(initial, "ALICE two.test").map((e) => e.instance),
  ).toEqual([b.instance]);
  expect(findAccounts(initial, "Example")).toHaveLength(2);
  expect(findAccounts(initial, "owner")).toHaveLength(0);
  a.change({ revision: 52, voiceRooms: {} });
  expect(directory.getSnapshot()).toBe(initial);
  expect(changed).not.toHaveBeenCalled();
  a.change({ status: "offline" });
  expect(directory.getSnapshot()[0].online).toBe(false);
  a.instance.account.instance.public_url = "https://renamed.test";
  a.change({ status: "online" });
  expect(directory.getSnapshot()[0].address).toBe("alice@renamed.test");
  expect(directory.getSnapshot()[0].key).toBe(initial[0].key);
  b.change({ users: [] });
  expect(directory.getSnapshot()).toHaveLength(1);
  a.change({ status: "signed-out" });
  expect(directory.getSnapshot()).toEqual([]);
  stop();
  changed.mockClear();
  a.change({ status: "online" });
  expect(changed).not.toHaveBeenCalled();
});
