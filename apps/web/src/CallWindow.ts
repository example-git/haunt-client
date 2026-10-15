import { useEffect, useRef, useState } from "react";

/** Only the view moves. The original renderer continues to own call/media state. */
export function useCallWindow() {
  const [destination, setDestination] = useState<HTMLElement>();
  const child = useRef<Window | undefined>(undefined);
  const observer = useRef<MutationObserver | undefined>(undefined);
  const reset = () => {
    observer.current?.disconnect();
    observer.current = undefined;
    child.current = undefined;
    setDestination(undefined);
  };
  useEffect(() => {
    const off = window.hauntDesktop?.onCallWindowClosed(reset);
    return () => {
      off?.();
      observer.current?.disconnect();
      child.current?.close();
      child.current = undefined;
    };
  }, []);
  const open = async () => {
    if (!window.hauntDesktop) return;
    if (child.current && !child.current.closed) {
      await window.hauntDesktop.windowControl("focus", "call");
      return;
    }
    const popup = window.open(
      new URL("/call-window.html", location.href),
      "haunt-call",
      "width=960,height=640",
    );
    if (!popup) throw Error("The call window could not be opened.");
    child.current = popup;
    try {
      // window.open initially exposes about:blank while the local document loads.
      for (let attempt = 0; attempt < 100; attempt++) {
        if (popup.closed || child.current !== popup) return;
        if (
          popup.location.pathname === "/call-window.html" &&
          popup.document.readyState === "complete"
        ) {
          for (const style of document.querySelectorAll(
            'link[rel="stylesheet"], style',
          ))
            popup.document.head.append(style.cloneNode(true));
          popup.document.body.className = "call-window";
          const syncTheme = () => {
            popup.document.documentElement.style.cssText =
              document.documentElement.style.cssText;
          };
          syncTheme();
          observer.current = new MutationObserver(syncTheme);
          observer.current.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["style"],
          });
          setDestination(popup.document.getElementById("call-root")!);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw Error("The call window did not finish opening.");
    } catch (error) {
      popup.close();
      reset();
      throw error;
    }
  };
  const close = () => {
    child.current?.close();
    reset();
  };
  return { destination, open, close };
}
