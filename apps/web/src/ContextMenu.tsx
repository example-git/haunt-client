import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type MouseEvent,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
type Trigger = MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>;
type Open = (event: Trigger, title: string, content: ReactNode) => void;
const Context = createContext<{ open: Open; close: () => void }>({
  open: () => {},
  close: () => {},
});
export function useContextMenu() {
  const { open } = useContext(Context);
  return (title: string, content: ReactNode) => ({
    onContextMenu: (e: MouseEvent<HTMLElement>) => open(e, title, content),
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))
        open(e, title, content);
    },
  });
}
export function MenuAction({
  children,
  onClick,
  danger = false,
  disabled = false,
}: {
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  const { close } = useContext(Context);
  return (
    <button
      role="menuitem"
      disabled={disabled}
      className={danger ? "danger-text" : undefined}
      onClick={() => {
        close();
        onClick();
      }}
    >
      {children}
    </button>
  );
}
export function ContextMenus({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<{
    title: string;
    content: ReactNode;
    x: number;
    y: number;
    origin: HTMLElement;
  }>();
  const ref = useRef<HTMLDivElement>(null);
  const origin = useRef<HTMLElement>(null);
  const close = useCallback(() => {
    setMenu(undefined);
    if (origin.current?.isConnected)
      origin.current.focus({ preventScroll: true });
  }, []);
  const open: Open = useCallback((e, title, content) => {
    if (e.defaultPrevented) return;
    e.preventDefault();
    e.stopPropagation();
    const bounds = e.currentTarget.getBoundingClientRect();
    origin.current = e.currentTarget;
    const pointer = "clientX" in e && (e.clientX !== 0 || e.clientY !== 0);
    setMenu({
      title,
      content,
      origin: e.currentTarget,
      x: pointer ? (e as MouseEvent).clientX : bounds.left,
      y: pointer ? (e as MouseEvent).clientY : bounds.bottom,
    });
  }, []);
  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const node = ref.current;
    const owner = node.ownerDocument;
    const view = owner.defaultView!;
    node.showPopover?.();
    const position = () => {
      const bounds = node.getBoundingClientRect();
      node.style.left = `${Math.max(8, Math.min(menu.x, view.innerWidth - bounds.width - 8))}px`;
      node.style.top = `${Math.max(8, Math.min(menu.y, view.innerHeight - bounds.height - 8))}px`;
    };
    position();
    const resize = new ResizeObserver(position);
    resize.observe(node);
    node
      .querySelector<HTMLElement>("button, input")
      ?.focus({ preventScroll: true });
    const outside = (e: Event) => {
      if (!node.contains(e.target as Node)) setMenu(undefined);
    };
    const scrolled = (e: Event) => {
      if (
        e.target instanceof Element &&
        e.target.contains(menu.origin) &&
        !node.contains(e.target)
      )
        setMenu(undefined);
    };
    const dismiss = () => setMenu(undefined);
    const keyboard = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    owner.addEventListener("pointerdown", outside);
    owner.addEventListener("keydown", keyboard, true);
    view.addEventListener("scroll", scrolled, true);
    view.addEventListener("resize", dismiss);
    view.addEventListener("blur", dismiss);
    view.addEventListener("pagehide", dismiss);
    return () => {
      resize.disconnect();
      node.hidePopover?.();
      owner.removeEventListener("pointerdown", outside);
      owner.removeEventListener("keydown", keyboard, true);
      view.removeEventListener("scroll", scrolled, true);
      view.removeEventListener("resize", dismiss);
      view.removeEventListener("blur", dismiss);
      view.removeEventListener("pagehide", dismiss);
    };
  }, [menu, close]);
  return (
    <Context.Provider value={{ open, close }}>
      {children}
      {menu &&
        createPortal(
          <div
            ref={ref}
            popover="manual"
            className="context-menu channel-menu"
            role="menu"
            aria-label={menu.title}
            onContextMenu={(e) => e.preventDefault()}
            onKeyDown={(e) => {
              if (
                (e.target as HTMLElement).tagName === "INPUT" &&
                e.key !== "Tab"
              )
                return;
              const items = Array.from(
                e.currentTarget.querySelectorAll<HTMLElement>(
                  "button:not(:disabled), input:not(:disabled)",
                ),
              );
              const current = items.indexOf(
                e.currentTarget.ownerDocument.activeElement as HTMLElement,
              );
              const next =
                e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)
                  ? (current + 1) % items.length
                  : e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)
                    ? (current + items.length - 1) % items.length
                    : e.key === "Home"
                      ? 0
                      : e.key === "End"
                        ? items.length - 1
                        : -1;
              if (next >= 0) {
                e.preventDefault();
                items[next]?.focus();
              }
            }}
          >
            <div className="context-menu-title">{menu.title}</div>
            {menu.content}
          </div>,
          menu.origin.ownerDocument.body,
        )}
    </Context.Provider>
  );
}
