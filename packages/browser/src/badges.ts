import { accentText } from "./themes";
import { unreadSummary, type InstanceClient } from "@haunt/core";
import { BRAND_NAME, BRAND_FAVICON, brandAsset } from "./brand";
import { getPreferences, subscribePreferences } from "./preferences";

let decodedLogo: Promise<HTMLImageElement> | undefined;
function loadLogo() {
  return (decodedLogo ??= (async () => {
    const image = new Image();
    image.src = brandAsset("logo-64.png");
    await image.decode();
    return image;
  })());
}

/** Preserve the complete owl; reserve the upper-right corner for the count. */
function drawBadge(
  logo: HTMLImageElement,
  count: number,
  unread: boolean,
  overlay = false,
) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const size = count ? 48 : unread ? 56 : 64;
  if (!overlay) ctx.drawImage(logo, 0, 64 - size, size, size);
  if (unread || count) {
    ctx.fillStyle = getPreferences().accentColor;
    ctx.beginPath();
    ctx.arc(
      overlay ? 32 : count ? 50 : 57,
      overlay ? 32 : count ? 12 : 7,
      overlay ? 30 : count ? 12 : 6,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    if (count) {
      ctx.fillStyle = accentText(getPreferences().accentColor);
      ctx.font = `bold ${overlay ? (count > 99 ? 23 : 32) : count > 99 ? 10 : 14}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        count > 99 ? "99+" : String(count),
        overlay ? 32 : 50,
        overlay ? 32 : 12,
      );
    }
  }
  return canvas.toDataURL("image/png");
}

/** Decode once, then redraw only when unread totals change. No polling. */
export function installBadges(instances: Iterable<InstanceClient>) {
  const clients = [...instances];
  let icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!icon) {
    icon = document.createElement("link");
    icon.rel = "icon";
    document.head.append(icon);
  }
  const restoreIcon = () => {
    icon!.href = BRAND_FAVICON;
    icon!.sizes.value = "32x32";
  };
  restoreIcon();
  let previous = "",
    disposed = false,
    logo: HTMLImageElement | undefined;
  const draw = (count: number, unread: boolean) => {
    if (!logo) return;
    const png = drawBadge(logo, count, unread);
    if (!png) return;
    if (unread || count) {
      icon!.href = png;
      icon!.sizes.value = "64x64";
    } else restoreIcon();
    void window.hauntDesktop
      ?.setBadge({
        count,
        unread,
        icon: png,
        overlay: drawBadge(logo, count, unread, true)!,
      })
      .catch(() => {});
  };
  const update = () => {
    if (disposed) return;
    let count = 0,
      unread = false;
    for (const client of clients) {
      if (client.snapshot.status === "signed-out") continue;
      const summary = unreadSummary(client.snapshot.readStates);
      count += summary.count;
      unread ||= summary.unread;
    }
    count = Math.min(999999, count);
    const key = `${count}:${unread}:${getPreferences().accentColor}`;
    if (key === previous) return;
    previous = key;
    document.title = `${count ? `(${count}) ` : unread ? "• " : ""}${BRAND_NAME}`;
    draw(count, unread);
  };
  const off = clients.map((c) => c.subscribe(update));
  off.push(subscribePreferences(update));
  update();
  void loadLogo()
    .then((image) => {
      if (disposed) return;
      logo = image;
      previous = "";
      update();
    })
    .catch((error) => {
      if (!disposed)
        console.error("Haunt badge artwork could not be loaded", error);
    });
  return () => {
    disposed = true;
    off.forEach((fn) => fn());
    document.title = BRAND_NAME;
    restoreIcon();
    draw(0, false);
  };
}
