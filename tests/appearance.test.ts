import { afterEach, expect, it, vi } from "vitest";
import {
  defaultAccent,
  pastelPalette,
  normalizeAccent,
} from "../packages/browser/src/palette";
import { backupPreference } from "@haunt/core";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
it("offers 96 unique pastels with readable dark text and rejects unsafe stored colors", () => {
  const colors = pastelPalette.flatMap((group) =>
    group.colors.map((color) => color.value),
  );
  expect(new Set(colors).size).toBe(96);
  const luminance = (hex: string) => {
    const rgb = hex
      .slice(1)
      .match(/../g)!
      .map((part) => {
        const v = parseInt(part, 16) / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  for (const color of [defaultAccent, ...colors]) {
    expect(
      (luminance(color) + 0.05) / (luminance("#060609") + 0.05),
    ).toBeGreaterThan(7);
    expect(normalizeAccent(color.toUpperCase())).toBe(color);
  }
  expect(normalizeAccent("#000000")).toBe("#000000");
  for (const bad of [null, {}, "url(https://example.test)", "red"])
    expect(normalizeAccent(bad)).toBe(defaultAccent);
});
it("persists the accent with existing backed-up preferences and applies changes without a reload", async () => {
  const storage = new Map<string, string>();
  const properties = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal("document", {
    documentElement: {
      style: {
        setProperty: (key: string, value: string) => properties.set(key, value),
      },
    },
  });
  const prefs = await import("../packages/browser/src/preferences");
  const { installAppearance } =
    await import("../packages/browser/src/appearance");
  const stop = installAppearance();
  expect(properties.get("--accent")).toBe(defaultAccent);
  const pastel = pastelPalette[8].colors[2].value;
  prefs.setPreferences({ accentColor: pastel });
  expect(properties.get("--accent")).toBe(pastel);
  expect(properties.get("--haunt-focus")).toContain(pastel);
  const key = "chatxo-client-preferences-v1";
  expect(backupPreference(key)).toBe(true);
  expect(JSON.parse(storage.get(key)!).accentColor).toBe(pastel);
  stop();
  vi.resetModules();
  const restored = await import("../packages/browser/src/preferences");
  expect(restored.getPreferences().accentColor).toBe(pastel);
  restored.setPreferences({ accentColor: "invalid" });
  expect(restored.getPreferences().accentColor).toBe(defaultAccent);
});

it("restores custom theme colors, bounds transparency and keeps preferences in backups", async () => {
  const { normalizeTheme, themePresets, contrast } =
    await import("../packages/browser/src/themes");
  for (const preset of themePresets) {
    for (const bg of [
      preset.colors.background,
      preset.colors.surface,
      preset.colors.raised,
    ]) {
      expect(contrast(preset.colors.text, bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(preset.colors.muted, bg)).toBeGreaterThanOrEqual(4.5);
    }
  }
  const saved = normalizeTheme({
    preset: "midnight",
    colors: { text: "#FFCCAA", surface: "url(https://untrusted.test)" },
    windowEffect: "transparent",
    sidebarOpacity: -10,
  });
  expect(saved).toMatchObject({
    preset: "custom",
    colors: { text: "#ffccaa", surface: "#182131" },
    windowEffect: "transparent",
    sidebarOpacity: 50,
  });
  expect(normalizeTheme(undefined).preset).toBe("charcoal");
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
  });
  const prefs = await import("../packages/browser/src/preferences");
  prefs.setPreferences({ theme: saved, accentColor: "#123abc" });
  vi.resetModules();
  const restored = await import("../packages/browser/src/preferences");
  expect(restored.getPreferences().theme).toEqual(saved);
  expect(restored.getPreferences().accentColor).toBe("#123abc");
});

it.each(["unchanged", "edited", "custom"])(
  "restores the %s old Rose Slate selection while preserving saved copies",
  async (kind) => {
    const { themePresets } = await import("../packages/browser/src/themes");
    const rose = themePresets.find((preset) => preset.id === "rose-slate")!;
    const legacy = {
      preset: kind === "custom" ? "custom" : rose.id,
      colors: {
        ...rose.colors,
        background: "#1b1c20",
        surface: "#242529",
        raised: "#303136",
        text: "#f5f3f7",
        muted: "#b7bac4",
        border: "#484a54",
        selectionText: "#1b1c20",
        sidebar: "#c8b8ee",
        ...(kind === "edited" ? { surface: "#202020" } : {}),
      },
      gradient: null,
      windowEffect: "transparent",
      sidebarOpacity: 75,
    };
    const saved = {
      id: "original-rose",
      name: "My original rose",
      theme: legacy,
      accentColor: rose.accent,
    };
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify({ theme: legacy, savedThemes: [saved] }),
      setItem: () => {},
    });
    const { getPreferences } =
      await import("../packages/browser/src/preferences");
    const { theme, savedThemes } = getPreferences();
    expect(theme).toMatchObject({
      preset: kind === "unchanged" ? rose.id : "custom",
      colors: kind === "unchanged" ? rose.colors : legacy.colors,
      windowEffect: "transparent",
      sidebarOpacity: 75,
    });
    expect(savedThemes[0].theme.colors).toEqual(legacy.colors);
  },
);

