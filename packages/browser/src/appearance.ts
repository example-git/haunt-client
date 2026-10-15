import { getPreferences, subscribePreferences } from "./preferences";
import { defaultAccent } from "./palette";
import {
  accentText,
  luminance,
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
    const offsetOpacity = (offset: number) =>
      Math.max(24, Math.min(96, sidebarOpacity + offset));
    const railOpacity = offsetOpacity(frosted ? 6 : -12);
    const contentOpacity = offsetOpacity(frosted ? -8 : -18);
    const controlOpacity = offsetOpacity(frosted ? 8 : 4);
    const tint = (color: string, opacity: number) =>
      `color-mix(in srgb, ${color} ${opacity}%, transparent)`;
    // The rim stays bright even in light themes; its tint follows the palette.
    const ice = `color-mix(in srgb, ${colors.text} ${dark ? 18 : 6}%, white)`;
    const variables: Record<string, string> = {
      "--haunt-black": colors.background,
      "--brand-icon-filter": dark ? "none" : "invert(1)",
      "--identity-text-mix": dark ? "0%" : "65%",
      "--theme-backdrop": themeBackground(theme),
      "--chat-background": theme.gradient
        ? `linear-gradient(${theme.gradient.angle}deg, ${theme.gradient.colors.map((c) => `color-mix(in srgb, ${colors.surface} 88%, ${c})`).join(", ")})`
        : colors.surface,
      "--haunt-surface": colors.surface,
      "--haunt-raised": colors.raised,
      "--haunt-text": colors.text,
      "--haunt-muted": colors.muted,
      "--haunt-border": colors.border,
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
      "--haunt-focus":
        color === defaultAccent
          ? "#b8c6ff"
          : `color-mix(in srgb, ${color} 70%, ${dark ? "white" : "black"})`,
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
          ? colors.surface
          : tint(colors.surface, sidebarOpacity),
      "--glass-content-background": themeBackground(
        { ...theme, colors: { ...colors, background: colors.surface } },
        contentOpacity,
      ),
      "--glass-control-background": tint(colors.raised, controlOpacity),
      "--glass-hover-background": tint(colors.raised, offsetOpacity(12)),
      "--glass-edge": tint(ice, frosted ? 32 : 23),
      "--glass-highlight": tint(ice, frosted ? 46 : 34),
      "--glass-glaze": tint(ice, frosted ? 9 : 4),
      "--glass-shadow": tint(colors.background, dark ? 24 : 12),
      "--glass-content-filter": `blur(${frosted ? 24 : 12}px) saturate(${frosted ? 135 : 115}%)`,
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
