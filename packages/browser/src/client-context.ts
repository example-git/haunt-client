export const desktopClient = () =>
  !!window.hauntDesktop && location.origin === "https://app.chatxo.local";

export const multiServerClient = () =>
  import.meta.env.MODE === "standalone" || desktopClient();
