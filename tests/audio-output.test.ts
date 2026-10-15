import { afterEach, expect, it, vi } from "vitest";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
async function setup() {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
  });
  const devices = new EventTarget();
  vi.stubGlobal("navigator", { mediaDevices: devices });
  const prefs = await import("../packages/browser/src/preferences");
  const { followAudioOutput } =
    await import("../packages/browser/src/audio-output");
  return { prefs, followAudioOutput, devices, storage };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
it("restores output preferences, falls back on unplug, and restores on device change", async () => {
  const { prefs, followAudioOutput, devices, storage } = await setup();
  prefs.setPreferences({ audioOutput: "headphones" });
  let plugged = false;
  const sink = {
    setSinkId: vi.fn(async (id: string) => {
      if (id && !plugged) throw Error("unplugged");
    }),
  };
  const off = followAudioOutput(sink);
  await flush();
  expect(sink.setSinkId.mock.calls).toEqual([["headphones"], [""]]);
  expect(prefs.getPreferences().audioOutput).toBe("headphones");
  plugged = true;
  devices.dispatchEvent(new Event("devicechange"));
  await flush();
  expect(sink.setSinkId).toHaveBeenLastCalledWith("headphones");
  off();
  const count = sink.setSinkId.mock.calls.length;
  prefs.setPreferences({ audioOutput: "other" });
  devices.dispatchEvent(new Event("devicechange"));
  await flush();
  expect(sink.setSinkId).toHaveBeenCalledTimes(count);
  vi.resetModules();
  expect(
    (await import("../packages/browser/src/preferences")).getPreferences()
      .audioOutput,
  ).toBe("other");
  expect(
    JSON.parse(storage.get("chatxo-client-preferences-v1")!).audioOutput,
  ).toBe("other");
});
it("serializes overlapping output switches and ignores stale failures", async () => {
  const { prefs, followAudioOutput } = await setup();
  let reject!: (error: Error) => void;
  const first = new Promise<void>((_, fail) => {
    reject = fail;
  });
  const sink = {
    setSinkId: vi.fn((id: string) =>
      id === "slow" ? first : Promise.resolve(),
    ),
  };
  prefs.setPreferences({ audioOutput: "slow" });
  const off = followAudioOutput(sink);
  await flush();
  prefs.setPreferences({ audioOutput: "new" });
  reject(Error("old device removed"));
  await flush();
  expect(sink.setSinkId.mock.calls).toEqual([["slow"], ["new"]]);
  off();
});
