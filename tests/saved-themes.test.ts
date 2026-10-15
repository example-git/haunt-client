import { afterEach, expect, it, vi } from "vitest";
import {
  exportTheme,
  importTheme,
  normalizeSavedThemes,
} from "../packages/browser/src/saved-themes";
import {
  normalizeTheme,
  themePresets,
  themeBackground,
  contrast,
} from "../packages/browser/src/themes";
const preset = themePresets.find((t) => t.id === "ultraviolet")!;
const theme = {
  name: "My violet",
  theme: normalizeTheme(preset),
  accentColor: preset.accent,
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
it("round-trips only appearance data including multicolor backgrounds", () => {
  const result = exportTheme({
    ...theme,
    sessions: ["private-token"],
  } as typeof theme);
  expect(result).not.toContain("private-token");
  expect(importTheme(result)).toEqual(theme);
  expect(themeBackground(theme.theme)).toContain("linear-gradient(145deg");
  for (const p of themePresets)
    for (const bg of p.gradient?.colors ?? []) {
      expect(contrast(p.colors.text, bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.colors.muted, bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.accent, bg)).toBeGreaterThanOrEqual(4.5);
    }
});
it("rejects invalid, oversized and unsafe imports", () => {
  const good = JSON.parse(exportTheme(theme));
  for (const bad of [
    "invalid",
    "x".repeat(32769),
    JSON.stringify({ ...good, version: 2 }),
    JSON.stringify({ ...good, name: "\n" }),
    JSON.stringify({ ...good, accentColor: "url(https://external.test)" }),
    JSON.stringify({
      ...good,
      theme: {
        ...good.theme,
        gradient: {
          angle: 12,
          colors: ["#111111", "url(https://external.test)"],
        },
      },
    }),
  ])
    expect(() => importTheme(bad)).toThrow();
  expect(
    normalizeSavedThemes([
      { id: "a", ...theme },
      { id: "a", ...theme },
      { id: "bad", name: "invalid" },
    ]),
  ).toHaveLength(1);
});
it("saved presets persist independently of active appearance and are bounded", async () => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => data.set(k, v),
  });
  const prefs = await import("../packages/browser/src/preferences");
  prefs.setPreferences({ savedThemes: [{ ...theme, id: "saved" }] });
  prefs.setPreferences({ accentColor: "#112233" });
  vi.resetModules();
  const restored = await import("../packages/browser/src/preferences");
  expect(restored.getPreferences().savedThemes).toEqual([
    { ...theme, id: "saved" },
  ]);
  expect(restored.getPreferences().accentColor).toBe("#112233");
  expect(
    normalizeSavedThemes(
      Array.from({ length: 100 }, (_, i) => ({ ...theme, id: `theme-${i}` })),
    ),
  ).toHaveLength(64);
});
