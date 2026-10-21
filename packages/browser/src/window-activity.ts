import { reportNotificationError } from "./notification-health";

// Electron keeps document.visibilityState visible with backgroundThrottling
// disabled. Native window events therefore own desktop focus/read receipts.
const nativeFocus = new WeakMap<Document, boolean>();
const target = (owner: Document) => (owner === document ? "main" : "call");

export function windowIsActive(owner: Document = document): boolean {
  if (window.hauntDesktop) return nativeFocus.get(owner) ?? false;
  return owner.visibilityState === "visible" && owner.hasFocus();
}

export async function refreshWindowActivity(owner: Document = document) {
  const desktop = window.hauntDesktop;
  if (desktop) {
    const state = await desktop.windowState(target(owner));
    if (typeof state.focused === "boolean")
      nativeFocus.set(owner, state.focused);
    else
      nativeFocus.set(
        owner,
        owner.visibilityState === "visible" && owner.hasFocus(),
      );
  }
  return windowIsActive(owner);
}

export function subscribeWindowActivity(
  listener: () => void,
  owner: Document = document,
) {
  let live = true;
  const changed = () => {
    void refreshWindowActivity(owner)
      .then(() => {
        if (live) listener();
      })
      .catch((error) => {
        if (live)
          reportNotificationError(
            `Window focus check failed: ${error.message}`,
          );
      });
  };
  const off = window.hauntDesktop?.onWindowState((state) => {
    if (state.target !== target(owner) || typeof state.focused !== "boolean")
      return;
    nativeFocus.set(owner, state.focused);
    listener();
  });
  owner.defaultView?.addEventListener("focus", changed);
  owner.defaultView?.addEventListener("blur", changed);
  owner.addEventListener("visibilitychange", changed);
  changed();
  return () => {
    live = false;
    off?.();
    owner.defaultView?.removeEventListener("focus", changed);
    owner.defaultView?.removeEventListener("blur", changed);
    owner.removeEventListener("visibilitychange", changed);
  };
}
