export const desktopClient = () =>
  !!window.hauntDesktop && location.origin === "https://app.chatxo.local";
