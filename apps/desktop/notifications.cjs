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
module.exports = { validateNotification, validateBadge };
