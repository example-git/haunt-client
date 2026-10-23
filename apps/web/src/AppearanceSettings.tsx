import { Check } from "lucide-react";
import { SavedThemes } from "./SavedThemes";
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import {
  getPreferences,
  setPreferences,
  subscribePreferences,
} from "@haunt/browser/preferences";
import { defaultAccent, pastelPalette } from "@haunt/browser/palette";
import {
  colorKeys,
  contrast,
  layerPalette,
  defaultTheme,
  hexColor,
  minimumSidebarOpacity,
  themePresets,
  themeBackground,
  resolvedThemeColors,
  glassLayerColor,
  type WindowEffect,
} from "@haunt/browser/themes";
const labels = {
  background: "Background and server rail",
  sidebar: "Side panels",
  chrome: "Title bars and headers",
  surface: "Chat and panels",
  raised: "Cards and controls",
  text: "Main text",
  muted: "Secondary text",
  border: "Borders",
  selection: "Text selection background",
  selectionText: "Selected text",
};
function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <label className="theme-color-field">
      <span>{label}</span>
      <div>
        <input
          type="color"
          aria-label={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          aria-label={`${label} hex`}
          value={draft}
          maxLength={7}
          spellCheck={false}
          onChange={(e) => {
            setDraft(e.target.value);
            if (hexColor(e.target.value))
              onChange(e.target.value.toLowerCase());
          }}
          onBlur={() => setDraft(value)}
        />
      </div>
    </label>
  );
}
export function AppearanceSettings() {
  const prefs = useSyncExternalStore(subscribePreferences, getPreferences),
    theme = prefs.theme;
  const [native, setNative] = useState({ restart: false, supported: true });
  useEffect(() => {
    const update = () =>
      setNative({
        restart: document.documentElement.dataset.appearanceRestart === "true",
        supported:
          document.documentElement.dataset.appearanceSupported !== "false",
      });
    update();
    window.addEventListener("haunt:appearance", update);
    return () => window.removeEventListener("haunt:appearance", update);
  }, []);
  const desktop = window.hauntDesktop;
  const material = desktop?.platform === "darwin" ? "Frosted glass" : "Mica";
  const lowContrast =
    contrast(theme.colors.selectionText, theme.colors.selection) < 4.5 ||
    (theme.gradient?.colors.some(
      (c) =>
        contrast(theme.colors.text, c) < 4.5 ||
        contrast(theme.colors.muted, c) < 4.5,
    ) ??
      false) ||
    ["sidebar", "chrome"].some((key) => {
      const layer = layerPalette(
        theme.colors[key as "sidebar" | "chrome"],
        theme.colors,
        prefs.accentColor,
      );
      return (
        contrast(layer.text, layer.background) < 4.5 ||
        contrast(layer.button, layer.buttonText) < 4.5
      );
    }) ||
    colorKeys
      .filter((k) => ["background", "surface", "raised"].includes(k))
      .some(
        (k) =>
          contrast(theme.colors.text, theme.colors[k]) < 4.5 ||
          contrast(theme.colors.muted, theme.colors[k]) < 4.5,
      );
  return (
    <section className="appearance-settings form">
      <fieldset className="message-display-settings">
        <legend>Message display</legend>
        <div
          className={`messages message-display-preview ${prefs.chatDisplay === "compact" ? "chat-display-compact" : ""}`}
          role="group"
          aria-label="Message preview"
        >
          <article className="message">
            {prefs.chatDisplay === "compact" ? (
              <time className="compact-message-time">09:41 AM</time>
            ) : (
              <div className="message-avatar">
                <span className="avatar" aria-hidden="true">
                  H
                </span>
              </div>
            )}
            <div className="message-content">
              <div className="message-meta">
                <strong>Haunt</strong>
                {prefs.chatDisplay === "default" && <time>09:41 AM</time>}
              </div>
              <div className="message-body markdown">
                <p>Hi there! Here’s how your messages will look.</p>
              </div>
            </div>
          </article>
        </div>
        <div className="message-display-options">
          {(["default", "compact"] as const).map((mode) => (
            <label className="message-display-option" key={mode}>
              <input
                type="radio"
                name="message-display"
                aria-label={mode === "compact" ? "Compact" : "Default"}
                value={mode}
                checked={prefs.chatDisplay === mode}
                onChange={() => setPreferences({ chatDisplay: mode })}
              />
              <span>
                <strong>{mode === "compact" ? "Compact" : "Default"}</strong>
                <small>
                  {mode === "compact"
                    ? "Inline names and tighter rows"
                    : "Avatars and spaced messages"}
                </small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <SavedThemes>
        <div className="theme-presets">
          {themePresets.map((preset) => {
            const colors = resolvedThemeColors(
              preset.colors,
              preset.accent,
              theme.windowEffect,
            );
            const opacity =
              theme.windowEffect === "solid"
                ? 100
                : Math.max(
                    theme.sidebarOpacity,
                    minimumSidebarOpacity(theme.windowEffect),
                  );
            const background = (color: string, alpha = 100) =>
              themeBackground(
                {
                  ...preset,
                  colors: {
                    ...colors,
                    background: glassLayerColor(color, colors.surface, alpha),
                  },
                },
                alpha,
              );
            return (
              <button
                type="button"
                key={preset.id}
                className="theme-preset"
                aria-pressed={
                  theme.preset === preset.id &&
                  prefs.accentColor === preset.accent
                }
                onClick={() =>
                  setPreferences({
                    theme: {
                      ...theme,
                      preset: preset.id,
                      colors: { ...preset.colors },
                      gradient: preset.gradient ?? null,
                    },
                    accentColor: preset.accent,
                  })
                }
              >
                <span
                  className="theme-preview"
                  data-window-effect={theme.windowEffect}
                  style={
                    {
                      "--preview-backdrop": background(colors.background),
                      "--preview-rail": background(
                        theme.windowEffect === "solid"
                          ? colors.background
                          : colors.sidebar,
                        opacity +
                          (100 - opacity) *
                            (theme.windowEffect === "material" ? 0.25 : 0.35),
                      ),
                      "--preview-sidebar": background(colors.sidebar, opacity),
                      "--preview-chrome": background(
                        colors.chrome,
                        opacity + (100 - opacity) * 0.45,
                      ),
                      "--preview-chat": background(colors.surface),
                      "--preview-raised": colors.raised,
                      "--preview-accent": layerPalette(
                        colors.sidebar,
                        colors,
                        preset.accent,
                      ).button,
                      "--preview-muted": preset.colors.muted,
                    } as CSSProperties
                  }
                  aria-hidden="true"
                >
                  <span className="preview-header" />
                  <span className="preview-rail">
                    <i />
                    <i />
                  </span>
                  <span className="preview-sidebar">
                    <i />
                    <i />
                    <span />
                  </span>
                  <span className="preview-chat">
                    <i />
                    <i />
                    <b />
                  </span>
                </span>
                {theme.preset === preset.id &&
                  prefs.accentColor === preset.accent && (
                    <Check
                      className="theme-selected-check"
                      size={15}
                      aria-hidden="true"
                    />
                  )}
                {preset.name}
              </button>
            );
          })}
        </div>
      </SavedThemes>
      <fieldset>
        <legend>Custom colors</legend>
        <div className="theme-colors">
          {colorKeys.map((key) => (
            <ColorField
              key={key}
              label={labels[key]}
              value={theme.colors[key]}
              onChange={(value) =>
                setPreferences({
                  theme: {
                    ...theme,
                    preset: "custom",
                    colors: { ...theme.colors, [key]: value },
                  },
                })
              }
            />
          ))}
          <ColorField
            label="Accent"
            value={prefs.accentColor}
            onChange={(accentColor) => setPreferences({ accentColor })}
          />
        </div>
        {lowContrast && (
          <p className="theme-contrast-note" role="status">
            Some text has low contrast against your chosen backgrounds. Adjust
            the text colors or choose a preset.
          </p>
        )}
      </fieldset>
      <fieldset className="form">
        <legend>Background blend</legend>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={!!theme.gradient}
            onChange={(e) =>
              setPreferences({
                theme: {
                  ...theme,
                  preset: "custom",
                  gradient: e.target.checked
                    ? {
                        angle: 145,
                        colors: [
                          theme.colors.background,
                          theme.colors.surface,
                          theme.colors.raised,
                        ],
                      }
                    : null,
                },
              })
            }
          />
          Blend background colors
        </label>
        {theme.gradient && (
          <>
            <div className="theme-colors">
              {theme.gradient.colors.map((color, index) => (
                <ColorField
                  key={index}
                  label={`Blend color ${index + 1}`}
                  value={color}
                  onChange={(value) =>
                    setPreferences({
                      theme: {
                        ...theme,
                        preset: "custom",
                        gradient: {
                          ...theme.gradient!,
                          colors: theme.gradient!.colors.map((c, i) =>
                            i === index ? value : c,
                          ),
                        },
                      },
                    })
                  }
                />
              ))}
            </div>
            <label>
              Blend angle <output>{theme.gradient.angle}°</output>
              <input
                aria-label="Blend angle"
                type="range"
                min="0"
                max="360"
                value={theme.gradient.angle}
                onChange={(e) =>
                  setPreferences({
                    theme: {
                      ...theme,
                      preset: "custom",
                      gradient: {
                        ...theme.gradient!,
                        angle: e.target.valueAsNumber,
                      },
                    },
                  })
                }
              />
            </label>
          </>
        )}
      </fieldset>
      <details className="accent-picker">
        <summary>Pastel accent palette</summary>
        {[
          {
            name: "Original",
            colors: [{ name: "Ember (default)", value: defaultAccent }],
          },
          ...pastelPalette,
        ].map((group) => (
          <div className="accent-family" key={group.name}>
            <span>{group.name}</span>
            <div className="accent-swatches">
              {group.colors.map((color) => (
                <label
                  key={color.value}
                  className="accent-swatch"
                  title={`${color.name} · ${color.value}`}
                  style={{ "--swatch": color.value } as CSSProperties}
                >
                  <input
                    type="radio"
                    name="client-accent"
                    aria-label={color.name}
                    value={color.value}
                    checked={prefs.accentColor === color.value}
                    onChange={() =>
                      setPreferences({ accentColor: color.value })
                    }
                  />
                  <span aria-hidden="true">
                    {prefs.accentColor === color.value ? "✓" : ""}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </details>
      {desktop && (
        <fieldset className="form">
          <legend>Desktop window</legend>
          <label>
            Window effect
            <select
              aria-label="Window effect"
              value={theme.windowEffect}
              onChange={(e) =>
                setPreferences({
                  theme: {
                    ...theme,
                    windowEffect: e.target.value as WindowEffect,
                  },
                })
              }
            >
              <option value="solid">Solid</option>
              <option value="material" disabled={desktop.platform === "linux"}>
                {material}
              </option>
              <option value="transparent">Transparent</option>
            </select>
          </label>
          {theme.windowEffect !== "solid" && (
            <label>
              Sidebar opacity <output>{theme.sidebarOpacity}%</output>
              <input
                aria-label="Sidebar opacity"
                type="range"
                min={minimumSidebarOpacity(theme.windowEffect)}
                max="100"
                value={theme.sidebarOpacity}
                onChange={(e) =>
                  setPreferences({
                    theme: { ...theme, sidebarOpacity: e.target.valueAsNumber },
                  })
                }
              />
            </label>
          )}
          <p className="muted small">
            Side panels use this opacity; the server rail, headers, and account
            controls keep a denser theme tint. Chat, notifications, and the
            composer stay opaque. Fine grain gives the glass texture, with soft
            frosting on chrome. Frosted glass adds blur and stronger highlights.
            All surfaces keep your theme colors and gradients. Frosted glass
            starts at 30%; transparent mode starts at 50%. Desktop effects
            depend on your operating system and compositor.
          </p>
          {!desktop.appearance && (
            <p role="status">
              Rebuild or update the desktop app to enable window effects.
            </p>
          )}
          {native.restart && (
            <p role="status">
              Restart the app to apply this window effect. Your choice is saved.
            </p>
          )}
          {!native.supported && (
            <p role="status">
              This system cannot apply the chosen effect. Using a solid
              background.
            </p>
          )}
        </fieldset>
      )}
      <button
        className="theme-reset"
        onClick={() =>
          setPreferences({ theme: defaultTheme, accentColor: defaultAccent })
        }
      >
        Reset appearance
      </button>
    </section>
  );
}
