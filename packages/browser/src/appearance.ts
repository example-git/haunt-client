import { getPreferences, subscribePreferences } from "./preferences";
import { defaultAccent } from "./palette";
import {
  accentText,
  luminance,
  layerPalette,
  minimumSidebarOpacity,
  themeBackground,
  type WindowEffect,
} from "./themes";

/** Installed once before rendering; appearance changes never rerender chat. */
export function installAppearance() {
  let effect: WindowEffect = "solid",
    lastNative = "",
    generation = 0,
    stopped = false;
  const apply = () => {
    const prefs = getPreferences(),
      color = prefs.accentColor,
      theme = prefs.theme;
    const style = document.documentElement.style;
    const colors = theme.colors;
    const dark = luminance(colors.surface) < 0.35;
    const sidebarOpacity = Math.max(
      minimumSidebarOpacity(effect),
      theme.sidebarOpacity,
    );
    const frosted = effect === "material";
    // Edge surfaces can only be denser than the sidebar, never clearer.
    // Scale offsets with the remaining transparency so 100% stays opaque.
    const denserOpacity = (amount: number) =>
      sidebarOpacity + (100 - sidebarOpacity) * amount;
    const railOpacity = denserOpacity(frosted ? 0.25 : 0.35);
    const titlebarOpacity = denserOpacity(0.45);
    const tint = (color: string, opacity: number) =>
      opacity === 100
        ? color
        : `color-mix(in srgb, ${color} ${opacity}%, transparent)`;
    const chatBackground = theme.gradient
      ? `linear-gradient(${theme.gradient.angle}deg, ${theme.gradient.colors.map((c) => `color-mix(in srgb, ${colors.surface} 88%, ${c})`).join(", ")})`
      : colors.surface;
    const layers = Object.fromEntries(
      ["sidebar", "chrome"].flatMap((name) => {
        const palette = layerPalette(
          colors[name as "sidebar" | "chrome"],
          colors,
          color,
        );
        return Object.entries(palette).map(([key, value]) => [
          `--${name}-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
          String(value),
        ]);
      }),
    );
    // The rim stays bright even in light themes; its tint follows the palette.
    const ice = `color-mix(in srgb, ${colors.text} ${dark ? 18 : 6}%, white)`;
    const variables: Record<string, string> = {
      ...layers,
      "--haunt-black": colors.background,
      "--chrome-fill": colors.chrome,
      "--sidebar-fill": colors.sidebar,
      "--brand-icon-filter": dark ? "none" : "invert(1)",
      "--identity-text-mix": dark ? "0%" : "65%",
      "--theme-backdrop": themeBackground(theme),
      "--chat-background": chatBackground,
      "--haunt-surface": colors.surface,
      "--haunt-raised": colors.raised,
      "--haunt-text": colors.text,
      "--haunt-muted": colors.muted,
      "--haunt-border": `color-mix(in srgb, ${colors.text} ${dark ? 8 : 14}%, ${colors.surface})`,
      "--selection-background": colors.selection,
      "--selection-text": colors.selectionText,
      "--haunt-control-border": `color-mix(in srgb, ${colors.border} 65%, ${colors.text})`,
      "--haunt-hover": `color-mix(in srgb, ${colors.raised} 88%, ${colors.text})`,
      "--accent": color,
      "--haunt-ember": color,
      "--accent-text": accentText(color),
      "--accent-hover":
        color === defaultAccent
          ? "#ffb16a"
          : `color-mix(in srgb, ${color} 80%, ${dark ? "white" : "black"})`,
      "--haunt-focus": color,
      "--haunt-glow-warm": `0 0 14px color-mix(in srgb, ${color} 10%, transparent)`,
      "--sidebar-opacity": `${effect === "solid" ? 100 : sidebarOpacity}%`,
      "--window-background":
        effect === "solid" ? colors.background : "transparent",
      "--sidebar-background":
        effect === "solid"
          ? themeBackground({
              ...theme,
              colors: { ...colors, background: colors.sidebar },
            })
          : themeBackground(
              { ...theme, colors: { ...colors, background: colors.sidebar } },
              sidebarOpacity,
            ),
      "--rail-background":
        effect === "solid"
          ? themeBackground(theme)
          : themeBackground(theme, railOpacity),
      "--sidebar-surface":
        effect === "solid"
          ? colors.sidebar
          : themeBackground(
              { ...theme, colors: { ...colors, background: colors.sidebar } },
              sidebarOpacity,
            ),
      "--titlebar-background":
        effect === "solid"
          ? colors.chrome
          : themeBackground(
              { ...theme, colors: { ...colors, background: colors.chrome } },
              titlebarOpacity,
            ),
      "--glass-content-background": chatBackground,
      "--glass-control-background": colors.raised,
      "--glass-hover-background": `color-mix(in srgb, ${colors.raised} 88%, ${colors.text})`,
      "--glass-edge": tint(ice, frosted ? 32 : 23),
      "--glass-divider": tint(
        `color-mix(in srgb, ${colors.border} 70%, ${ice})`,
        frosted ? 55 : 40,
      ),
      "--glass-highlight": tint(ice, frosted ? 46 : 34),
      "--glass-glaze": tint(ice, frosted ? 9 : 4),
      "--glass-shadow": tint(colors.background, dark ? 24 : 12),
      "--glass-panel-filter": frosted ? "blur(32px) saturate(140%)" : "none",
      "--haunt-success": dark ? "#83d6b1" : "#24774e",
      "--haunt-danger": dark ? "#f28ca6" : "#b52b50",
      "--haunt-warning": dark ? "#e6c778" : "#825b10",
    };
    for (const [key, value] of Object.entries(variables))
      style.setProperty(key, value);
    style.setProperty("color-scheme", dark ? "dark" : "light");
    const bridge =
      typeof window !== "undefined"
        ? window.hauntDesktop?.appearance
        : undefined;
    if (bridge) {
      const request = {
        mode: theme.windowEffect,
        background: colors.background,
        dark,
      };
      const key = JSON.stringify(request);
      if (lastNative !== key) {
        lastNative = key;
        const current = ++generation;
        void bridge
          .set(request)
          .then((result) => {
            if (stopped || current !== generation) return;
            // A restart response has no applied effect. Keep the current one.
            effect = result.effect ?? effect;
            document.documentElement.dataset.windowEffect = effect;
            document.documentElement.dataset.appearanceRestart = String(
              result.restart,
            );
            document.documentElement.dataset.appearanceSupported = String(
              result.supported,
            );
            window.dispatchEvent(new Event("haunt:appearance"));
            apply();
          })
          .catch(() => {
            if (stopped || current !== generation) return;
            effect = "solid";
            document.documentElement.dataset.appearanceSupported = "false";
            window.dispatchEvent(new Event("haunt:appearance"));
            apply();
          });
      }
    }
  };
  apply();
  const off = subscribePreferences(apply);
  return () => {
    stopped = true;
    off();
  };
}
