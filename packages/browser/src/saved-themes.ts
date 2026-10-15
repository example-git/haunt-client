import {
  colorKeys,
  hexColor,
  minimumSidebarOpacity,
  normalizeTheme,
  type ThemePreferences,
} from "./themes";

export interface SavedTheme {
  id: string;
  name: string;
  theme: ThemePreferences;
  accentColor: string;
}
export const maxSavedThemes = 64;
export const maxThemeFileBytes = 32 * 1024;
const validName = (value: unknown): value is string =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= 64 &&
  !/[\u0000-\u001f\u007f]/.test(value);

function parsePreset(value: unknown): Omit<SavedTheme, "id"> {
  if (!value || typeof value !== "object") throw Error("Invalid theme file.");
  const raw = value as SavedTheme,
    t = raw.theme;
  if (
    !validName(raw.name) ||
    !hexColor(raw.accentColor) ||
    !t ||
    !t.colors ||
    !colorKeys.every(
      (k) =>
        ((k === "selection" || k === "selectionText" || k === "sidebar") &&
          t.colors[k] === undefined) ||
        hexColor(t.colors[k]),
    ) ||
    !["solid", "material", "transparent"].includes(t.windowEffect) ||
    !Number.isFinite(t.sidebarOpacity) ||
    t.sidebarOpacity < minimumSidebarOpacity(t.windowEffect) ||
    t.sidebarOpacity > 100
  )
    throw Error(
      "Theme files need a name and valid colors and appearance settings.",
    );
  const theme = normalizeTheme(t);
  if (
    t.gradient != null &&
    (!theme.gradient || t.gradient.angle < 0 || t.gradient.angle > 360)
  )
    throw Error("Invalid theme gradient.");
  return {
    name: raw.name.trim(),
    theme,
    accentColor: raw.accentColor.toLowerCase(),
  };
}

/** Only allowlisted appearance data crosses the file boundary. No CSS, URLs or session data. */
export function importTheme(text: string): Omit<SavedTheme, "id"> {
  if (new TextEncoder().encode(text).length > maxThemeFileBytes)
    throw Error("Theme files must be smaller than 32 KiB.");
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw Error("This is not a valid Haunt theme file.");
  }
  if (raw?.format !== "haunt-theme" || raw.version !== 1)
    throw Error("Unsupported Haunt theme file version.");
  return parsePreset(raw);
}
export function exportTheme(value: Omit<SavedTheme, "id">): string {
  return (
    JSON.stringify(
      { format: "haunt-theme", version: 1, ...parsePreset(value) },
      null,
      2,
    ) + "\n"
  );
}
export function normalizeSavedThemes(value: unknown): SavedTheme[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>(),
    output: SavedTheme[] = [];
  for (const raw of value.slice(0, maxSavedThemes)) {
    try {
      if (
        !raw ||
        typeof raw.id !== "string" ||
        !/^[a-zA-Z0-9-]{1,64}$/.test(raw.id) ||
        ids.has(raw.id)
      )
        continue;
      output.push({ id: raw.id, ...parsePreset(raw) });
      ids.add(raw.id);
    } catch {
      /* Discard malformed backup entries without losing valid themes. */
    }
  }
  return output;
}
