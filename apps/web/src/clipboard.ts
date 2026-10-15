export async function copyText(text: string) {
  if (navigator.clipboard) return navigator.clipboard.writeText(text);
  // LAN HTTP clients do not expose the asynchronous clipboard API.
  const previous = document.activeElement as HTMLElement | null;
  const field = document.createElement("textarea");
  field.value = text;
  field.style.cssText = "position:fixed;left:-9999px;top:0";
  (document.querySelector("dialog[open]") ?? document.body).append(field);
  field.select();
  try {
    if (!document.execCommand("copy"))
      throw Error("Clipboard access is unavailable.");
  } finally {
    field.remove();
    previous?.focus({ preventScroll: true });
  }
}
