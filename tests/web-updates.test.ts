import { expect, it, vi } from "vitest";
import { webUpdateChecker } from "../packages/browser/src/web-updates";
it("ignores failures/current builds and requires two matching new markers", async () => {
  const refresh = vi.fn(),
    read = vi.fn();
  const check = webUpdateChecker({
    current: "a",
    read,
    busy: () => false,
    attempted: () => false,
    refresh,
  });
  read.mockRejectedValueOnce(new Error("offline"));
  await check();
  read.mockResolvedValueOnce(undefined);
  await check();
  read.mockResolvedValueOnce("a");
  await check();
  read.mockResolvedValueOnce("b").mockResolvedValueOnce("c");
  await check();
  expect(refresh).not.toHaveBeenCalled();
  read.mockResolvedValue("b");
  await check();
  expect(refresh).toHaveBeenCalledExactlyOnceWith("b");
});
it("defers while busy, coalesces checks, and avoids reloading again for a stale HTML response", async () => {
  let busy = true,
    attempted = "";
  const refresh = vi.fn((id) => {
      attempted = id;
    }),
    read = vi.fn(async () => "b");
  const check = webUpdateChecker({
    current: "a",
    read,
    busy: () => busy,
    attempted: (id) => attempted === id,
    refresh,
  });
  await check();
  expect(refresh).not.toHaveBeenCalled();
  busy = false;
  await Promise.all([check(), check(), check()]);
  expect(refresh).toHaveBeenCalledTimes(1);
  await check();
  expect(refresh).toHaveBeenCalledTimes(1);
});
