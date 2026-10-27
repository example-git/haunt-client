export interface DesktopLink {
  server: string;
  channel?: string;
  message?: string;
  error?: string;
}
export function hauntLink(raw: string) {
  if (raw.length > 4096 || /[\\\u0000-\u0020\u007f]/.test(raw)) return;
  try {
    const url = new URL(raw);
    if (
      url.protocol === "haunt:" &&
      url.hostname === "open" &&
      ["", "/"].includes(url.pathname) &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.hash &&
      url.searchParams.has("server")
    )
      return url.href;
  } catch {
    return;
  }
}
let messageTarget: DesktopLink | undefined;
export function messageLink(
  server: string,
  channel?: string,
  message?: string,
) {
  const url = new URL("haunt://open");
  url.searchParams.set("server", server);
  if (channel) url.searchParams.set("channel", channel);
  if (message) url.searchParams.set("message", message);
  return url.href;
}
export function targetMessage(value: DesktopLink) {
  messageTarget = value;
  window.dispatchEvent(new Event("haunt:message-link"));
}
export function takeMessageTarget(server: string, channel: string) {
  if (messageTarget?.server !== server || messageTarget.channel !== channel)
    return;
  const id = messageTarget.message;
  messageTarget = undefined;
  return id;
}
