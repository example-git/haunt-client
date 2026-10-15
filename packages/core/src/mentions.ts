export interface Mention {
  start: number;
  end: number;
  username: string;
}
// Usernames are immutable ASCII identifiers. Emails/URL path segments are not
// mentions; no role-wide or everyone broadcast is implied by this syntax.
export function mentions(text: string): Mention[] {
  const result: Mention[] = [];
  const pattern = /(^|[\s([{"'.,!?:;])@([a-zA-Z0-9_]{3,32})(?![a-zA-Z0-9_])/g;
  for (const match of text.matchAll(pattern)) {
    const start = match.index! + match[1].length;
    result.push({
      start,
      end: start + match[2].length + 1,
      username: match[2].toLowerCase(),
    });
  }
  return result;
}
export type NotificationRule = "inherit" | "all" | "mentions" | "mute";
export interface NotificationPolicy {
  enabled: boolean;
  mentions: boolean;
  directMessages: boolean;
  channelMessages: boolean;
  whileViewing: boolean;
}
export function shouldNotify(
  policy: NotificationPolicy,
  event: {
    own: boolean;
    mentioned: boolean;
    direct: boolean;
    viewing: boolean;
    serverRule?: NotificationRule;
    channelRule?: NotificationRule;
    userRule?: NotificationRule;
  },
) {
  if (!policy.enabled || event.own || (event.viewing && !policy.whileViewing))
    return false;
  if (event.serverRule === "mute" || event.channelRule === "mute") return false;
  const rule =
    event.channelRule && event.channelRule !== "inherit"
      ? event.channelRule
      : event.direct && event.userRule && event.userRule !== "inherit"
        ? event.userRule
        : event.serverRule;
  if (rule === "mute") return false;
  if (rule === "all") return true;
  if (rule === "mentions") return event.mentioned;
  return (
    (policy.mentions && event.mentioned) ||
    (event.direct ? policy.directMessages : policy.channelMessages)
  );
}
