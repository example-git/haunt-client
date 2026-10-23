import { afterEach, expect, it, vi } from "vitest";
import type { InstanceClient } from "@haunt/core";
import { backupPreference } from "@haunt/core";

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});
it("keeps a device-local identity and self intent through relaunch and clears only matching calls", async () => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key),
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  const account = (instance: string, user: string) =>
    ({
      account: {
        instance: { instance_id: instance },
        login: { user: { id: user } },
      },
    }) as InstanceClient;
  const first = account("one", "alice"),
    other = account("two", "alice");
  let reconnect = await import("../packages/browser/src/media/reconnect");
  reconnect.rememberVoice(first, "room", { muted: false, deafened: true });
  expect(backupPreference("haunt-voice-reconnect-v1")).toBe(false);
  vi.resetModules();
  reconnect = await import("../packages/browser/src/media/reconnect");
  expect(reconnect.getVoiceReconnect()).toEqual({
    instance: "one",
    user: "alice",
    channel: "room",
    intent: { muted: false, deafened: true },
  });
  reconnect.clearVoiceReconnect(other, "room");
  reconnect.clearVoiceReconnect(first, "another");
  expect(reconnect.getVoiceReconnect()?.channel).toBe("room");
  reconnect.rememberVoice(other, "new", { muted: true, deafened: false });
  reconnect.clearVoiceReconnect(first);
  expect(reconnect.getVoiceReconnect()?.channel).toBe("new");
  reconnect.clearVoiceReconnect(other);
  expect(reconnect.getVoiceReconnect()).toBeUndefined();
  expect(storage.size).toBe(0);
});
it("rejects malformed saved reconnect records", async () => {
  vi.stubGlobal("localStorage", {
    getItem: () =>
      JSON.stringify({
        instance: "one",
        user: "alice",
        channel: "room",
        intent: { muted: "false", deafened: false },
      }),
  });
  const reconnect = await import("../packages/browser/src/media/reconnect");
  expect(reconnect.getVoiceReconnect()).toBeUndefined();
});
