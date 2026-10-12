import { CircleCheck, CircleAlert, CircleHelp } from "lucide-react";
import type { Message } from "@haunt/core";

export function MessageSecurity({ message }: { message: Message }) {
  const encrypted = message.security === "encrypted";
  const unavailable =
    message.security === "unavailable" || message.security === "pending";
  const description = encrypted
    ? "End-to-end encrypted"
    : message.security === "pending"
      ? "Decrypting encrypted message"
      : unavailable
        ? `Encrypted message — could not decrypt on this device${message.securityError ? `: ${message.securityError}` : ""}`
        : "Not end-to-end encrypted";
  const Icon = encrypted ? CircleCheck : unavailable ? CircleHelp : CircleAlert;
  return (
    <span
      className={`message-security ${encrypted ? "encrypted" : unavailable ? "unavailable" : "unencrypted"}`}
      role="img"
      aria-label={description}
      title={description}
      tabIndex={0}
    >
      <Icon size={14} aria-hidden="true" />
    </span>
  );
}
