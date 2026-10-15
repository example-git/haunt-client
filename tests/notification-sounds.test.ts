import { it, expect } from "vitest";
import "fake-indexeddb/auto";
import {
  resolveNotificationSound,
  soundOverrides,
  soundLibrary,
} from "../packages/browser/src/notification-sound-options";
import {
  encryptBackup,
  decryptBackup,
  validateBackup,
  base64,
} from "@haunt/core";
it("resolves conversation > server > client without confusing servers or silent overrides", () => {
  const prefs = {
    sound: "ping" as const,
    serverSounds: { a: "chime" as const },
    conversationSounds: { '["a","room"]': "none" as const },
  };
  expect(resolveNotificationSound(prefs, "a", "room")).toBe("none");
  expect(resolveNotificationSound(prefs, "a", "dm")).toBe("chime");
  expect(resolveNotificationSound(prefs, "b", "room")).toBe("ping");
  expect(resolveNotificationSound(prefs, "a")).toBe("chime");
});
it("bounds saved preferences and rejects executable URLs or invalid clip identifiers", () => {
  const clip = `clip:${"a".repeat(64)}`;
  expect(
    soundOverrides({
      a: "none",
      b: clip,
      c: "inherit",
      d: "https://bad",
      e: "javascript:alert(1)",
    }),
  ).toEqual({ a: "none", b: clip });
  expect(soundLibrary({ [clip]: "my sound.wav", "clip:bad": "bad" })).toEqual({
    [clip]: "my sound.wav",
  });
  expect(
    Object.keys(
      soundLibrary(
        Object.fromEntries(
          Array.from({ length: 20 }, (_, i) => [
            `clip:${String(i).padStart(64, "0")}`,
            "x",
          ]),
        ),
      ),
    ).length,
  ).toBe(16);
});
it("encrypted backups include scoped sounds and reject oversized or unsafe clips", async () => {
  const clip = `clip:${"a".repeat(64)}`;
  const value = {
    version: 1 as const,
    createdAt: new Date().toISOString(),
    accounts: [],
    servers: [],
    preferences: {
      "chatxo-client-preferences-v1": JSON.stringify({
        serverSounds: { test: clip },
      }),
    },
    notificationSounds: {
      [clip]: { type: "audio/wav", data: base64(new Uint8Array([1, 2, 3])) },
    },
  };
  expect(
    await decryptBackup(
      await encryptBackup(value, "test passphrase"),
      "test passphrase",
    ),
  ).toEqual(value);
  expect(() =>
    validateBackup({
      ...value,
      notificationSounds: { [clip]: { type: "text/html", data: "AAAA" } },
    }),
  ).toThrow();
  expect(() =>
    validateBackup({
      ...value,
      notificationSounds: {
        [clip]: {
          type: "audio/wav",
          data: base64(new Uint8Array(2 * 1024 * 1024 + 1)),
        },
      },
    }),
  ).toThrow();
});
it("restores clip bytes atomically while preserving the separate default custom sound", async () => {
  const { customSound, saveCustomSound, restoreNotificationSounds } =
    await import("../packages/browser/src/preferences");
  const oldID = `clip:${"b".repeat(64)}`,
    nextID = `clip:${"c".repeat(64)}`;
  await saveCustomSound(new Blob(["default"]));
  await saveCustomSound(new Blob(["old"]), oldID);
  await expect(
    restoreNotificationSounds({ invalid: new Blob(["bad"]) }),
  ).rejects.toThrow();
  expect(await (await customSound(oldID))?.text()).toBe("old");
  await restoreNotificationSounds({ [nextID]: new Blob(["new"]) });
  expect(await customSound(oldID)).toBeUndefined();
  expect(await (await customSound(nextID))?.text()).toBe("new");
  expect(await (await customSound())?.text()).toBe("default");
});
