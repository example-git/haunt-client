export const defaultAccent = "#ff9a3d";
function pastel(hue: number, saturation: number, lightness: number) {
  const a = saturation * Math.min(lightness, 1 - lightness);
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12;
    return Math.round(
      255 * (lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))),
    )
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}
export const pastelPalette = [
  ["Rose", 0],
  ["Peach", 20],
  ["Apricot", 40],
  ["Butter", 60],
  ["Lime", 90],
  ["Mint", 130],
  ["Seafoam", 160],
  ["Aqua", 190],
  ["Sky", 210],
  ["Periwinkle", 240],
  ["Lavender", 270],
  ["Orchid", 310],
].map(([name, hue]) => ({
  name: String(name),
  colors: Array.from({ length: 8 }, (_, shade) => ({
    name: `${name} ${shade + 1}`,
    value: pastel(
      Number(hue),
      shade < 4 ? 0.55 : 0.75,
      0.76 + (shade % 4) * 0.06,
    ),
  })),
}));
const allowed = new Set([
  defaultAccent,
  ...pastelPalette.flatMap((group) => group.colors.map((color) => color.value)),
]);
export function normalizeAccent(value: unknown) {
  const color = typeof value === "string" ? value.toLowerCase() : "";
  return allowed.has(color) ? color : defaultAccent;
}
