import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type KeyboardEvent,
} from "react";
export type FloatingBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};
const key = "chatxo-call-window-v1";
export function fitCallWindow(
  box: FloatingBounds,
  viewportWidth: number,
  viewportHeight: number,
  topInset = 0,
): FloatingBounds {
  const maxWidth = Math.max(1, viewportWidth - 16),
    maxHeight = Math.max(1, viewportHeight - topInset - 16);
  const width = Math.max(
    Math.min(260, maxWidth),
    Math.min(maxWidth, box.width),
  );
  const height = Math.max(
    Math.min(200, maxHeight),
    Math.min(maxHeight, box.height),
  );
  return {
    width,
    height,
    left: Math.max(8, Math.min(box.left, viewportWidth - width - 8)),
    top: Math.max(topInset + 8, Math.min(box.top, viewportHeight - height - 8)),
  };
}
const fit = (box: FloatingBounds) =>
  fitCallWindow(
    box,
    innerWidth,
    innerHeight,
    document.querySelector(".app-titlebar")?.clientHeight ?? 0,
  );
function read(): FloatingBounds {
  let box = {
    left: innerWidth - 342,
    top: innerHeight - 438,
    width: 320,
    height: 340,
  };
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "null");
    if (
      saved &&
      Object.keys(box).every(
        (k) => typeof saved[k] === "number" && Number.isFinite(saved[k]),
      )
    )
      box = saved;
  } catch {}
  return fit(box);
}
function save(box: FloatingBounds) {
  try {
    localStorage.setItem(key, JSON.stringify(box));
  } catch {}
}
export function useFloatingCall(active: boolean) {
  const [box, setBox] = useState(read);
  const current = useRef(box);
  const drag = useRef<
    | {
        mode: "move" | "resize";
        x: number;
        y: number;
        box: FloatingBounds;
        pointer: number;
        target: HTMLElement;
      }
    | undefined
  >(undefined);
  const pending = useRef<FloatingBounds | undefined>(undefined);
  const animation = useRef<number | undefined>(undefined);
  const apply = (next: FloatingBounds) => {
    current.current = next;
    setBox(next);
  };
  const flush = () => {
    if (animation.current !== undefined)
      cancelAnimationFrame(animation.current);
    animation.current = undefined;
    if (pending.current) {
      apply(pending.current);
      pending.current = undefined;
    }
  };
  const end = () => {
    flush();
    const moving = drag.current;
    drag.current = undefined;
    if (moving?.target.hasPointerCapture(moving.pointer))
      moving.target.releasePointerCapture(moving.pointer);
    save(current.current);
  };
  useEffect(() => {
    const resized = () => {
      end();
      apply(fit(current.current));
      save(current.current);
    };
    window.addEventListener("resize", resized);
    return () => {
      window.removeEventListener("resize", resized);
      if (animation.current !== undefined)
        cancelAnimationFrame(animation.current);
    };
  }, []);
  useEffect(() => {
    if (!active) end();
  }, [active]);
  const pointer = (mode: "move" | "resize") => ({
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (!active || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = {
        mode,
        x: e.clientX,
        y: e.clientY,
        box: current.current,
        pointer: e.pointerId,
        target: e.currentTarget,
      };
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const moving = drag.current;
      if (!moving || moving.pointer !== e.pointerId) return;
      const dx = e.clientX - moving.x,
        dy = e.clientY - moving.y;
      pending.current = fit(
        moving.mode === "move"
          ? {
              ...moving.box,
              left: moving.box.left + dx,
              top: moving.box.top + dy,
            }
          : {
              ...moving.box,
              width: moving.box.width + dx,
              height: moving.box.height + dy,
            },
      );
      if (animation.current === undefined)
        animation.current = requestAnimationFrame(() => {
          animation.current = undefined;
          if (pending.current) {
            apply(pending.current);
            pending.current = undefined;
          }
        });
    },
    onPointerUp: () => end(),
    onPointerCancel: () => end(),
    onLostPointerCapture: () => {
      if (drag.current) end();
    },
  });
  const keyboard =
    (mode: "move" | "resize") => (e: KeyboardEvent<HTMLElement>) => {
      if (
        !active ||
        !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
      )
        return;
      e.preventDefault();
      const step = e.shiftKey ? 40 : 10,
        dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0,
        dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      const previous = current.current;
      apply(
        fit(
          mode === "move"
            ? { ...previous, left: previous.left + dx, top: previous.top + dy }
            : {
                ...previous,
                width: previous.width + dx,
                height: previous.height + dy,
              },
        ),
      );
      save(current.current);
    };
  return {
    box,
    move: pointer("move"),
    resize: pointer("resize"),
    moveKey: keyboard("move"),
    resizeKey: keyboard("resize"),
  };
}
