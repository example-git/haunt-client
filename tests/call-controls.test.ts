import { fitCallWindow } from "../apps/web/src/FloatingCall";
import { describe, expect, it, vi } from "vitest";
import { pack, unpack } from "../packages/browser/src/media/framing";
import { elapsedCallTime } from "../apps/web/src/CallTimer";
import {
  setUserVolume,
  userVolumes,
  playbackVolume,
} from "../packages/browser/src/volumes";
describe("call timers and playback preferences", () => {
  it("calculates UTC elapsed time across timezone offsets, long calls and clock skew", () => {
    const joined = "2026-10-10T01:00:00Z";
    expect(
      elapsedCallTime(joined, Date.parse("2026-10-09T21:01:01-04:00")),
    ).toBe("01:01");
    expect(
      elapsedCallTime(joined, Date.parse(joined) + 127 * 3600000 + 69000),
    ).toBe("127:01:09");
    expect(elapsedCallTime(joined, 0)).toBe("00:00");
    expect(elapsedCallTime("bad", Date.now())).toBe("");
  });
  it("persists source volumes independently and scopes them to listener/server/user", async () => {
    const saved = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => saved.get(k),
      setItem: (k: string, v: string) => saved.set(k, v),
    });
    try {
      setUserVolume("server:listener", "alice", "audio", 0);
      setUserVolume("server:listener", "alice", "camera_audio", 37);
      setUserVolume("server:listener", "alice", "screen_audio", 68);
      expect(userVolumes("server:listener", "alice")).toEqual({
        audio: 0,
        camera_audio: 37,
        screen_audio: 68,
      });
      expect(playbackVolume("server:listener", "alice", "camera_audio")).toBe(
        0.37,
      );
      expect(userVolumes("other:listener", "alice").audio).toBe(100);
      expect(userVolumes("server:other", "alice").audio).toBe(100);
      expect(userVolumes("server:listener", "bob").audio).toBe(100);
      vi.resetModules();
      const restored = await import("../packages/browser/src/volumes");
      expect(restored.userVolumes("server:listener", "alice")).toEqual({
        audio: 0,
        camera_audio: 37,
        screen_audio: 68,
      });
      restored.setUserVolume("server:listener", "alice", "audio", NaN);
      expect(restored.userVolumes("server:listener", "alice").audio).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("frames camera/screen audio as distinct audio streams with bounded payloads", () => {
    for (const purpose of ["audio", "camera_audio", "screen_audio"] as const) {
      const packet = {
        purpose,
        timestamp: 1234,
        duration: 20000,
        revision: 1,
        sequence: 0,
        key: false,
        data: new Uint8Array([1, 2, 3]),
      };
      const frame = pack(packet),
        received = new Uint8Array(16 + frame.length);
      received.set(frame, 16);
      expect(unpack(received.buffer)).toMatchObject(packet);
      expect(() =>
        pack({ ...packet, data: new Uint8Array(64 << 10) }),
      ).toThrow();
    }
  });
});

it("keeps saved floating calls reachable after viewport changes and extreme dragging", () => {
  expect(
    fitCallWindow({ left: 4000, top: -300, width: 720, height: 600 }, 390, 844),
  ).toEqual({ left: 8, top: 8, width: 374, height: 600 });
  expect(
    fitCallWindow({ left: -30, top: 1000, width: 20, height: 20 }, 1280, 800),
  ).toEqual({ left: 8, top: 592, width: 260, height: 200 });
  const tiny = fitCallWindow(
    { left: 100, top: 100, width: 400, height: 600 },
    250,
    180,
  );
  expect(tiny.left + tiny.width).toBeLessThanOrEqual(242);
  expect(tiny.top + tiny.height).toBeLessThanOrEqual(172);
});

it("keeps PiP dragging and resizing below the app header", () => {
  const box = fitCallWindow(
    { left: -100, top: -100, width: 900, height: 900 },
    390,
    380,
    44,
  );
  expect(box.top).toBe(52);
  expect(box.top + box.height).toBeLessThanOrEqual(372);
  expect(box.left + box.width).toBeLessThanOrEqual(382);
});
