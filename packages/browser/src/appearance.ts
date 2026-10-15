import { getPreferences, subscribePreferences } from "./preferences";
import { defaultAccent } from "./palette";

/** Installed once before rendering; appearance changes never rerender chat. */
export function installAppearance() {
  const apply = () => {
    const color = getPreferences().accentColor;
    const style = document.documentElement.style;
    style.setProperty("--accent", color);
    style.setProperty(
      "--accent-hover",
      color === defaultAccent
        ? "#ffb16a"
        : `color-mix(in srgb, ${color} 80%, white)`,
    );
    style.setProperty(
      "--haunt-focus",
      color === defaultAccent
        ? "#b8c6ff"
        : `color-mix(in srgb, ${color} 70%, white)`,
    );
    style.setProperty(
      "--haunt-glow-warm",
      `0 0 14px color-mix(in srgb, ${color} 10%, transparent)`,
    );
  };
  apply();
  return subscribePreferences(apply);
}
