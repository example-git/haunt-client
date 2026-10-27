import { expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
const { installTray, updateAppBadge } = createRequire(import.meta.url)(
  "../apps/desktop/tray.cjs",
);
for (const platform of ["darwin", "win32", "linux"]) {
  it(`routes ${platform} unread and cleared badges; hides on close and quits explicitly`, () => {
    const image = {
      resize: vi.fn().mockReturnThis(),
      setTemplateImage: vi.fn(),
    };
    class Tray extends EventEmitter {
      static current: Tray;
      setContextMenu = vi.fn();
      setTitle = vi.fn();
      setToolTip = vi.fn();
      setImage = vi.fn();
      destroy = vi.fn();
      constructor(..._args: unknown[]) {
        super();
        Tray.current = this;
      }
    }
    const window = Object.assign(new EventEmitter(), {
      isDestroyed: () => false,
      isMinimized: () => true,
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      hide: vi.fn(),
      setOverlayIcon: vi.fn(),
      setIcon: vi.fn(),
    });
    const app = Object.assign(new EventEmitter(), {
      dock: {
        setBadge: vi.fn(),
        getBadge: vi.fn(() => app.dock.setBadge.mock.lastCall?.[0] ?? ""),
      },
      setBadgeCount: vi.fn(() => true),
      quit: vi.fn(),
    });
    const control = installTray({
      app,
      window,
      Tray,
      platform,
      Menu: { buildFromTemplate: (v: unknown) => v },
      nativeImage: { createFromPath: () => image },
      iconPath: "logo",
      templatePath: "template",
    });
    const overlay = {};
    const update = (count: number, unread: boolean) => {
      const value = { count, unread, icon: image, overlay };
      updateAppBadge({ app, window, base: image, platform }, value);
      control.update(value);
    };
    update(12, true);
    expect(Tray.current.setToolTip).toHaveBeenLastCalledWith(
      "Haunt — 12 unread notifications",
    );
    if (platform === "darwin") {
      expect(image.setTemplateImage).toHaveBeenCalledWith(true);
      expect(app.dock.setBadge).toHaveBeenLastCalledWith("12");
      expect(Tray.current.setTitle).toHaveBeenLastCalledWith("12", {
        fontType: "monospacedDigit",
      });
    } else if (platform === "win32")
      expect(window.setOverlayIcon).toHaveBeenLastCalledWith(
        overlay,
        "Unread notifications",
      );
    else expect(app.setBadgeCount).toHaveBeenLastCalledWith(12);
    update(0, true);
    if (platform === "darwin")
      expect(app.dock.setBadge).toHaveBeenLastCalledWith("•");
    else if (platform === "linux")
      expect(app.setBadgeCount).toHaveBeenLastCalledWith(0);
    update(0, false);
    if (platform === "darwin")
      expect(app.dock.setBadge).toHaveBeenLastCalledWith("");
    else if (platform === "win32")
      expect(window.setOverlayIcon).toHaveBeenLastCalledWith(
        null,
        "No unread messages",
      );
    else expect(app.setBadgeCount).toHaveBeenLastCalledWith(0);
    if (platform === "linux") expect(window.setIcon).not.toHaveBeenCalled();
    const callAction = vi.fn();
    control.setCall(
      { active: true, muted: true, deafened: false, sharing: true },
      callAction,
    );
    const callMenu = Tray.current.setContextMenu.mock.lastCall![0];
    callMenu
      .find((item: { label: string }) => item.label === "Unmute microphone")
      .click();
    callMenu
      .find((item: { label: string }) => item.label === "Stop sharing screen")
      .click();
    expect(callAction.mock.calls).toEqual([["mute"], ["stop-screen"]]);
    expect(Tray.current.setToolTip.mock.lastCall?.[0]).toContain(
      "Screen sharing",
    );
    control.setCall(undefined, callAction);
    expect(
      Tray.current.setContextMenu.mock.lastCall![0].some(
        (item: { label: string }) => item.label === "Leave call",
      ),
    ).toBe(false);
    const event = { preventDefault: vi.fn() };
    window.emit("close", event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(window.hide).toHaveBeenCalledOnce();
    const menu = Tray.current.setContextMenu.mock.lastCall![0];
    menu.find((item: { label: string }) => item.label === "Show Haunt").click();
    expect(window.restore).toHaveBeenCalledOnce();
    expect(window.show).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
    menu.find((item: { label: string }) => item.label === "Quit Haunt").click();
    expect(app.quit).toHaveBeenCalledOnce();
    app.emit("before-quit");
    event.preventDefault.mockClear();
    window.emit("close", event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    app.emit("will-quit");
    expect(Tray.current.destroy).toHaveBeenCalledOnce();
    expect(window.listenerCount("close")).toBe(0);
  });
}
