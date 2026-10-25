import manifestSource from "../public/brand/site.webmanifest?raw";

export function installMobileWeb() {
  const root = document.documentElement;
  const theme = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );
  const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  const manifest = JSON.parse(manifestSource);
  const base = link?.href;
  if (base) {
    for (const key of ["id", "start_url", "scope"])
      manifest[key] = new URL(manifest[key], base).href;
    manifest.icons = manifest.icons.map((icon: { src: string }) => ({
      ...icon,
      src: new URL(icon.src, base).href,
    }));
  }
  let color = "";
  let manifestURL = "";
  const apply = () => {
    const next = root.style.getPropertyValue("--chrome-fill");
    if (!next || next === color) return;
    color = next;
    if (theme) theme.content = color;
    if (link && import.meta.env.MODE === "standalone") {
      const previous = manifestURL;
      manifestURL = URL.createObjectURL(
        new Blob(
          [
            JSON.stringify({
              ...manifest,
              theme_color: color,
              background_color: color,
            }),
          ],
          { type: "application/manifest+json" },
        ),
      );
      link.href = manifestURL;
      if (previous) URL.revokeObjectURL(previous);
    }
  };
  apply();
  window.addEventListener("haunt:palette", apply);
  const preventGesture = (event: Event) => event.preventDefault();
  document.addEventListener("gesturestart", preventGesture, { passive: false });
  document.addEventListener("gesturechange", preventGesture, {
    passive: false,
  });
  document.addEventListener(
    "touchmove",
    (event) => {
      if (event.touches.length > 1) event.preventDefault();
    },
    { passive: false },
  );
  document.addEventListener(
    "wheel",
    (event) => {
      if (event.ctrlKey) event.preventDefault();
    },
    { passive: false },
  );
}
