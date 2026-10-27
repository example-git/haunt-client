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
  focus?: string;
  children: (message: Message, index: number, items: Message[]) => ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const heights = useRef(new Map<string, number>());
  const previous = useRef<{ ids: string[]; offsets: number[] }>({
    ids: [],
    offsets: [],
  });
  const [viewport, setViewport] = useState({ top: Infinity, height: 800 });
  const [, measure] = useState(0);
  const offsets = [0];
  for (const item of items)
    offsets.push(offsets.at(-1)! + (heights.current.get(item.id) ?? 100));
  const total = offsets.at(-1)!;
  let top = Number.isFinite(viewport.top)
    ? viewport.top
    : Math.max(0, total - viewport.height);
  const focusIndex = focus ? items.findIndex((item) => item.id === focus) : -1;
  if (focusIndex >= 0)
    top = Math.max(0, offsets[focusIndex] - viewport.height / 2);
  let start = 0;
  while (start < items.length && offsets[start + 1] < top - 600) start++;
  let end = start;
  while (end < items.length && offsets[end] < top + viewport.height + 600)
    end++;

  useLayoutEffect(() => {
    const container = root.current,
      node = scroll.current ?? container?.parentElement;
    if (!node || !container) return;
    const update = () =>
      setViewport({
        top:
          node.scrollTop -
          (container.getBoundingClientRect().top -
            node.getBoundingClientRect().top +
            node.scrollTop),
        height: node.clientHeight,
      });
    node.addEventListener("scroll", update, { passive: true });
    const resize = new ResizeObserver(update);
    resize.observe(node);
    update();
    return () => {
      node.removeEventListener("scroll", update);
      resize.disconnect();
    };
  }, [scroll]);

  useLayoutEffect(() => {
    const container = root.current,
      node = scroll.current ?? container?.parentElement;
    if (!focus || focusIndex < 0 || !container || !node) return;
    const target = [
      ...container.querySelectorAll<HTMLElement>("[data-message-row]"),
    ].find((element) => element.dataset.messageRow === focus);
    if (!target) return;
    target.scrollIntoView({ block: "center", behavior: "instant" });
    setViewport({
      top:
        node.getBoundingClientRect().top -
        container.getBoundingClientRect().top,
      height: node.clientHeight,
    });
  }, [focus, focusIndex, offsets[focusIndex], items, scroll]);

  useLayoutEffect(() => {
    const node = scroll.current ?? root.current?.parentElement;
    const old = previous.current;
    if (
      node &&
      !focus &&
      !following.current &&
      old.ids.length &&
      items.length
    ) {
      const anchor = old.ids.findIndex(
        (id, index) =>
          old.offsets[index + 1] >= viewport.top &&
          items.some((item) => item.id === id),
      );
      if (anchor >= 0) {
        const next = items.findIndex((item) => item.id === old.ids[anchor]);
        const delta = offsets[next] - old.offsets[anchor];
        if (delta && old.ids[0] !== items[0].id) {
          node.scrollTop += delta;
          setViewport((value) => ({ ...value, top: value.top + delta }));
        }
      }
    }
    if (heights.current.size > 2000) {
      const ids = new Set(items.map((item) => item.id));
      for (const id of heights.current.keys())
        if (!ids.has(id)) heights.current.delete(id);
    }
    previous.current = { ids: items.map((item) => item.id), offsets };
  }, [items]);

  useLayoutEffect(() => {
    const container = root.current,
      node = scroll.current ?? container?.parentElement;
    if (!container || !node) return;
    const observer = new ResizeObserver((entries) => {
      let changed = false,
        shift = 0;
      for (const entry of entries) {
        const element = entry.target as HTMLElement;
        const id = element.dataset.messageRow!;
        const height = element.getBoundingClientRect().height;
        const old = heights.current.get(id) ?? 100;
        if (height > 0 && Math.abs(height - old) > 0.5) {
          const index = items.findIndex((item) => item.id === id);
          if (index >= 0 && offsets[index + 1] < viewport.top)
            shift += height - old;
          heights.current.set(id, height);
          changed = true;
        }
      }
      if (changed) {
        if (!following.current && shift) node.scrollTop += shift;
        measure((value) => value + 1);
      }
    });
    for (const child of container.querySelectorAll("[data-message-row]"))
      observer.observe(child);
    return () => observer.disconnect();
  }, [items, start, end]);

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
          style={{ display: "flow-root" }}
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
