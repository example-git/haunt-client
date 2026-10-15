import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/** One stack, outside clipped panels and inside the active modal's focus boundary. */
export function ToastStack({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<Element>(document.body);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const choose = () => {
      const dialogs = [...document.querySelectorAll("dialog[open]")];
      const focused = document.activeElement?.closest("dialog[open]");
      setTarget(focused ?? dialogs.at(-1) ?? document.body);
    };
    const observer = new MutationObserver(choose);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    document.addEventListener("focusin", choose);
    choose();
    return () => {
      observer.disconnect();
      document.removeEventListener("focusin", choose);
    };
  }, []);
  useLayoutEffect(() => {
    const node = ref.current;
    node?.showPopover?.();
    return () => node?.hidePopover?.();
  }, [target]);
  return createPortal(
    <div
      ref={ref}
      className="toast-stack"
      popover="manual"
      aria-label="App notices"
    >
      {children}
    </div>,
    target,
  );
}
