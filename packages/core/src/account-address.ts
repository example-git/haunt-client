import type { InstanceClient } from "./client.js";
import type { User } from "./types.js";

/** Human-readable address. Storage, sessions and encryption keep immutable IDs. */
export function serverAddress(
  instance: Pick<InstanceClient, "origin" | "account">,
): string {
  try {
    const canonical = new URL(instance.account.instance.public_url);
    if (["https:", "http:"].includes(canonical.protocol)) return canonical.host;
  } catch {
    /* Saved clients may predate canonical URL discovery. */
  }
  return new URL(instance.origin).host;
}
export const userAddress = (
  instance: Pick<InstanceClient, "origin" | "account">,
  user: Pick<User, "username">,
) => `${user.username}@${serverAddress(instance)}`;
