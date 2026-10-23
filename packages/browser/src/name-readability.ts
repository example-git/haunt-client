import { contrast } from "./themes";

export type NameTreatment = {
  kind: "plain" | "outline" | "backing";
  edge: string;
};
export function nameTreatment(
  color: string,
  surfaces?: readonly string[],
): NameTreatment {
  const edges = ["#000000", "#ffffff"];
  const backing = edges.reduce((best, edge) =>
    contrast(color, edge) > contrast(color, best) ? edge : best,
  );
  if (!surfaces?.length) return { kind: "backing", edge: backing };
  if (surfaces.every((surface) => contrast(color, surface) >= 4.5))
    return { kind: "plain", edge: backing };
  const score = (edge: string) =>
    Math.min(
      contrast(edge, color),
      ...surfaces.map((surface) => contrast(edge, surface)),
    );
  const edge = edges.reduce((best, candidate) =>
    score(candidate) > score(best) ? candidate : best,
  );
  return score(edge) >= 4.5
    ? { kind: "outline", edge }
    : { kind: "backing", edge: backing };
}

const colors = new Map<string, string | undefined>();
let canvas: CanvasRenderingContext2D | null | undefined;
function solidColor(value: string): string | undefined {
  if (colors.has(value)) return colors.get(value);
  canvas ??= document
    .createElement("canvas")
    .getContext("2d", { willReadFrequently: true });
  if (!canvas || !CSS.supports("color", value)) return;
  canvas.clearRect(0, 0, 1, 1);
  canvas.fillStyle = value;
  canvas.fillRect(0, 0, 1, 1);
  const rgba = canvas.getImageData(0, 0, 1, 1).data;
  const color =
    rgba[3] === 255
      ? "#" +
        [...rgba.slice(0, 3)]
          .map((v) => v.toString(16).padStart(2, "0"))
          .join("")
      : undefined;
  if (colors.size > 512) colors.clear();
  colors.set(value, color);
  return color;
}
function surfaces(element: HTMLElement): string[] | undefined {
  if (element.closest(".call-tile, .profile-banner, .server-banner")) return;
  const result = new Set<string>();
  let solid = false;
  for (
    let parent = element.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    const style = getComputedStyle(parent);
    if (
      Number(style.opacity) < 1 ||
      style.mixBlendMode !== "normal" ||
      style.filter !== "none"
    )
      return;
    if (solid) continue;
    if (style.backgroundImage !== "none") return;
    const background = solidColor(style.backgroundColor);
    if (
      !background &&
      !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(style.backgroundColor)
    )
      return;
    if (
      parent.matches(
        '.message, .member-row, .settings-list-row, .dm-entry, .dm-home-entry, .mention-picker button, .dm-people-results [role="option"]',
      )
    ) {
      for (const key of ["--haunt-raised", "--haunt-hover"]) {
        const hover = solidColor(style.getPropertyValue(key).trim());
        if (!hover) return;
        result.add(hover);
      }
    }
    if (background) {
      result.add(background);
      solid = true;
    }
  }
  return solid ? [...result] : undefined;
}
const names = new Map<HTMLElement, string>();
const windows = new Map<Window, { count: number; update: () => void }>();
function apply(element: HTMLElement, color: string) {
  const treatment = nameTreatment(color, surfaces(element));
  element.dataset.nameTreatment = treatment.kind;
  element.style.setProperty("--name-color", color);
  element.style.setProperty("--name-edge", treatment.edge);
}
export function observeName(element: HTMLElement, color: string) {
  names.set(element, color);
  const view = element.ownerDocument.defaultView!;
  let listener = windows.get(view);
  if (!listener) {
    listener = {
      count: 0,
      update: () => {
        for (const [node, fill] of names)
          if (node.ownerDocument.defaultView === view) apply(node, fill);
      },
    };
    windows.set(view, listener);
    view.addEventListener("haunt:palette", listener.update);
  }
  listener.count++;
  apply(element, color);
  const root = element.closest(
    "button, .message, .member-row, .dm-entry, .dm-home-entry",
  );
  const update = () => apply(element, color);
  for (const event of ["pointerenter", "focusin", "pointerleave", "focusout"])
    root?.addEventListener(event, update);
  return () => {
    names.delete(element);
    if (--listener.count === 0) {
      view.removeEventListener("haunt:palette", listener.update);
      windows.delete(view);
    }
    for (const event of ["pointerenter", "focusin", "pointerleave", "focusout"])
      root?.removeEventListener(event, update);
  };
}
