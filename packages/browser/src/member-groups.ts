import type { User, UserStatus } from "@haunt/core";
const names = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
});
/** Each online member has one server-resolved display role; offline members stay below. */
export function memberGroups(
  users: User[],
  status: (id: string) => UserStatus,
  search = "",
) {
  const query = search.toLocaleLowerCase();
  const sorted = users
    .filter((u) =>
      `${u.display_name || u.username} ${u.username}`
        .toLocaleLowerCase()
        .includes(query),
    )
    .sort(
      (a, b) =>
        names.compare(
          a.display_name || a.username,
          b.display_name || b.username,
        ) ||
        names.compare(a.username, b.username) ||
        a.id.localeCompare(b.id),
    );
  const sections: { id: string; label: string; users: User[] }[] = [];
  const roleGroups = new Map<
    string,
    { id: string; label: string; position: number; users: User[] }
  >();
  const online: User[] = [],
    offline: User[] = [],
    unknown: User[] = [];
  for (const user of sorted) {
    const presence = status(user.id);
    if (presence === "offline") offline.push(user);
    else if (presence !== "online") unknown.push(user);
    else if (user.display_role) {
      const role = user.display_role;
      let section = roleGroups.get(role.id);
      if (!section) {
        section = {
          id: `role:${role.id}`,
          label: role.name,
          position: role.position,
          users: [],
        };
        roleGroups.set(role.id, section);
      }
      section.users.push(user);
    } else online.push(user);
  }
  sections.push(
    ...[...roleGroups.values()].sort(
      (a, b) => b.position - a.position || a.id.localeCompare(b.id),
    ),
  );
  if (online.length)
    sections.push({ id: "online", label: "Online", users: online });
  if (offline.length)
    sections.push({ id: "offline", label: "Offline", users: offline });
  if (unknown.length)
    sections.push({
      id: "unknown",
      label: "Status unavailable",
      users: unknown,
    });
  return sections;
}
