import type { InstanceClient } from "./client.js";
import type { User } from "./types.js";
import { serverOrigin } from "./api.js";

/** Parse a sign-in address without letting URL userinfo change its destination. */
export function parseAccountAddress(input: string, https = true) {
  const match = /^([a-zA-Z0-9_]{3,32})@([^\s@/\\?#]+)$/.exec(input.trim());
  if (!match) throw Error("Enter your account as username@serveraddress.");
  const [, username, host] = match;
  let origin: string;
  try {
    origin = new URL(`${https ? "https" : "http"}://${host}`).origin;
  } catch {
    throw Error(
      "Enter a valid server address after @, including its port if needed.",
    );
  }
  return { username, origin: serverOrigin(origin) };
}

export function signinAddress(origin: string, username = "") {
  return `${username}@${new URL(serverOrigin(origin)).host}`;
}

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
