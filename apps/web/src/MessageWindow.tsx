import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { Message } from "@haunt/core";

export function MessageWindow({
  items,
  scroll,
  following,
  focus,
  atLatest,
  onFollowingChange,
  children,
}: {
  items: Message[];
  scroll: RefObject<HTMLDivElement | null>;
  following: RefObject<boolean>;
  focus?: { id: string } | { latest: true };
  atLatest: boolean;
  onFollowingChange: (following: boolean) => void;
  children: (message: Message, index: number, items: Message[]) => ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const heights = useRef(new Map<string, number>());
  const anchor = useRef<{ id: string; top: number } | undefined>(undefined);
  const focused = useRef<typeof focus>(undefined);
  const pinned = useRef<string | undefined>(undefined);
  const edge = useRef<"start" | "end" | undefined>(undefined);
  const current = useRef({ atLatest, onFollowingChange });
  current.current = { atLatest, onFollowingChange };
  const scrollPosition = useRef(0);
  const width = useRef(0);
  const layout = useRef<{ ids: string[] } | undefined>(undefined);
  const [viewport, setViewport] = useState({ top: Infinity, height: 800 });
  const [, measure] = useState(0);
  const offsets = [0];
  for (const item of items)
    offsets.push(offsets.at(-1)! + (heights.current.get(item.id) ?? 100));
  const total = offsets.at(-1)!;
  const prepended =
    !!layout.current?.ids.length &&
    layout.current.ids[0] !== items[0]?.id &&
    items.some((item) => item.id === layout.current!.ids[0]);
  if (prepended && !following.current) pinned.current = anchor.current?.id;
  const anchorIndex = items.findIndex((item) => item.id === anchor.current?.id);
  const focusIndex =
    focus && "id" in focus && focus !== focused.current
      ? items.findIndex((item) => item.id === focus.id)
      : -1;
  if (focusIndex >= 0 && focus && "id" in focus) pinned.current = focus.id;
  else if (following.current) pinned.current = undefined;
  let top =
    following.current || !Number.isFinite(viewport.top)
      ? Math.max(0, total - viewport.height)
      : anchorIndex >= 0
        ? offsets[anchorIndex] - anchor.current!.top
        : viewport.top;
  if (focusIndex >= 0)
    top = Math.max(0, offsets[focusIndex] - viewport.height / 2);
  if (edge.current === "start") top = 0;
  else if (edge.current === "end") top = Math.max(0, total - viewport.height);
  const overscan = Math.max(1200, viewport.height * 3);
  let start = 0;
  while (start < items.length && offsets[start + 1] < top - overscan) start++;
  let end = start;
  while (end < items.length && offsets[end] < top + viewport.height + overscan)
    end++;
  start = Math.max(0, start - 2);
  end = Math.min(items.length, end + 2);
  let visibleStart = start;
  while (visibleStart < items.length && offsets[visibleStart + 1] < top)
    visibleStart++;
  let visibleEnd = visibleStart;
  while (
    visibleEnd < items.length &&
    offsets[visibleEnd] < top + viewport.height
  )
    visibleEnd++;
  const extra = Math.max(4, 256 - (visibleEnd - visibleStart));
  start = Math.max(start, visibleStart - Math.floor(extra / 2));
  end = Math.min(end, visibleEnd + Math.ceil(extra / 2));

  const remember = () => {
    const container = root.current,
      node = scroll.current ?? root.current?.parentElement;
    if (!container || !node) return;
    const bounds = node.getBoundingClientRect();
    const rows = [
      ...container.querySelectorAll<HTMLElement>("[data-message-row]"),
    ];
    const row =
      rows.find((row) => row.dataset.messageRow === pinned.current) ??
      rows.find((row) => {
        const rect = row.getBoundingClientRect();
        return rect.bottom > bounds.top && rect.top < bounds.bottom;
      });
    anchor.current = row
      ? {
          id: row.dataset.messageRow!,
          top: row.getBoundingClientRect().top - bounds.top,
        }
      : undefined;
    const next = {
      top: bounds.top - container.getBoundingClientRect().top,
      height: node.clientHeight,
    };
    scrollPosition.current = node.scrollTop;
    setViewport((old) =>
      Math.abs(old.top - next.top) > next.height / 2 ||
      old.height !== next.height
        ? next
        : old,
    );
  };

  useLayoutEffect(() => {
    const node = scroll.current ?? root.current?.parentElement;
    if (!node) return;
    let frame = 0;
    let touchY = 0;
    let dragging = false;
    const follow = (value: boolean) => {
      const next =
        current.current.atLatest &&
        (value || node.scrollHeight <= node.clientHeight + 1);
      if (following.current === next) return;
      following.current = next;
      current.current.onFollowingChange(next);
    };
    const releaseAnchor = () => {
      if (!pinned.current) return;
      pinned.current = undefined;
      measure((value) => value + 1);
    };
    const update = () => {
      const maximum = Math.max(0, node.scrollHeight - node.clientHeight);
      const delta = node.scrollTop - Math.min(scrollPosition.current, maximum);
      if (delta < -1 && maximum - node.scrollTop > 1) follow(false);
      else if (delta > 1 && maximum - node.scrollTop <= 1) follow(true);
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          remember();
        });
    };
    const wheel = (event: WheelEvent) => {
      releaseAnchor();
      if (event.deltaY < 0) follow(false);
    };
    const key = (event: KeyboardEvent) => {
      if (
        (event.target as HTMLElement).closest(
          "input, textarea, [contenteditable=true]",
        )
      )
        return;
      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        releaseAnchor();
        edge.current = event.key === "Home" ? "start" : "end";
        follow(event.key === "End");
        measure((value) => value + 1);
        return;
      }
      if (
        [
          "ArrowUp",
          "ArrowDown",
          "PageUp",
          "PageDown",
          "Home",
          "End",
          " ",
        ].includes(event.key)
      )
        releaseAnchor();
      if (
        ["ArrowUp", "PageUp", "Home"].includes(event.key) ||
        (event.key === " " && event.shiftKey)
      )
        follow(false);
    };
    const touchStart = (event: TouchEvent) => {
      releaseAnchor();
      touchY = event.touches[0]?.clientY ?? 0;
    };
    const touchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY ?? touchY;
      if (y > touchY) follow(false);
      touchY = y;
    };
    const pointer = (event: PointerEvent) => {
      if (event.target === node) {
        releaseAnchor();
        if (
          event.clientX >=
          node.getBoundingClientRect().left + node.clientWidth
        ) {
          dragging = true;
          follow(false);
        }
      }
    };
    const pointerUp = () => {
      if (!dragging) return;
      dragging = false;
      if (node.scrollHeight - node.scrollTop - node.clientHeight <= 1)
        follow(true);
    };
    node.addEventListener("scroll", update, { passive: true });
    node.addEventListener("wheel", wheel, { passive: true });
    node.addEventListener("keydown", key);
    node.addEventListener("touchstart", touchStart, { passive: true });
    node.addEventListener("touchmove", touchMove, { passive: true });
    node.addEventListener("pointerdown", pointer, { passive: true });
    window.addEventListener("pointerup", pointerUp, { passive: true });
    window.addEventListener("pointercancel", pointerUp, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      node.removeEventListener("scroll", update);
      node.removeEventListener("wheel", wheel);
      node.removeEventListener("keydown", key);
      node.removeEventListener("touchstart", touchStart);
      node.removeEventListener("touchmove", touchMove);
      node.removeEventListener("pointerdown", pointer);
      window.removeEventListener("pointerup", pointerUp);
      window.removeEventListener("pointercancel", pointerUp);
    };
  }, [scroll]);

  useLayoutEffect(() => {
    const container = root.current,
      node = scroll.current ?? root.current?.parentElement;
    if (!container || !node) return;
    const rows = [
      ...container.querySelectorAll<HTMLElement>("[data-message-row]"),
    ];
    const measureRows = () => {
      if (!container.clientWidth || !node.clientHeight) return false;
      let changed = false;
      if (width.current !== container.clientWidth) {
        width.current = container.clientWidth;
        heights.current.clear();
        changed = true;
      }
      for (const row of rows) {
        const height = row.getBoundingClientRect().height;
        const id = row.dataset.messageRow!;
        if (
          height > 0 &&
          Math.abs(height - (heights.current.get(id) ?? 100)) > 0.5
        ) {
          heights.current.set(id, height);
          changed = true;
        }
      }
      if (changed) measure((value) => value + 1);
      return changed;
    };
    const restore = () => {
      const target =
        focus && "id" in focus
          ? rows.find((row) => row.dataset.messageRow === focus.id)
          : undefined;
      if (edge.current) {
        node.scrollTop = edge.current === "start" ? 0 : node.scrollHeight;
        edge.current = undefined;
        focused.current = focus;
      } else if (focus !== focused.current && target) {
        target.scrollIntoView({ block: "center", behavior: "instant" });
        focused.current = focus;
      } else if (following.current && current.current.atLatest) {
        if (node.scrollHeight - node.scrollTop - node.clientHeight > 1)
          node.scrollTop = node.scrollHeight;
        if (focus !== focused.current && focus && "latest" in focus)
          current.current.onFollowingChange(true);
        focused.current = focus;
      } else if (
        anchor.current &&
        (!CSS.supports("overflow-anchor", "auto") || prepended)
      ) {
        const row = rows.find(
          (row) => row.dataset.messageRow === anchor.current!.id,
        );
        if (row) {
          const delta =
            row.getBoundingClientRect().top -
            node.getBoundingClientRect().top -
            anchor.current.top +
            (CSS.supports("overflow-anchor", "auto")
              ? 0
              : node.scrollTop - scrollPosition.current);
          if (Math.abs(delta) > 0.5) node.scrollTop += delta;
        }
      }
      scrollPosition.current = node.scrollTop;
    };
    measureRows();
    restore();
    remember();
    layout.current = { ids: items.map((item) => item.id) };
    if (!focus) focused.current = undefined;
    const observer = new ResizeObserver(() => {
      if (measureRows()) {
        restore();
        remember();
      }
      if (node.clientHeight !== viewport.height) {
        restore();
        remember();
      }
    });
    observer.observe(container);
    observer.observe(node);
    for (const row of rows) observer.observe(row);
    if (heights.current.size > 2000) {
      const ids = new Set(items.map((item) => item.id));
      for (const id of heights.current.keys())
        if (!ids.has(id)) heights.current.delete(id);
    }
    return () => observer.disconnect();
  });

  return (
    <div ref={root}>
      <div
        aria-hidden="true"
        style={{ height: offsets[start], overflowAnchor: "none" }}
      />
      {items.slice(start, end).map((message, index) => (
        <div
          key={message.id}
          data-message-row={message.id}
          style={{
            display: "flow-root",
            overflowAnchor:
              pinned.current && pinned.current !== message.id ? "none" : "auto",
          }}
        >
          {children(message, start + index, items)}
        </div>
      ))}
      <div
        aria-hidden="true"
        style={{ height: total - offsets[end], overflowAnchor: "none" }}
      />
    </div>
  );
}
