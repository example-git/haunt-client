import { useEffect, useRef, useState, type ReactNode } from "react";
import { Minus, Square, Copy, X } from "lucide-react";

export function Titlebar({
  children,
  target = "main",
}: {
  children: ReactNode;
  target?: "main" | "call";
}) {
  const frame = useRef<HTMLElement>(null);
  const desktop = window.hauntDesktop;
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!desktop || !frame.current) return;
    const root = frame.current.ownerDocument.documentElement;
    root.dataset.nativeWindow = "normal";
    const changed = (state: {
      target: "main" | "call";
      maximized: boolean;
      fullscreen: boolean;
    }) => {
      if (state.target === target) {
        const expanded = state.maximized || state.fullscreen;
        setMaximized(expanded);
        root.dataset.nativeWindow = expanded ? "maximized" : "normal";
      }
    };
    void desktop
      .windowState(target)
      .then(changed)
      .catch(() => {});
    const off = desktop.onWindowState(changed);
    return () => {
      off();
      delete root.dataset.nativeWindow;
    };
  }, [desktop, target]);
  const control = (action: "minimize" | "maximize" | "close") =>
    void desktop?.windowControl(action, target).catch(() => {});
  return (
    <header
      ref={frame}
      className={`app-titlebar ${desktop ? "native-titlebar" : ""}`}
      data-platform={desktop?.platform}
      onDoubleClick={(e) => {
        if (!(e.target as HTMLElement).closest("button, a, input"))
          control("maximize");
      }}
    >
      <div className="titlebar-content">{children}</div>
      {desktop && (
        <div className="window-controls" aria-label="Window controls">
          <button
            onClick={() => control("minimize")}
            aria-label="Minimize window"
            title="Minimize"
          >
            <Minus size={14} />
          </button>
          <button
            onClick={() => control("maximize")}
            aria-label={maximized ? "Restore window" : "Maximize window"}
            title={maximized ? "Restore" : "Maximize"}
          >
            {maximized ? <Copy size={12} /> : <Square size={12} />}
          </button>
          <button
            className="window-close"
            onClick={() => control("close")}
            aria-label={
              target === "call" ? "Close call window" : "Close window"
            }
            title={target === "call" ? "Return call to main window" : "Close"}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </header>
  );
}
