export type NotificationSound =
  "ping" | "chime" | "soft" | "custom" | "none" | `clip:${string}`;
export const isClipSound = (value: unknown): value is `clip:${string}` =>
  typeof value === "string" && /^clip:[a-f0-9]{64}$/.test(value);
export const isNotificationSound = (
  value: unknown,
): value is NotificationSound =>
  ["ping", "chime", "soft", "custom", "none"].includes(String(value)) ||
  isClipSound(value);
export function soundOverrides(
  raw: unknown,
): Record<string, NotificationSound> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw)
      .slice(0, 2048)
      .filter(
        ([key, value]) => key.length <= 300 && isNotificationSound(value),
      ),
  ) as Record<string, NotificationSound>;
}
export function soundLibrary(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw)
      .filter(
        ([key, value]) =>
          isClipSound(key) &&
          typeof value === "string" &&
          value.length > 0 &&
          value.length <= 256,
      )
      .slice(0, 16),
  ) as Record<string, string>;
}
export function resolveNotificationSound(
  prefs: {
    sound: NotificationSound;
    serverSounds: Record<string, NotificationSound>;
    conversationSounds: Record<string, NotificationSound>;
  },
  server: string,
  conversation?: string,
): NotificationSound {
  return (
    (conversation
      ? prefs.conversationSounds[JSON.stringify([server, conversation])]
      : undefined) ??
    prefs.serverSounds[server] ??
    prefs.sound
  );
}
