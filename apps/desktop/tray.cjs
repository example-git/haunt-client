/** Keep native app badging independent of tray availability. */
function updateAppBadge({ app, window, platform = process.platform }, value) {
  const { count, unread, overlay } = value;
  const active = count > 0 || unread;
  if (platform === "darwin") {
    if (!app.dock) throw Error("The macOS Dock badge API is unavailable.");
    const expected = count
      ? count > 99
        ? "99+"
        : String(count)
      : unread
        ? "•"
        : "";
    app.dock.setBadge(expected);
    const actual = app.dock.getBadge();
    if (actual !== expected)
      throw Error(
        `macOS did not retain the Dock badge (expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}).`,
      );
    return {
      status: "accepted",
      message: `macOS returned the requested Dock badge ${JSON.stringify(actual)}. On-screen visibility is not confirmed by this API.`,
    };
  } else if (platform === "win32") {
    if (active && !overlay)
      throw Error("The Windows taskbar badge image could not be loaded.");
    window.setOverlayIcon(
      active && overlay ? overlay : null,
      active ? "Unread notifications" : "No unread messages",
    );
    return {
      status: "unconfirmed",
      message:
        "Windows received the taskbar badge request; its API does not confirm whether the badge is visible.",
    };
  } else {
    const accepted = app.setBadgeCount(count);
    if (!accepted && active)
      throw Error(
        "The Linux desktop did not accept the launcher badge. Check desktop badge support and Haunt's launcher entry.",
      );
    // Keep the window icon stable: docks can cache it after the native count clears.
    return {
      status: "unconfirmed",
      message:
        "Linux received the launcher badge request; dock visibility still depends on the desktop's badge settings.",
    };
  }
}

/** Native status surfaces share the renderer's aggregated unread state. */
function installTray({
  app,
  Tray,
  Menu,
  nativeImage,
  window,
  iconPath,
  templatePath,
  platform = process.platform,
}) {
  const base = nativeImage.createFromPath(iconPath);
  const template = nativeImage.createFromPath(templatePath);
  template.setTemplateImage(true);
  const tray =
    platform === "darwin"
      ? new Tray(template, "b7219f9e-ff6e-4e47-bac7-23a1541b597d")
      : new Tray(base.resize({ width: 24, height: 24 }));
  let quitting = false,
    disposed = false;
  const show = () => {
    if (window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  };
  const menu = (status) =>
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: status, enabled: false },
        { type: "separator" },
        { label: "Show Haunt", click: show },
        { label: "Hide Haunt", click: () => window.hide() },
        { type: "separator" },
        { label: "Quit Haunt", click: () => app.quit() },
      ]),
    );
  if (platform !== "darwin") tray.on("click", show);
  tray.on("double-click", show);
  const close = (event) => {
    if (!quitting && !disposed) {
      event.preventDefault();
      window.hide();
    }
  };
  const beforeQuit = () => {
    quitting = true;
  };
  window.on("close", close);
  app.on("before-quit", beforeQuit);
  app.on("activate", show);
  const update = ({ count, unread, icon, overlay }) => {
    if (disposed) return;
    const label = count > 99 ? "99+" : String(count);
    const status = count
      ? `${count} unread notification${count === 1 ? "" : "s"}`
      : unread
        ? "Unread messages"
        : "No unread messages";
    tray.setToolTip(`Haunt — ${status}`);
    menu(status);
    if (platform === "darwin") {
      tray.setTitle(count ? label : unread ? "•" : "", {
        fontType: "monospacedDigit",
      });
    } else {
      tray.setImage(
        (count || unread ? icon : base).resize({ width: 24, height: 24 }),
      );
    }
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    tray.destroy();
    window.removeListener("close", close);
    app.removeListener("before-quit", beforeQuit);
    app.removeListener("activate", show);
  };
  app.once("will-quit", dispose);
  try {
    update({ count: 0, unread: false, icon: base });
  } catch (error) {
    dispose();
    throw error;
  }
  return { update, show, dispose };
}
module.exports = { installTray, updateAppBadge };
