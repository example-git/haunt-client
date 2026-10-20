import { defaultAccent } from "./palette";
export const colorKeys = [
  "background",
  "sidebar",
  "chrome",
  "surface",
  "raised",
  "text",
  "muted",
  "border",
  "selection",
  "selectionText",
] as const;
export type ThemeColors = Record<(typeof colorKeys)[number], string>;
export type WindowEffect = "solid" | "material" | "transparent";
export interface ThemeGradient {
  colors: string[];
  angle: number;
}
export interface ThemePreferences {
  gradient: ThemeGradient | null;
  preset: string;
  colors: ThemeColors;
  windowEffect: WindowEffect;
  sidebarOpacity: number;
}
export const themePresets: {
  id: string;
  name: string;
  accent: string;
  colors: ThemeColors;
  gradient?: ThemeGradient;
}[] = [
  {
    id: "charcoal",
    name: "Charcoal",
    accent: defaultAccent,
    colors: {
      background: "#161616",
      sidebar: "#161616",
      chrome: "#202020",
      surface: "#202020",
      raised: "#292929",
      text: "#f2f2f2",
      muted: "#adadad",
      border: "#383838",
      selection: "#ff9a3d",
      selectionText: "#161616",
    },
  },
  {
    id: "midnight",
    name: "Midnight",
    accent: "#9bbdff",
    colors: {
      background: "#101622",
      sidebar: "#101622",
      chrome: "#182131",
      surface: "#182131",
      raised: "#222e41",
      text: "#edf2ff",
      muted: "#a2b0c8",
      border: "#344259",
      selection: "#9bbdff",
      selectionText: "#161616",
    },
  },
  {
    id: "plum",
    name: "Plum",
    accent: "#d9b4ef",
    colors: {
      background: "#1c1520",
      sidebar: "#1c1520",
      chrome: "#281e2d",
      surface: "#281e2d",
      raised: "#35283b",
      text: "#f5edf8",
      muted: "#bda9c5",
      border: "#4b3953",
      selection: "#d9b4ef",
      selectionText: "#161616",
    },
  },
  {
    id: "forest",
    name: "Forest",
    accent: "#a6d7b7",
    colors: {
      background: "#121c19",
      sidebar: "#121c19",
      chrome: "#1b2823",
      surface: "#1b2823",
      raised: "#26382f",
      text: "#edf4ef",
      muted: "#a5b9ae",
      border: "#3a5044",
      selection: "#a6d7b7",
      selectionText: "#161616",
    },
  },
  {
    id: "paper",
    name: "Paper",
    accent: "#4364b0",
    colors: {
      background: "#e6e9ef",
      sidebar: "#e6e9ef",
      chrome: "#f7f8fb",
      surface: "#f7f8fb",
      raised: "#ffffff",
      text: "#202735",
      muted: "#586477",
      border: "#cad1dc",
      selection: "#4364b0",
      selectionText: "#ffffff",
    },
  },
  {
    id: "ultraviolet",
    name: "Ultraviolet",
    accent: "#e0ff57",
    colors: {
      background: "#201239",
      sidebar: "#201239",
      chrome: "#292041",
      surface: "#292041",
      raised: "#3c2852",
      text: "#fbf4ff",
      muted: "#cbbcdc",
      border: "#5a426f",
      selection: "#e0ff57",
      selectionText: "#161616",
    },
    gradient: { angle: 145, colors: ["#351447", "#192a4d", "#123b3b"] },
  },
  {
    id: "tidal",
    name: "Tidal",
    accent: "#ff9765",
    colors: {
      background: "#09272e",
      sidebar: "#09272e",
      chrome: "#142e3e",
      surface: "#142e3e",
      raised: "#24344d",
      text: "#edfaff",
      muted: "#aecbd4",
      border: "#3c5767",
      selection: "#ff9765",
      selectionText: "#161616",
    },
    gradient: { angle: 155, colors: ["#073936", "#123357", "#332348"] },
  },
  {
    id: "afterglow",
    name: "Afterglow",
    accent: "#65ffde",
    colors: {
      background: "#331829",
      sidebar: "#331829",
      chrome: "#3b2634",
      surface: "#3b2634",
      raised: "#49343d",
      text: "#fff4ed",
      muted: "#d8bdc8",
      border: "#73525d",
      selection: "#65ffde",
      selectionText: "#161616",
    },
    gradient: { angle: 135, colors: ["#512336", "#492d19", "#28214f"] },
  },
  {
    id: "rose-slate",
    name: "Rose Slate",
    accent: "#f7abc3",
    colors: {
      background: "#1b1c20",
      sidebar: "#c8b8ee",
      chrome: "#f7abc3",
      surface: "#242529",
      raised: "#303136",
      text: "#f5f3f7",
      muted: "#b7bac4",
      border: "#484a54",
      selection: "#f7abc3",
      selectionText: "#1b1c20",
    },
  },
  {
    id: "mint-ink",
    name: "Mint Ink",
    accent: "#a4e5cc",
    colors: {
      background: "#1b1c20",
      sidebar: "#b9d3f8",
      chrome: "#a4e5cc",
      surface: "#242529",
      raised: "#303136",
      text: "#f5f3f7",
      muted: "#b7bac4",
      border: "#484a54",
      selection: "#a4e5cc",
      selectionText: "#1b1c20",
    },
  },
  {
    id: "peach-noir",
    name: "Peach Noir",
    accent: "#ffc39c",
    colors: {
      background: "#1b1c20",
      sidebar: "#efb6d8",
      chrome: "#ffc39c",
      surface: "#242529",
      raised: "#303136",
      text: "#f5f3f7",
      muted: "#b7bac4",
      border: "#484a54",
      selection: "#ffc39c",
      selectionText: "#1b1c20",
    },
  },
  {
    id: "lilac-carbon",
    name: "Lilac Carbon",
    accent: "#d1b9ff",
    colors: {
      background: "#1b1c20",
      sidebar: "#a5dfed",
      chrome: "#d1b9ff",
      surface: "#242529",
      raised: "#303136",
      text: "#f5f3f7",
      muted: "#b7bac4",
      border: "#484a54",
      selection: "#d1b9ff",
      selectionText: "#1b1c20",
    },
  },
  {
    id: "wumpoff",
    name: "wumpoff",
    accent: "#5865f2",
    colors: {
      background: "#121214",
      sidebar: "#1a1a1e",
      chrome: "#202024",
      surface: "#202024",
      raised: "#242429",
      text: "#efeff1",
      muted: "#96979e",
      selection: "#5865f2",
      selectionText: "#ffffff",
      border: "#2e2e33",
    },
  },
] as const;
export const defaultTheme: ThemePreferences = {
  preset: "charcoal",
  gradient: null,
  colors: { ...themePresets[0].colors },
  windowEffect: "solid",
  sidebarOpacity: 82,
};
export const hexColor = (v: unknown): v is string =>
  typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