it("keeps glass content opaque, bounds edge tints and preserves the applied effect during a restart", async () => {
  const properties = new Map<string, string>();
  const dataset: Record<string, string> = {};
  const set = vi.fn().mockImplementation(async (request) => ({
    effect: request.mode,
    restart: false,
    supported: true,
  }));
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  vi.stubGlobal("document", {
    documentElement: {
      style: {
        setProperty: (key: string, value: string) => properties.set(key, value),
      },
      dataset,
    },
  });
  vi.stubGlobal("window", {
    hauntDesktop: { appearance: { set } },
    dispatchEvent: () => {},
    addEventListener: () => {},
  });
  const prefs = await import("../packages/browser/src/preferences");
  const { installAppearance } =
    await import("../packages/browser/src/appearance");
  const stop = installAppearance();
  await vi.waitFor(() => expect(dataset.windowEffect).toBe("solid"));
  prefs.setPreferences({
    theme: {
      ...prefs.getPreferences().theme,
      windowEffect: "transparent",
      sidebarOpacity: 70,
    },
  });
  await vi.waitFor(() => expect(dataset.windowEffect).toBe("transparent"));
  expect(properties.get("--glass-content-background")).toBe(
    prefs.getPreferences().theme.colors.surface,
  );
  expect(properties.get("--glass-control-background")).toBe(
    prefs.getPreferences().theme.colors.raised,
  );
  expect(properties.get("--rail-background")).toContain("80.5%");
  expect(properties.get("--titlebar-background")).toContain("83.5%");
  expect(properties.get("--glass-panel-filter")).toBe("none");
  prefs.setPreferences({
    theme: { ...prefs.getPreferences().theme, windowEffect: "material" },
  });
  await vi.waitFor(() => expect(dataset.windowEffect).toBe("material"));
  expect(properties.get("--glass-content-background")).toBe(
    prefs.getPreferences().theme.colors.surface,
  );
  expect(properties.get("--rail-background")).toContain("77.5%");
  expect(properties.get("--glass-panel-filter")).toContain("blur(32px)");
  for (const windowEffect of ["transparent", "material"] as const) {
    const { themePresets, minimumSidebarOpacity } =
      await import("../packages/browser/src/themes");
    for (const preset of themePresets) {
      for (const sidebarOpacity of [
        minimumSidebarOpacity(windowEffect),
        82,
        100,
      ]) {
        prefs.setPreferences({
          theme: {
            ...prefs.getPreferences().theme,
            preset: preset.id,
            colors: { ...preset.colors },
            gradient: preset.gradient ?? null,
            windowEffect,
            sidebarOpacity,
          },
        });
        await vi.waitFor(() => expect(dataset.windowEffect).toBe(windowEffect));
        const content = properties.get("--glass-content-background")!;
        expect(content).not.toContain("transparent");
        expect(content).toContain(preset.colors.surface);
        expect(properties.get("--glass-control-background")).toBe(
          preset.colors.raised,
        );
        if (preset.gradient) {
          for (const color of preset.gradient.colors)
            expect(content).toContain(color);
        }
        if (sidebarOpacity === 100) {
          for (const key of [
            "--sidebar-background",
            "--rail-background",
            "--sidebar-surface",
            "--titlebar-background",
          ])
            expect(properties.get(key)).not.toContain("transparent");
        } else {
          expect(properties.get("--sidebar-background")).toContain(
            `${sidebarOpacity}%`,
          );
        }
      }
    }
  }
  set.mockResolvedValue({ restart: true, supported: true });
  prefs.setPreferences({
    theme: { ...prefs.getPreferences().theme, windowEffect: "solid" },
  });
  await vi.waitFor(() => expect(dataset.appearanceRestart).toBe("true"));
  expect(dataset.windowEffect).toBe("material");
  set.mockResolvedValue({ effect: "solid", restart: false, supported: true });
  prefs.setPreferences({
    theme: {
      ...prefs.getPreferences().theme,
      colors: { ...prefs.getPreferences().theme.colors, background: "#112233" },
    },
  });
  await vi.waitFor(() => expect(dataset.windowEffect).toBe("solid"));
  expect(properties.get("--window-background")).toBe("#112233");
  set.mockResolvedValue({
    effect: "material",
    restart: false,
    supported: true,
  });
  prefs.setPreferences({
    theme: { ...prefs.getPreferences().theme, windowEffect: "material" },
  });
  await vi.waitFor(() => expect(dataset.windowEffect).toBe("material"));
  const appliedBackground = properties.get("--titlebar-background");
  set.mockRejectedValue(Error("Native appearance unavailable"));
  prefs.setPreferences({
    theme: { ...prefs.getPreferences().theme, windowEffect: "transparent" },
  });
  await vi.waitFor(() => expect(dataset.appearanceSupported).toBe("false"));
  expect(dataset.windowEffect).toBe("material");
  expect(properties.get("--window-background")).toBe("transparent");
  expect(properties.get("--titlebar-background")).toBe(appliedBackground);
  stop();
});

