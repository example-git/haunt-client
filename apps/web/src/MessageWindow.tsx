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
  children,
}: {
  items: Message[];
  scroll: RefObject<HTMLDivElement | null>;
  following: RefObject<boolean>;
  focus?: { id: string };
  children: (message: Message, index: number, items: Message[]) => ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const heights = useRef(new Map<string, number>());
  const anchor = useRef<{ id: string; top: number } | undefined>(undefined);
  const focused = useRef<{ id: string } | undefined>(undefined);
  const focusAnchor = useRef<string | undefined>(undefined);
  const scrollPosition = useRef(0);
  const width = useRef(0);
  const layout = useRef<
    { ids: string[]; offsets: number[]; start: number; end: number } | undefined
  >(undefined);
  const [viewport, setViewport] = useState({ top: Infinity, height: 800 });
  const [, measure] = useState(0);
  const offsets = [0];
  for (const item of items)
    offsets.push(offsets.at(-1)! + (heights.current.get(item.id) ?? 100));
  const total = offsets.at(-1)!;
  const anchorIndex = items.findIndex((item) => item.id === anchor.current?.id);
  const focusIndex =
    focus && focus !== focused.current
      ? items.findIndex((item) => item.id === focus.id)
      : -1;
  let top =
    following.current || !Number.isFinite(viewport.top)
      ? Math.max(0, total - viewport.height)
      : anchorIndex >= 0
        ? offsets[anchorIndex] - anchor.current!.top
        : viewport.top;
  if (focusIndex >= 0)
    top = Math.max(0, offsets[focusIndex] - viewport.height / 2);
  const overscan = Math.max(800, viewport.height * 2);
  let start = 0;
  while (start < items.length && offsets[start + 1] < top - overscan) start++;
  let end = start;
  while (end < items.length && offsets[end] < top + viewport.height + overscan)
    end++;
  start = Math.max(0, start - 2);
  end = Math.min(items.length, end + 2);

  const remember = () => {
    const container = root.current,
      node = scroll.current ?? root.current?.parentElement;
    if (!container || !node) return;
    const bounds = node.getBoundingClientRect();
    const rows = [
      ...container.querySelectorAll<HTMLElement>("[data-message-row]"),
    ];
    const row =
      rows.find((row) => row.dataset.messageRow === focusAnchor.current) ??
      rows.find((row) => row.dataset.messageRow === anchor.current?.id) ??
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
      Math.abs(old.top - next.top) > 0.5 || old.height !== next.height
        ? next
        : old,
    );
  };

  useLayoutEffect(() => {
    const node = scroll.current ?? root.current?.parentElement;
    if (!node) return;
    const update = () => {
      if (
        Math.abs(
          node.scrollTop -
            Math.min(
              scrollPosition.current,
              node.scrollHeight - node.clientHeight,
            ),
        ) > 1
      ) {
        focusAnchor.current = undefined;
        anchor.current = undefined;
      }
      if (node.scrollHeight - node.scrollTop - node.clientHeight >= 120)
        following.current = false;
      remember();
    };
    node.addEventListener("scroll", update, { passive: true, capture: true });
    return () => node.removeEventListener("scroll", update, true);
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
      const target = rows.find((row) => row.dataset.messageRow === focus?.id);
      if (focusIndex >= 0 && target) {
        target.scrollIntoView({ block: "center", behavior: "instant" });
        focused.current = focus;
        focusAnchor.current = focus!.id;
        anchor.current = {
          id: focus!.id,
          top:
            target.getBoundingClientRect().top -
            node.getBoundingClientRect().top,
        };
      } else if (following.current) {
        node.scrollTop = node.scrollHeight;
      } else if (anchor.current) {
        const row = rows.find(
          (row) => row.dataset.messageRow === anchor.current!.id,
        );
        if (row)
          node.scrollTop +=
            row.getBoundingClientRect().top -
            node.getBoundingClientRect().top -
            anchor.current.top;
      }
      scrollPosition.current = node.scrollTop;
    };
    if (!measureRows()) {
      const old = layout.current;
      if (
        focusIndex >= 0 ||
        following.current ||
        !old ||
        old.start !== start ||
        old.end !== end ||
        items.length !== old.ids.length ||
        items.some(
          (item, index) =>
            item.id !== old.ids[index] || offsets[index] !== old.offsets[index],
        ) ||
        total !== old.offsets.at(-1)
      )
        restore();
      remember();
      layout.current = {
        ids: items.map((item) => item.id),
        offsets,
        start,
        end,
      };
    }
    if (!focus) focused.current = undefined;
    const observer = new ResizeObserver(() => {
      if (measureRows()) restore();
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
    <div ref={root} style={{ overflowAnchor: "none" }}>
      <div aria-hidden="true" style={{ height: offsets[start] }} />
      {items.slice(start, end).map((message, index) => (
        <div
          key={message.id}
          data-message-row={message.id}
          style={{ display: "flow-root" }}
        >
          {children(message, start + index, items)}
        </div>
      ))}
      <div aria-hidden="true" style={{ height: total - offsets[end] }} />
    </div>
  );
}
