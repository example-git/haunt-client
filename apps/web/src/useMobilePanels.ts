import { useEffect, useRef, useState } from "react";

type Panel = "navigation" | "members";

export function useMobilePanels({
  navigationOpen,
  setNavigationOpen,
  membersAvailable,
}: {
  navigationOpen: boolean;
  setNavigationOpen: (open: boolean) => void;
  membersAvailable: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [mobile, setMobile] = useState(
    () => matchMedia("(max-width: 720px)").matches,
  );
  const [membersOpen, setMembers] = useState(false);
  const [dragging, setDragging] = useState<Panel>();
  const current = useRef({ navigationOpen, membersOpen, membersAvailable });
  current.current = { navigationOpen, membersOpen, membersAvailable };
  const setMembersOpen = (open: boolean) => {
    setMembers(open);
    if (open) setNavigationOpen(false);
  };
  useEffect(() => {
    if (navigationOpen || !membersAvailable) setMembers(false);
  }, [navigationOpen, membersAvailable]);
  useEffect(() => {
    const query = matchMedia("(max-width: 720px)");
    const changed = () => {
      setMobile(query.matches);
      setMembers(false);
      setNavigationOpen(false);
    };
    query.addEventListener("change", changed);
    return () => query.removeEventListener("change", changed);
  }, [setNavigationOpen]);
  useEffect(() => {
    const element = root.current;
    if (!mobile || !element) return;
    let gesture:
      | {
          panel: Panel;
          id: number;
          x: number;
          y: number;
          open: boolean;
          progress: number;
          moving: boolean;
        }
      | undefined;
    let suppressClick = false;
    const reset = () => {
      gesture = undefined;
      delete element.dataset.mobileDrag;
      element.style.removeProperty("--drawer-progress");
      setDragging(undefined);
    };
    const start = (event: TouchEvent) => {
      suppressClick = false;
      if (event.touches.length !== 1) return reset();
      const target = event.target;
      if (
        !(target instanceof Element) ||
        target.closest(
          'dialog, [role="menu"], input, textarea, select, [contenteditable="true"]',
        )
      )
        return;
      const touch = event.touches[0];
      const state = current.current;
      const panel: Panel | undefined = state.navigationOpen
        ? "navigation"
        : state.membersOpen
          ? "members"
          : touch.clientX <= 28
            ? "navigation"
            : state.membersAvailable && touch.clientX >= window.innerWidth - 28
              ? "members"
              : undefined;
      if (!panel) return;
      const open =
        panel === "navigation" ? state.navigationOpen : state.membersOpen;
      gesture = {
        panel,
        id: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
        open,
        progress: open ? 1 : 0,
        moving: false,
      };
    };
    const move = (event: TouchEvent) => {
      if (!gesture) return;
      if (event.touches.length !== 1) return reset();
      const touch = [...event.touches].find(
        (item) => item.identifier === gesture!.id,
      );
      if (!touch) return reset();
      const dx = touch.clientX - gesture.x;
      const dy = touch.clientY - gesture.y;
      if (!gesture.moving) {
        if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) return reset();
        if (Math.abs(dx) < 8 || Math.abs(dx) <= Math.abs(dy)) return;
        gesture.moving = true;
        element.dataset.mobileDrag = gesture.panel;
        setDragging(gesture.panel);
      }
      event.preventDefault();
      const width =
        gesture.panel === "members"
          ? element.querySelector<HTMLElement>(".member-panel")?.offsetWidth
          : (element.querySelector<HTMLElement>(".server-rail")?.offsetWidth ??
              0) +
            (element.querySelector<HTMLElement>(".sidebar")?.offsetWidth ?? 0);
      if (!width) return reset();
      gesture.progress = Math.max(
        0,
        Math.min(
          1,
          Number(gesture.open) +
            (gesture.panel === "navigation" ? dx : -dx) / width,
        ),
      );
      element.style.setProperty("--drawer-progress", String(gesture.progress));
    };
    const end = (event: TouchEvent) => {
      if (gesture?.moving) {
        event.preventDefault();
        suppressClick = true;
        const open = gesture.progress >= 0.5;
        if (gesture.panel === "navigation") setNavigationOpen(open);
        else {
          setMembers(open);
          if (open) setNavigationOpen(false);
        }
      }
      reset();
    };
    const click = (event: MouseEvent) => {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    };
    element.addEventListener("touchstart", start, { passive: true });
    element.addEventListener("touchmove", move, { passive: false });
    element.addEventListener("touchend", end, { passive: false });
    element.addEventListener("touchcancel", reset);
    element.addEventListener("click", click, true);
    return () => {
      element.removeEventListener("touchstart", start);
      element.removeEventListener("touchmove", move);
      element.removeEventListener("touchend", end);
      element.removeEventListener("touchcancel", reset);
      element.removeEventListener("click", click, true);
      reset();
    };
  }, [mobile, setNavigationOpen]);
  return { root, mobile, membersOpen, setMembersOpen, dragging };
}
