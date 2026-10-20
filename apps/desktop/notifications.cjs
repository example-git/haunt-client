const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validateNotification(value) {
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.title !== "string" ||
    !value.title.length ||
    value.title.length > 240 ||
    typeof value.body !== "string" ||
    value.body.length > 400 ||
    typeof value.instance !== "string" ||
    !value.instance.length ||
    value.instance.length > 128 ||
    value.instance.trim() !== value.instance ||
    typeof value.conversation !== "string" ||
    !uuid.test(value.conversation)
  )
    throw Error("Invalid notification");
  return {
    title: value.title,
    body: value.body,
    instance: value.instance,
    conversation: value.conversation,
  };
}
function validateBadge(value) {
  if (
    !value ||
    !Number.isSafeInteger(value.count) ||
    value.count < 0 ||
    value.count > 999999 ||
    typeof value.unread !== "boolean" ||
    typeof value.icon !== "string" ||
    value.icon.length > 32768 ||
    !/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/=]+$/.test(value.icon)
  )
    throw Error("Invalid badge");
  if (
    typeof value.overlay !== "string" ||
    value.overlay.length > 32768 ||
    !/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/=]+$/.test(value.overlay)
  )
    throw Error("Invalid badge overlay");
  return {
    count: value.count,
    unread: value.unread,
    icon: value.icon,
    overlay: value.overlay,
  };
}
/** Native delivery is shared by real message events and the settings test. */
function createNotificationService({
  Notification,
  getWindow,
  icon,
  onError = () => {},
}) {
  const popups = new Map();
  const show = (value, test = false) => {
    if (!Notification.isSupported())
      return Promise.reject(
        Error("Desktop notifications are unavailable on this system."),
      );
    const key = test
      ? "test"
      : JSON.stringify([value.instance, value.conversation]);
    popups.get(key)?.close();
    const popup = new Notification({
      title: value.title,
      body: value.body,
      silent: true,
      icon,
    });
    popups.set(key, popup);
    while (popups.size > 50) {
      const [oldKey, oldest] = popups.entries().next().value;
      popups.delete(oldKey);
      oldest.close();
    }
    const remove = () => {
      if (popups.get(key) === popup) popups.delete(key);
    };
    popup.on("click", () => {
      const window = getWindow();
      if (!window || window.isDestroyed()) return;
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
      if (!test)
        window.webContents.send("notification:click", {
          instance: value.instance,
          conversation: value.conversation,
        });
      popup.close();
      remove();
    });
    popup.on("close", remove);
    return new Promise((resolve, reject) => {
      // Some Linux daemons do not acknowledge display. Report submission honestly
      // without dismissing the notification or blocking the message pipeline.
      const timeout = setTimeout(() => resolve("submitted"), 8000);
      timeout.unref?.();
      popup.once("show", () => {
        clearTimeout(timeout);
        resolve("shown");
      });
      popup.once("failed", (_event, error) => {
        clearTimeout(timeout);
        remove();
        const message = String(
          error || "The system declined this notification.",
        ).slice(0, 240);
        onError(message);
        reject(Error(message));
      });
      try {
        popup.show();
      } catch (error) {
        clearTimeout(timeout);
        remove();
        onError(error.message);
        reject(error);
      }
    });
  };
  return {
    show,
    test: () =>
      show(
        {
          title: "Haunt notification test",
          body: "Notifications can appear here while Haunt is in the background.",
        },
        true,
      ),
    dispose: () => {
      for (const popup of popups.values()) popup.close();
      popups.clear();
    },
  };
}
module.exports = {
  validateNotification,
  validateBadge,
  createNotificationService,
};
