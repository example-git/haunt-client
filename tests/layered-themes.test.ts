import { expect, it } from "vitest";
import {
  contrast,
  layerPalette,
  normalizeTheme,
  restoreTheme,
  themePresets,
  glassLayerColor,
  mixColor,
} from "../packages/browser/src/themes";
import { exportTheme, importTheme } from "../packages/browser/src/saved-themes";

const ids = ["rose-slate", "mint-ink", "peach-noir", "lilac-carbon"];
it("keeps dark glass side panels distinct from content at low opacity", () => {
  for (const opacity of [30, 50, 82, 100]) {
    const tint = glassLayerColor("#323232", "#242424", opacity);
    expect(
      contrast(mixColor(tint, "#000000", opacity / 100), "#242424"),
    ).toBeGreaterThanOrEqual(1.2);
  }
  expect(glassLayerColor("#323232", "#242424", 100)).toBe("#323232");
});
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
        layer.light ? preset.colors.background : preset.accent,
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

it.each([
  ["rose-slate", "#323232"],
  ["mint-ink", "#b9d3f8"],
  ["peach-noir", "#efb6d8"],
  ["lilac-carbon", "#a5dfed"],
])("upgrades only the unchanged installed %s palette", (id, sidebar) => {
  const preset = themePresets.find((p) => p.id === id)!;
  const legacy = {
    preset: id,
    gradient: null,
    windowEffect: "transparent",
    sidebarOpacity: 75,
    colors: {
      background: "#1b1c20",
      sidebar,
      chrome: preset.accent,
      surface: "#242529",
      raised: "#303136",
      text: "#f5f3f7",
      muted: "#b7bac4",
      border: "#484a54",
      selection: preset.accent,
      selectionText: "#1b1c20",
    },
  };
  expect(restoreTheme(legacy)).toMatchObject({
    ...legacy,
    colors: preset.colors,
  });
  const edited = { ...legacy, colors: { ...legacy.colors, raised: "#303030" } };
  expect(restoreTheme(edited).colors).toEqual(edited.colors);
  expect(restoreTheme({ ...legacy, preset: "custom" }).colors).toEqual(
    legacy.colors,
  );
  expect(normalizeTheme(legacy).colors).toEqual(legacy.colors);
});
