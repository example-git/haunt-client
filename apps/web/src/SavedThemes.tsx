import { Upload } from "lucide-react";
import { useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  getPreferences,
  setPreferences,
  subscribePreferences,
} from "@haunt/browser/preferences";
import {
  exportTheme,
  importTheme,
  maxSavedThemes,
  maxThemeFileBytes,
} from "@haunt/browser/saved-themes";

export function SavedThemes({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState("builtin");
  const prefs = useSyncExternalStore(subscribePreferences, getPreferences);
  const [selected, select] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const current = () => ({
    name,
    theme: prefs.theme,
    accentColor: prefs.accentColor,
  });
  const act = (fn: () => void) => {
    setError("");
    setStatus("");
    try {
      fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save theme.");
    }
  };
  const save = (replace: boolean) =>
    act(() => {
      const value = importTheme(exportTheme(current()));
      if (!replace && prefs.savedThemes.length >= maxSavedThemes)
        throw Error(
          "Your saved themes are full. Remove one before saving another.",
        );
      const id = replace ? selected : crypto.randomUUID();
      const saved = { ...value, id };
      setPreferences({
        savedThemes: replace
          ? prefs.savedThemes.map((t) => (t.id === id ? saved : t))
          : [...prefs.savedThemes, saved],
      });
      select(id);
      setName(value.name);
      setStatus("Theme saved on this device.");
    });
  return (
    <fieldset className="theme-picker">
      <legend>Theme</legend>
      <div className="theme-library-toolbar">
        <div
          className="theme-library-tabs"
          role="tablist"
          aria-label="Theme library"
        >
          {[
            ["builtin", "Built-in"],
            ["saved", "Saved"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`themes-tab-${id}`}
              aria-controls={`themes-panel-${id}`}
              aria-selected={tab === id}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
              onKeyDown={(event) => {
                if (
                  !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? "builtin"
                    : event.key === "End"
                      ? "saved"
                      : tab === "builtin"
                        ? "saved"
                        : "builtin";
                setTab(next);
                document.getElementById(`themes-tab-${next}`)?.focus();
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          className="theme-import secondary"
          type="button"
          onClick={() => file.current?.click()}
        >
          <Upload size={15} /> Import theme
        </button>
      </div>
      <div
        id="themes-panel-builtin"
        role="tabpanel"
        aria-labelledby="themes-tab-builtin"
        hidden={tab !== "builtin"}
      >
        {children}
      </div>
      <div
        id="themes-panel-saved"
        role="tabpanel"
        aria-labelledby="themes-tab-saved"
        hidden={tab !== "saved"}
      >
        <fieldset className="saved-themes form">
          <legend className="sr-only">Saved themes</legend>
          <label>
            Theme name
            <input
              aria-label="Theme name"
              value={name}
              maxLength={64}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name your theme"
            />
          </label>
          <div className="theme-actions">
            <button
              type="button"
              disabled={!name.trim()}
              onClick={() => save(false)}
            >
              Save as new theme
            </button>
            {selected && (
              <button
                type="button"
                disabled={!name.trim()}
                onClick={() => save(true)}
              >
                Update saved theme
              </button>
            )}
            <button
              type="button"
              disabled={!name.trim()}
              onClick={() =>
                act(() => {
                  const blob = new Blob([exportTheme(current())], {
                    type: "application/json",
                  });
                  const url = URL.createObjectURL(blob),
                    a = document.createElement("a");
                  a.href = url;
                  a.download = `${name.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 64) || "theme"}.haunt-theme.json`;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                  setStatus(
                    "Theme exported. Share this file to share your colors.",
                  );
                })
              }
            >
              Export theme
            </button>
            <input
              ref={file}
              hidden
              type="file"
              accept=".json,application/json"
              aria-label="Import theme file"
              onChange={async (e) => {
                const picked = e.target.files?.[0];
                e.target.value = "";
                if (!picked) return;
                setError("");
                setStatus("");
                try {
                  if (picked.size > maxThemeFileBytes)
                    throw Error("Theme files must be smaller than 32 KiB.");
                  const imported = importTheme(await picked.text());
                  const latest = getPreferences();
                  if (latest.savedThemes.length >= maxSavedThemes)
                    throw Error(
                      "Your saved themes are full. Remove one before importing another.",
                    );
                  const id = crypto.randomUUID();
                  setPreferences({
                    savedThemes: [...latest.savedThemes, { id, ...imported }],
                  });
                  select(id);
                  setTab("saved");
                  setName(imported.name);
                  setStatus(
                    "Theme imported. Choose Apply saved theme to use it.",
                  );
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : "Could not import theme.",
                  );
                }
              }}
            />
          </div>
          {prefs.savedThemes.length > 0 && (
            <>
              <label>
                Your themes
                <select
                  aria-label="Your themes"
                  value={selected}
                  onChange={(e) => {
                    select(e.target.value);
                    setName(
                      prefs.savedThemes.find((t) => t.id === e.target.value)
                        ?.name ?? "",
                    );
                    setStatus("");
                  }}
                >
                  <option value="">Choose a saved theme</option>
                  {prefs.savedThemes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="theme-actions">
                <button
                  type="button"
                  disabled={!selected}
                  onClick={() => {
                    const saved = prefs.savedThemes.find(
                      (t) => t.id === selected,
                    );
                    if (saved) {
                      setPreferences({
                        theme: saved.theme,
                        accentColor: saved.accentColor,
                      });
                      setStatus("Saved theme applied.");
                    }
                  }}
                >
                  Apply saved theme
                </button>
                <button
                  type="button"
                  disabled={!selected}
                  onClick={() => {
                    setPreferences({
                      savedThemes: prefs.savedThemes.filter(
                        (t) => t.id !== selected,
                      ),
                    });
                    select("");
                    setName("");
                    setStatus(
                      "Saved theme removed. Your current appearance is unchanged.",
                    );
                  }}
                >
                  Delete saved theme
                </button>
              </div>
            </>
          )}
          <p className="muted small">
            Theme files contain appearance settings only. Your saved themes are
            also included in client backups.
          </p>
        </fieldset>
      </div>
      {status && (
        <p role="status" className="small">
          {status}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
