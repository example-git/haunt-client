import type { Emoji } from "@haunt/core";

export interface PickerEmoji {
  key: string;
  name: string;
  text: string;
  search: string;
  emoji?: Emoji;
}
export interface EmojiGroup {
  id: string;
  name: string;
  icon: string;
  items: PickerEmoji[];
}
export interface EmojiRow {
  top: number;
  height: number;
  group: EmojiGroup;
  items: PickerEmoji[];
  start: number;
}
export const emojiColumns = 8;
export const recentLimit = 24;

export function customEmojiGroup(emojis: Emoji[], name: string): EmojiGroup {
  return {
    id: "server",
    name,
    icon: "★",
    items: emojis.map((emoji) => ({
      key: `server:${emoji.id}`,
      name: emoji.name,
      text: `:${emoji.name}:`,
      search: emoji.name.replaceAll("_", " "),
      emoji,
    })),
  };
}
export function searchEmojiGroups(
  groups: EmojiGroup[],
  query: string,
): EmojiGroup[] {
  const terms = query
    .toLowerCase()
    .replaceAll(":", "")
    .replaceAll("_", " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const exact = (item: PickerEmoji) =>
    Number(item.name.replaceAll("_", " ") === terms.join(" "));
  return terms.length
    ? groups
        .map((group) => ({
          ...group,
          items: group.items
            .filter((item) =>
              terms.every(
                (term) =>
                  item.search.includes(term) || item.text.includes(term),
              ),
            )
            .sort((a, b) => exact(b) - exact(a)),
        }))
        .filter((group) => group.items.length)
    : groups.filter((group) => group.items.length);
}
export function layoutEmojiGroups(groups: EmojiGroup[]) {
  const rows: EmojiRow[] = [],
    items: PickerEmoji[] = [],
    positions: number[] = [];
  let height = 0;
  for (const group of groups) {
    rows.push({
      top: height,
      height: 30,
      group,
      items: [],
      start: items.length,
    });
    height += 30;
    for (let i = 0; i < group.items.length; i += emojiColumns) {
      const row = group.items.slice(i, i + emojiColumns);
      rows.push({
        top: height,
        height: 42,
        group,
        items: row,
        start: items.length,
      });
      items.push(...row);
      positions.push(...row.map(() => height));
      height += 42;
    }
  }
  return { rows, items, positions, height };
}
export function loadEmojiRecents(
  storage: Pick<Storage, "getItem">,
  key: string,
): string[] {
  try {
    const saved: unknown = JSON.parse(storage.getItem(key) ?? "[]");
    return Array.isArray(saved)
      ? [
          ...new Set(
            saved.filter(
              (v): v is string => typeof v === "string" && v.length <= 100,
            ),
          ),
        ].slice(0, recentLimit)
      : [];
  } catch {
    return [];
  }
}
export function rememberEmoji(
  storage: Pick<Storage, "setItem">,
  key: string,
  recent: string[],
  item: string,
) {
  const next = [item, ...recent.filter((v) => v !== item)].slice(
    0,
    recentLimit,
  );
  try {
    storage.setItem(key, JSON.stringify(next));
  } catch {
    /* Storage may be disabled. */
  }
  return next;
}
