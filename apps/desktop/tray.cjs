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
      app.dock?.setBadge(count ? label : unread ? "•" : "");
    } else {
      tray.setImage(
        (count || unread ? icon : base).resize({ width: 24, height: 24 }),
      );
      if (platform === "win32")
        window.setOverlayIcon(count || unread ? overlay : null, status);
      else {
        app.setBadgeCount(count);
        window.setIcon(count || unread ? icon : base);
      }
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
module.exports = { installTray };
