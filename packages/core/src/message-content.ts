import type { Message } from "./types.js";

/** Local presentation schema, independent of the server's message revision. */
export const messageDisplayVersion = 1;
export const mlsMessagePrefix = "!haunt-mls-v1!";
export const isEncryptedEnvelope = (body: string) =>
  body.startsWith("!haunt-mls-");

/** Never expose a wire envelope as chat text, including old IndexedDB rows. */
export function cachedMessage(message: Message): Message {
  if (message.deleted) return { ...message, body: "", attachment_ids: [] };
  const wire =
    message.wire ??
    (message.security !== "encrypted" && isEncryptedEnvelope(message.body)
      ? { body: message.body, attachment_ids: message.attachment_ids ?? [] }
      : undefined);
  if (!wire) return message;
  if ((message.displayVersion ?? 0) > messageDisplayVersion)
    return {
      ...message,
      wire,
      body: "Update your client to read this message",
      attachment_ids: [],
      security: "unavailable",
    };
  if (
    message.displayVersion === messageDisplayVersion &&
    message.wire &&
    message.security &&
    ["encrypted", "unavailable", "pending"].includes(message.security)
  )
    return message;
  return {
    ...message,
    wire,
    body: "Decrypting message…",
    attachment_ids: [],
    security: "pending",
    securityError: undefined,
    displayVersion: messageDisplayVersion,
  };
}
