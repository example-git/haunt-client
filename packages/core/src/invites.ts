import { serverOrigin } from "./api.js";

export interface Invitation {
  origin: string;
  token: string;
}
// 32 random bytes, canonical unpadded base64url. Keep the secret out of HTTP URLs.
const tokenPattern = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
export function inviteLink(address: string, token: string): string {
  if (!tokenPattern.test(token)) throw Error("Invalid invitation code.");
  return `${serverOrigin(address)}/#invite=${token}`;
}
/** Returns undefined for an ordinary server address; malformed links are rejected. */
export function parseInviteLink(input: string): Invitation | undefined {
  const value = input.trim();
  if (!value.includes("#")) return undefined;
  const url = new URL(value.includes("://") ? value : `https://${value}`);
  const match = /^#invite=([A-Za-z0-9_-]+)$/.exec(url.hash);
  if (!match || !tokenPattern.test(match[1]))
    throw Error("That invitation link is invalid.");
  url.hash = "";
  return { origin: serverOrigin(url.href), token: match[1] };
}