export const minimumSidebarOpacity = (effect: WindowEffect) =>
  effect === "transparent" ? 50 : 30;

export function normalizeTheme(raw: unknown): ThemePreferences {
  const value =
    raw && typeof raw === "object" ? (raw as Partial<ThemePreferences>) : {};
  const preset = themePresets.find(
    (p) => p.id === (value.preset ?? "charcoal"),
  );
  const base = preset?.colors ?? defaultTheme.colors;
  const colors = Object.fromEntries(
    colorKeys.map((key) => [
      key,
      hexColor(value.colors?.[key])
        ? value.colors![key].toLowerCase()
        : key === "chrome" && hexColor(value.colors?.surface)
          ? value.colors.surface.toLowerCase()
          : base[key],
    ]),
  ) as ThemeColors;
  const gradient = normalizeGradient(
    value.gradient === undefined ? preset?.gradient : value.gradient,
  );
  const windowEffect = ["solid", "material", "transparent"].includes(
    value.windowEffect ?? "",
  )
    ? value.windowEffect!
    : "solid";
  return {
    gradient,
    preset:
      preset &&
      colorKeys.every((key) => colors[key] === preset.colors[key]) &&
      JSON.stringify(gradient) === JSON.stringify(preset.gradient ?? null)
        ? preset.id
        : "custom",
    colors,
    windowEffect,
    sidebarOpacity:
      typeof value.sidebarOpacity === "number" &&
      Number.isFinite(value.sidebarOpacity)
        ? Math.max(
            minimumSidebarOpacity(windowEffect),
            Math.min(100, Math.round(value.sidebarOpacity)),
          )
        : 82,
  };
}
export function luminance(hex: string) {
  const rgb = hex
    .slice(1)
    .match(/../g)!
    .map((v) => {
      const x = parseInt(v, 16) / 255;
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
export function contrast(a: string, b: string) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export function accentText(color: string) {
  return contrast(color, "#161616") >= contrast(color, "#ffffff")
    ? "#161616"
    : "#ffffff";
}

export function normalizeGradient(value: unknown): ThemeGradient | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ThemeGradient>;
  if (
    !Array.isArray(raw.colors) ||
    raw.colors.length < 2 ||
    raw.colors.length > 3 ||
    !raw.colors.every(hexColor) ||
    typeof raw.angle !== "number" ||
    !Number.isFinite(raw.angle)
  )
    return null;
  return {
    angle: Math.max(0, Math.min(360, Math.round(raw.angle))),
    colors: raw.colors.map((c) => c.toLowerCase()),
  };
}
export function themeBackground(
  theme: { colors: ThemeColors; gradient?: ThemeGradient | null },
  opacity = 100,
): string {
  const tint = (color: string) =>
    opacity === 100
      ? color
      : `color-mix(in srgb, ${color} ${opacity}%, transparent)`;
  return theme.gradient
    ? `linear-gradient(${theme.gradient.angle}deg, ${theme.gradient.colors.map(tint).join(", ")})`
    : tint(theme.colors.background);
}

/** Each shell layer carries its own legible text and contrasting controls. */
export function layerPalette(
  background: string,
  colors: ThemeColors,
  accent: string,
) {
  const light = luminance(background) > 0.35;
  const text =
    contrast(colors.text, background) >= 4.5
      ? colors.text
      : accentText(background);
  const mix = (a: string, b: string, amount: number) =>
    "#" +
    [1, 3, 5]
      .map((i) =>
        Math.round(
          parseInt(a.slice(i, i + 2), 16) * amount +
            parseInt(b.slice(i, i + 2), 16) * (1 - amount),
        )
          .toString(16)
          .padStart(2, "0"),
      )
      .join("");
  let muted = colors.muted;
  if (contrast(muted, background) < 4.5) {
    muted = mix(text, background, 0.72);
    if (contrast(muted, background) < 4.5) muted = text;
  }
  const button = light
    ? contrast(colors.background, background) >= 4.5
      ? colors.background
      : "#161616"
    : contrast(accent, background) >= 4.5
      ? accent
      : accentText(background);
  return {
    background,
    text,
    muted,
    button,
    buttonText: light ? background : accentText(button),
    hover: mix(text, background, light ? 0.1 : 0.08),
    border: light ? mix(text, background, 0.35) : colors.border,
    danger: light ? "#92213f" : "#f28ca6",
    success: light ? "#175b3b" : "#83d6b1",
    warning: light ? "#5b3d0a" : "#e6c778",
    light,
  };
}
