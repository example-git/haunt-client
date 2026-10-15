import { afterEach, describe, expect, it, vi } from "vitest";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
async function load(raw: Record<string, unknown> = {}) {
  const storage = new Map<string, string>([
    ["chatxo-client-preferences-v1", JSON.stringify(raw)],
  ]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  const prefs = await import("../packages/browser/src/preferences");
  return { prefs, storage };
}
describe("microphone preferences", () => {
  it("defaults to noise suppression and automatic gain, and saves manual gain independently", async () => {
    const { prefs, storage } = await load();
    expect(prefs.getPreferences()).toMatchObject({
      noiseSuppression: true,
      automaticGainControl: true,
      microphoneGain: 100,
    });
    prefs.setPreferences({ automaticGainControl: false, microphoneGain: 137 });
    prefs.setPreferences({ automaticGainControl: true });
    expect(
      JSON.parse(storage.get("chatxo-client-preferences-v1")!),
    ).toMatchObject({ automaticGainControl: true, microphoneGain: 137 });
  });
  it("restores explicit opt-outs and bounds invalid saved gain", async () => {
    const { prefs } = await load({
      noiseSuppression: false,
      automaticGainControl: false,
      microphoneGain: 900,
    });
    expect(prefs.getPreferences()).toMatchObject({
      noiseSuppression: false,
      automaticGainControl: false,
      microphoneGain: 200,
    });
    prefs.setPreferences({ microphoneGain: NaN });
    expect(prefs.getPreferences().microphoneGain).toBe(100);
    prefs.setPreferences({ microphoneGain: -1 });
    expect(prefs.getPreferences().microphoneGain).toBe(0);
  });
});

it("keeps plugin choices and values independently for each server across reloads", async () => {
  const { prefs, storage } = await load();
  prefs.setPreferences({
    audioPlugins: {
      server_a: {
        selected: "test-audio",
        plugins: {
          "test-audio": {
            id: "test-audio",
            variant: "default",
            values: { level: 37 },
          },
        },
      },
    },
  });
  expect(
    prefs.getPreferences().audioPlugins["server_a"].plugins["test-audio"].values
      .level,
  ).toBe(37);
  const saved = JSON.parse(storage.get("chatxo-client-preferences-v1")!);
  expect(
    saved.audioPlugins["server_a"].plugins["test-audio"].values.level,
  ).toBe(37);
  vi.resetModules();
  const reloaded = await import("../packages/browser/src/preferences");
  expect(
    reloaded.getPreferences().audioPlugins["server_a"].plugins["test-audio"]
      .values.level,
  ).toBe(37);
});
it("defaults member lists open and persists explicit collapse choices per server", async () => {
  const { prefs, storage } = await load({
    memberListsCollapsed: { a: true, b: false, c: "true" },
  });
  expect(prefs.getPreferences().memberListsCollapsed).toEqual({
    a: true,
    b: false,
  });
  expect(prefs.getPreferences().memberListsCollapsed.newServer).toBeUndefined();
  prefs.setPreferences({
    memberListsCollapsed: {
      ...prefs.getPreferences().memberListsCollapsed,
      a: false,
    },
  });
  expect(
    JSON.parse(storage.get("chatxo-client-preferences-v1")!)
      .memberListsCollapsed,
  ).toEqual({ a: false, b: false });
});
