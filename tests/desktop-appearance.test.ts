import { expect, it, vi } from "vitest";
import { createRequire } from "node:module";
const { validAppearance, windowOptions, applyWindow } = createRequire(
  import.meta.url,
)("../apps/desktop/appearance.cjs");
const base = { mode: "material", background: "#161616", dark: true };
it("uses native material only on supported platforms and requests a restart for immutable transparency changes", () => {
  expect(windowOptions(base, "win32", "10.0.22621")).toMatchObject({
    transparent: false,
    backgroundMaterial: "mica",
  });
  expect(windowOptions(base, "win32", "10.0.19045")).toMatchObject({
    transparent: false,
    backgroundMaterial: "none",
    backgroundColor: "#161616",
  });
  expect(windowOptions(base, "darwin")).toMatchObject({
    transparent: true,
    vibrancy: "under-window",
  });
  expect(windowOptions(base, "linux")).toMatchObject({
    transparent: false,
    backgroundColor: "#161616",
  });
  const win = {
    setVibrancy: vi.fn(),
    setBackgroundMaterial: vi.fn(),
    setBackgroundColor: vi.fn(),
  };
  expect(
    applyWindow(
      win,
      { ...base, mode: "transparent" },
      false,
      "win32",
      "10.0.22621",
    ),
  ).toMatchObject({ restart: true });
  expect(win.setBackgroundColor).not.toHaveBeenCalled();
  expect(applyWindow(win, base, false, "win32", "10.0.22621")).toMatchObject({
    effect: "material",
    restart: false,
  });
  expect(win.setBackgroundMaterial).toHaveBeenCalledWith("mica");
  expect(
    applyWindow(win, { ...base, mode: "solid" }, false, "win32", "10.0.22621"),
  ).toMatchObject({ effect: "solid" });
  expect(win.setBackgroundMaterial).toHaveBeenLastCalledWith("none");
});
it("rejects untrusted appearance values without forwarding arbitrary window options", () => {
  for (const value of [
    null,
    { ...base, mode: "execute" },
    { ...base, background: "url(file:///secret)" },
    { ...base, dark: "yes" },
  ])
    expect(() => validAppearance(value)).toThrow();
  expect(
    validAppearance({ ...base, background: "#ABCDEF", webPreferences: {} }),
  ).toEqual({ ...base, background: "#abcdef" });
});

it("stages every local dependency used by desktop runtime modules", async () => {
  const fs = await import("node:fs/promises");
  // @ts-expect-error Build helper intentionally uses plain JavaScript.
  const { desktopFiles } = await import("../scripts/desktop-files.mjs");
  expect(desktopFiles).toContain("appearance.cjs");
  for (const name of desktopFiles.filter((n: string) => n.endsWith(".cjs"))) {
    const source = await fs.readFile(
      new URL(`../apps/desktop/${name}`, import.meta.url),
      "utf8",
    );
    for (const match of source.matchAll(/require\(["']\.\/([^"']+)["']\)/g)) {
      expect(desktopFiles, `${name} requires ${match[1]}`).toContain(match[1]);
    }
  }
});
