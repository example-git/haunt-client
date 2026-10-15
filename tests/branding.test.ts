import { afterEach, expect, it, vi } from "vitest";
import type { InstanceClient } from "@haunt/core";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
function setup() {
  let ready!: () => void;
  const decoding = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const drawImage = vi.fn(),
    fillText = vi.fn(),
    setBadge = vi.fn(async () => {});
  const icon = { href: "/brand/favicon-32.png", sizes: { value: "32x32" } };
  const document = {
    title: "Haunt",
    querySelector: () => icon,
    createElement: () => ({
      getContext: () => ({
        drawImage,
        fillText,
        beginPath() {},
        arc() {},
        fill() {},
      }),
      toDataURL: () => "data:image/png;base64,owl",
    }),
  };
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", {
    hauntDesktop: { setBadge },
    addEventListener() {},
  });
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      decode() {
        return decoding;
      }
    },
  );
  let update = () => {};
  const off = vi.fn();
  const client = {
    snapshot: {
      status: "connected",
      readStates: {} as Record<string, unknown>,
    },
    subscribe(fn: () => void) {
      update = fn;
      return off;
    },
  };
  return {
    ready,
    icon,
    document,
    drawImage,
    fillText,
    setBadge,
    off,
    client,
    update: () => update(),
  };
}
it("keeps the owl through pending decode, unread, count, 99+, clear and logout; coalesces totals", async () => {
  const f = setup();
  const { installBadges } = await import("../packages/browser/src/badges");
  const stop = installBadges([f.client as unknown as InstanceClient]);
  const state = { kind: "text", unread_count: 1, mention_count: 0 };
  f.client.snapshot.readStates.channel = state;
  f.update();
  expect(f.document.title).toBe("• Haunt");
  expect(f.icon.href).toBe("/brand/favicon-32.png");
  expect(f.drawImage).not.toHaveBeenCalled();
  f.ready();
  await vi.waitFor(() =>
    expect(f.setBadge).toHaveBeenCalledWith(
      expect.objectContaining({ count: 0, unread: true }),
    ),
  );
  expect(f.drawImage.mock.calls.at(-1)?.slice(1)).toEqual([0, 8, 56, 56]);
  state.mention_count = 3;
  f.update();
  expect(f.document.title).toBe("(3) Haunt");
  expect(f.fillText).toHaveBeenCalledWith("3", 50, 12);
  expect(f.fillText).toHaveBeenLastCalledWith("3", 32, 32);
  state.mention_count = 100;
  f.update();
  expect(f.fillText).toHaveBeenCalledWith("99+", 50, 12);
  expect(f.fillText).toHaveBeenLastCalledWith("99+", 32, 32);
  const calls = f.drawImage.mock.calls.length;
  f.update();
  expect(f.drawImage).toHaveBeenCalledTimes(calls);
  state.unread_count = state.mention_count = 0;
  f.update();
  expect(f.icon.href).toBe("/brand/favicon-32.png");
  expect(f.drawImage.mock.calls.at(-1)?.slice(1)).toEqual([0, 0, 64, 64]);
  state.unread_count = state.mention_count = 1;
  f.update();
  f.client.snapshot.status = "signed-out";
  f.update();
  expect(f.document.title).toBe("Haunt");
  expect(f.setBadge).toHaveBeenLastCalledWith({
    count: 0,
    unread: false,
    icon: "data:image/png;base64,owl",
    overlay: "data:image/png;base64,owl",
  });
  expect(f.fillText.mock.calls.every(([text]) => text !== "xo")).toBe(true);
  stop();
  expect(f.off).toHaveBeenCalledOnce();
});
it("a disposed subscription cannot redraw after its pending image finishes", async () => {
  const f = setup();
  const { installBadges } = await import("../packages/browser/src/badges");
  const stop = installBadges([f.client as unknown as InstanceClient]);
  stop();
  f.document.title = "new subscription";
  f.ready();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(f.document.title).toBe("new subscription");
  expect(f.setBadge).not.toHaveBeenCalled();
});
