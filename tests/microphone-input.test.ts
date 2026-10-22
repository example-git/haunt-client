import { afterEach, describe, expect, it, vi } from "vitest";
import { openMicrophone } from "../packages/browser/src/media/microphone-input";

afterEach(() => vi.unstubAllGlobals());

function capture(deviceId: string | undefined = "selected") {
  const track = { getSettings: () => ({ deviceId }), stop: vi.fn() };
  const stream = {
    getAudioTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream;
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  return { track, stream, getUserMedia };
}

describe("microphone selection", () => {
  it("requires the selected input even when another device better matches the preferred format", async () => {
    const { stream, track, getUserMedia } = capture();
    getUserMedia.mockImplementation(async ({ audio }) => {
      // Model selection among a 44.1 kHz stereo input and a default 48 kHz
      // mono input. An advisory device preference may lose to format ideals.
      track.getSettings = () => ({
        deviceId: audio.deviceId?.exact === "selected" ? "selected" : "default",
      });
      return stream;
    });
    expect(await openMicrophone("selected", true)).toBe(stream);
    expect(track.getSettings().deviceId).toBe("selected");
    expect(track.stop).not.toHaveBeenCalled();
  });

  it("allows the system default only when no specific input is selected", async () => {
    const { stream, getUserMedia } = capture("default");
    expect(await openMicrophone("", false)).toBe(stream);
    expect(getUserMedia.mock.calls[0][0].audio.deviceId).toBeUndefined();
  });

  it.each(["NotFoundError", "OverconstrainedError"])(
    "reports an unavailable selection on %s without retrying the default",
    async (name) => {
      const { getUserMedia } = capture();
      getUserMedia.mockRejectedValue(new DOMException("Missing input", name));
      await expect(openMicrophone("missing", true)).rejects.toThrow(
        "The selected microphone is unavailable",
      );
      expect(getUserMedia).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["default", "other", ""])(
    "stops capture before processing or publication if the device reports %j instead of the selection",
    async (actual) => {
      const { track } = capture(actual);
      await expect(openMicrophone("selected", true)).rejects.toThrow(
        "Could not capture the selected microphone",
      );
      expect(track.stop).toHaveBeenCalledOnce();
    },
  );

  it("preserves permission errors without opening a different input", async () => {
    const { getUserMedia } = capture();
    const error = new DOMException(
      "Microphone access denied",
      "NotAllowedError",
    );
    getUserMedia.mockRejectedValue(error);
    await expect(openMicrophone("selected", true)).rejects.toBe(error);
    expect(getUserMedia).toHaveBeenCalledOnce();
  });
});
