import { unwrap, type InstanceClient, type Schemas } from "@haunt/core";
export type DMUsage = Schemas["AttachmentsDMUsage"];
class UsageMonitor {
  private value?: DMUsage;
  private listeners = new Set<() => void>();
  private pending?: Promise<void>;
  private timer?: ReturnType<typeof setInterval>;
  constructor(private instance: InstanceClient) {}
  getSnapshot = () => this.value;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    if (this.listeners.size === 1) {
      void this.refresh().catch(() => {});
      this.timer = setInterval(
        () => void this.refresh().catch(() => {}),
        60000,
      );
      window.addEventListener("haunt:dm-storage", this.changed);
    }
    return () => {
      this.listeners.delete(fn);
      if (!this.listeners.size) {
        clearInterval(this.timer);
        window.removeEventListener("haunt:dm-storage", this.changed);
      }
    };
  };
  private changed = (event: Event) => {
    if ((event as CustomEvent).detail === this.instance.scope)
      void this.refresh().catch(() => {});
  };
  refresh = () =>
    (this.pending ??= (async () => {
      if (
        !this.instance.account.instance.capabilities?.includes("dms.storage.v1")
      )
        return;
      const value = await unwrap(
        this.instance.http.GET("/api/v1/me/dm-storage"),
      );
      this.value = value;
      this.listeners.forEach((fn) => fn());
    })().finally(() => {
      this.pending = undefined;
    }));
}
const monitors = new WeakMap<InstanceClient, UsageMonitor>();
export function dmUsage(instance: InstanceClient) {
  let monitor = monitors.get(instance);
  if (!monitor) {
    monitor = new UsageMonitor(instance);
    monitors.set(instance, monitor);
  }
  return monitor;
}
export function dmStorageChanged(instance: InstanceClient) {
  window.dispatchEvent(
    new CustomEvent("haunt:dm-storage", { detail: instance.scope }),
  );
}
export const storageSize = (bytes: number) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(2)} GiB`
    : `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
