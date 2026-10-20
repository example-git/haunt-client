import { expect, it } from "vitest";
import {
  contrast,
  layerPalette,
  normalizeTheme,
  themePresets,
} from "../packages/browser/src/themes";
import { exportTheme, importTheme } from "../packages/browser/src/saved-themes";

const ids = ["rose-slate", "mint-ink", "peach-noir", "lilac-carbon"];
for (const id of ids) {
  it(`${id} separates three layers, reverses buttons and survives sharing`, () => {
    const preset = themePresets.find((p) => p.id === id)!;
    expect(
      new Set([
        preset.colors.chrome,
        preset.colors.sidebar,
        preset.colors.surface,
      ]).size,
    ).toBe(3);
    for (const background of [
      preset.colors.chrome,
      preset.colors.sidebar,
      preset.colors.surface,
    ]) {
      const layer = layerPalette(background, preset.colors, preset.accent);
      expect(contrast(layer.text, background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(layer.muted, background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(layer.warning, background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(layer.button, layer.buttonText)).toBeGreaterThanOrEqual(
        7,
      );
      expect(contrast(layer.button, background)).toBeGreaterThanOrEqual(7);
      expect(layer.button).toBe(
        background === preset.colors.surface
          ? preset.accent
          : preset.colors.background,
      );
      if (layer.light) expect(layer.buttonText).toBe(background);
    }
    const theme = {
      name: preset.name,
      accentColor: preset.accent,
      theme: normalizeTheme({ preset: id }),
    };
    expect(importTheme(exportTheme(theme))).toEqual(theme);
  });
}

it("imports pre-layer themes using their own surface color for chrome", () => {
  const raw = { ...themePresets[0].colors, surface: "#303040" } as Record<
    string,
    string
  >;
  delete raw.chrome;
  const theme = importTheme(
    JSON.stringify({
      format: "haunt-theme",
      version: 1,
      name: "Older custom theme",
      accentColor: "#ff9a3d",
      theme: {
        preset: "custom",
        colors: raw,
        windowEffect: "solid",
        sidebarOpacity: 82,
      },
    }),
  );
  expect(theme.theme.colors.chrome).toBe("#303040");
});
