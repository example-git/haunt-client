import { afterEach, expect, it, vi } from "vitest";
import { saveMedia } from "../packages/browser/src/downloads";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it("saves a complete ranged browser download instead of only its first playable chunk", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("window", {});
  const click = vi.fn();
  vi.stubGlobal("document", { createElement: () => ({ click }) });
  const blobs: Blob[] = [];
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    blobs.push(blob as Blob);
    return "blob:fixture";
  });
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response("abcd", {
        status: 206,
        headers: {
          "Content-Type": "video/mp4",
          "Content-Range": "bytes 0-3/8",
        },
      }),
    )
    .mockResolvedValueOnce(
      new Response("efgh", {
        status: 206,
        headers: {
          "Content-Type": "video/mp4",
          "Content-Range": "bytes 4-7/8",
        },
      }),
    );
  vi.stubGlobal("fetch", fetch);
  await saveMedia("https://server.example/video", "video.mp4");
  expect(await blobs[0].text()).toBe("abcdefgh");
  expect(fetch.mock.calls[1][1].headers.Range).toBe("bytes=4-7");
  expect(click).toHaveBeenCalledOnce();
});
it("does not create a download for an incomplete byte range", async () => {
  vi.stubGlobal("window", {});
  const create = vi.spyOn(URL, "createObjectURL");
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response("short", {
        status: 206,
        headers: {
          "Content-Type": "video/mp4",
          "Content-Range": "bytes 0-99/100",
        },
      }),
  );
  await expect(
    saveMedia("https://server.example/video", "video.mp4"),
  ).rejects.toThrow("before all bytes");
  expect(create).not.toHaveBeenCalled();
});
