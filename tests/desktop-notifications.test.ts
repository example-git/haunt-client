import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
const { createNotificationService } = createRequire(import.meta.url)(
  "../apps/desktop/notifications.cjs",
);
afterEach(() => vi.useRealTimers());

function fixture() {
  const popups: Notification[] = [];
  class Notification extends EventEmitter {
    static isSupported = () => true;
    options: unknown;
    show = vi.fn(() => this.emit("show"));
    close = vi.fn(() => this.emit("close"));
    constructor(options: unknown) {
      super();
      this.options = options;
      popups.push(this);
    }
  }
  const window = {
    isDestroyed: () => false,
    isMinimized: () => true,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    webContents: { send: vi.fn() },
  };
  const onError = vi.fn();
  const service = createNotificationService({
    Notification,
    getWindow: () => window,
    onError,
    icon: "haunt.png",
  });
  return { Notification, popups, window, onError, service };
}
const message = {
  title: "Alice",
  body: "Message",
  instance: "server",
  conversation: "conversation",
};

it("delivers simultaneous conversations, replaces the same conversation, and retains notifications for the OS", async () => {
  vi.useFakeTimers();
  const f = fixture();
  await expect(f.service.show(message)).resolves.toBe("shown");
  await f.service.show({ ...message, conversation: "other" });
  expect(f.popups).toHaveLength(2);
  expect(f.popups[0].close).not.toHaveBeenCalled();
  await f.service.show({ ...message, body: "Latest reply" });
  expect(f.popups[0].close).toHaveBeenCalledOnce();
  expect(f.popups[1].close).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(f.popups[2].close).not.toHaveBeenCalled();
  f.popups[2].emit("click");
  expect(f.window.webContents.send).toHaveBeenCalledWith("notification:click", {
    instance: "server",
    conversation: "conversation",
  });
  expect(f.window.restore).toHaveBeenCalledOnce();
  f.service.dispose();
  expect(f.popups[1].close).toHaveBeenCalledOnce();
});

it("resolves the window at click time when the service precedes window creation", async () => {
  const f = fixture();
  let window: typeof f.window | undefined;
  const service = createNotificationService({
    Notification: f.Notification,
    getWindow: () => window,
    icon: "haunt.png",
  });
  await service.show(message);
  window = f.window;
  f.popups[0].emit("click");
  expect(window.show).toHaveBeenCalledOnce();
  expect(window.webContents.send).toHaveBeenCalledWith("notification:click", {
    instance: "server",
    conversation: "conversation",
  });
  service.dispose();
});

it("retains the live click handler through native replacement and replacement failure", async () => {
  const f = fixture();
  const replaceNotification = vi.fn().mockResolvedValue(undefined);
  const service = createNotificationService({
    Notification: f.Notification,
    getWindow: () => f.window,
    onError: f.onError,
    replaceNotification,
  });
  await service.show(message);
  const latest = { ...message, body: "Latest reply" };
  await expect(service.show(latest)).resolves.toBe("shown");
  expect(replaceNotification).toHaveBeenCalledWith(f.popups[0], latest);
  expect(f.popups).toHaveLength(1);
  expect(f.popups[0].close).not.toHaveBeenCalled();
  replaceNotification.mockRejectedValueOnce(Error("Native replacement failed"));
  await expect(service.show(message)).rejects.toThrow(
    "Native replacement failed",
  );
  expect(f.onError).toHaveBeenCalledWith("Native replacement failed");
  await expect(service.show(latest)).resolves.toBe("shown");
  expect(f.popups).toHaveLength(1);
  f.popups[0].emit("click");
  expect(f.window.webContents.send).toHaveBeenCalledOnce();
  expect(f.window.webContents.send).toHaveBeenCalledWith("notification:click", {
    instance: message.instance,
    conversation: message.conversation,
  });
  expect(f.popups[0].close).toHaveBeenCalledOnce();
  service.dispose();
});

it("surfaces native failure and distinguishes unacknowledged submission from display", async () => {
  vi.useFakeTimers();
  const f = fixture();
  vi.spyOn(f.Notification, "isSupported").mockReturnValue(false);
  await expect(f.service.show(message)).rejects.toThrow("unavailable");
  vi.spyOn(f.Notification, "isSupported").mockReturnValue(true);
  // Class fields are replaced before delivery through a constructor wrapper.
  const Native = class extends f.Notification {
    show = vi.fn();
  };
  const service = createNotificationService({
    Notification: Native,
    getWindow: () => f.window,
    onError: f.onError,
  });
  const failing = service.show(message);
  const rejected = expect(failing).rejects.toThrow("Permission denied");
  f.popups.at(-1)!.emit("failed", {}, "Permission denied");
  await rejected;
  expect(f.onError).toHaveBeenCalledWith("Permission denied");
  const pending = service.show(message);
  await vi.advanceTimersByTimeAsync(8000);
  await expect(pending).resolves.toBe("submitted");
  expect(f.popups.at(-1)!.close).not.toHaveBeenCalled();
  f.popups.at(-1)!.emit("click");
  expect(f.window.webContents.send).toHaveBeenCalledWith("notification:click", {
    instance: message.instance,
    conversation: message.conversation,
  });
  service.dispose();
});