it("persists selection colors and enforces the selected native effect's opacity floor", async () => {
  const { normalizeTheme } = await import("../packages/browser/src/themes");
  const colors = { selection: "#123ABC", selectionText: "#FEDCBA" };
  expect(
    normalizeTheme({ colors, windowEffect: "material", sidebarOpacity: 0 }),
  ).toMatchObject({
    sidebarOpacity: 30,
    colors: { selection: "#123abc", selectionText: "#fedcba" },
  });
  expect(
    normalizeTheme({ colors, windowEffect: "transparent", sidebarOpacity: 30 })
      .sidebarOpacity,
  ).toBe(50);
  expect(
    normalizeTheme({ windowEffect: "transparent", sidebarOpacity: 200 })
      .sidebarOpacity,
  ).toBe(100);
  const { exportTheme, importTheme } =
    await import("../packages/browser/src/saved-themes");
  const saved = {
    name: "Selected text",
    accentColor: "#aabbcc",
    theme: normalizeTheme({
      colors,
      windowEffect: "material",
      sidebarOpacity: 30,
    }),
  };
  expect(importTheme(exportTheme(saved))).toEqual(saved);
});

it("persists compact message display independently of themes and restores the default", async () => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  const prefs = await import("../packages/browser/src/preferences");
  expect(prefs.getPreferences().chatDisplay).toBe("default");
  prefs.setPreferences({ chatDisplay: "compact" });
  expect(() =>
    prefs.setPreferences({ chatDisplay: "invalid" as never }),
  ).toThrow("Default or Compact");
  expect(prefs.getPreferences().chatDisplay).toBe("compact");
  prefs.setPreferences({ accentColor: "#f7abc3" });
  expect(prefs.getPreferences().chatDisplay).toBe("compact");
  vi.resetModules();
  const restored = await import("../packages/browser/src/preferences");
  expect(restored.getPreferences().chatDisplay).toBe("compact");
  restored.setPreferences({ chatDisplay: "default" });
  vi.resetModules();
  expect(
    (await import("../packages/browser/src/preferences")).getPreferences()
      .chatDisplay,
  ).toBe("default");
});
