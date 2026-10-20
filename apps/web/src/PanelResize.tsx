import { useRef, useState, type PointerEvent } from "react";

type Panel = "channels" | "members";
const limits = {
  channels: { min: 200, max: 360, initial: 236 },
  members: { min: 200, max: 320, initial: 220 },
};
const storageKey = "haunt-panel-widths-v1";
const bounded = (panel: Panel, value: number) =>
  Math.min(limits[panel].max, Math.max(limits[panel].min, value));

export function usePanelWidths() {
  const [widths, setWidths] = useState(() => {
    let saved: Partial<Record<Panel, number>> = {};
    try {
      saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
    } catch {
      /* Layout remains usable when storage is unavailable. */
    }
    return Object.fromEntries(
      (Object.keys(limits) as Panel[]).map((panel) => [
        panel,
        Number.isFinite(saved?.[panel])
          ? bounded(panel, saved[panel]!)
          : limits[panel].initial,
      ]),
    ) as Record<Panel, number>;
  });
  const resize = (panel: Panel, value: number) => {
    setWidths((previous) => {
      const next = { ...previous, [panel]: bounded(panel, value) };
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* Session resizing still works. */
      }
      return next;
    });
  };
  return { widths, resize };
}

export function PanelResize({
  panel,
  width,
  onResize,
}: {
  panel: Panel;
  width: number;
  onResize: (width: number) => void;
}) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const end = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return (
    <div
      className={`panel-resize panel-resize-${panel}`}
      role="separator"
      aria-label={`Resize ${panel} panel`}
      aria-orientation="vertical"
      aria-valuemin={limits[panel].min}
      aria-valuemax={limits[panel].max}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      title="Drag or use arrow keys to resize. Double-click to reset."
      onDoubleClick={() => onResize(limits[panel].initial)}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width };
      }}
      onPointerMove={(event) => {
        if (drag.current)
          onResize(
            drag.current.width +
              (event.clientX - drag.current.x) *
                (panel === "channels" ? 1 : -1),
          );
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      onKeyDown={(event) => {
        if (event.key === "Home") onResize(limits[panel].min);
        else if (event.key === "End") onResize(limits[panel].max);
        else if (event.key === "ArrowLeft" || event.key === "ArrowRight")
          onResize(
            width +
              (event.key === "ArrowRight" ? 16 : -16) *
                (panel === "channels" ? 1 : -1),
          );
        else return;
        event.preventDefault();
      }}
    />
  );
}
