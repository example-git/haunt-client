import { expect, it } from "vitest";
import { nameTreatment } from "../packages/browser/src/name-readability";
import { contrast } from "../packages/browser/src/themes";

it("uses plain text only when every solid surface has enough contrast", () => {
  expect(nameTreatment("#000000", ["#ffffff", "#dddddd"]).kind).toBe("plain");
  expect(nameTreatment("#ffffff", ["#000000", "#222222"]).kind).toBe("plain");
  expect(nameTreatment("#ffffff", ["#000000", "#ffffff"]).kind).toBe("backing");
});
it("outlines matching colors only when the edge contrasts with both fill and surface", () => {
  expect(nameTreatment("#ffffff", ["#ffffff"])).toEqual({
    kind: "outline",
    edge: "#000000",
  });
  expect(nameTreatment("#000000", ["#000000"])).toEqual({
    kind: "outline",
    edge: "#ffffff",
  });
  for (const fill of ["#777777", "#aa3355", "#00ffff", "#222222"]) {
    const result = nameTreatment(fill, ["#444444", "#999999"]);
    if (result.kind === "outline")
      for (const color of [fill, "#444444", "#999999"])
        expect(contrast(color, result.edge)).toBeGreaterThanOrEqual(4.5);
    else expect(contrast(fill, result.edge)).toBeGreaterThanOrEqual(4.5);
  }
});
it("protects names on unknown, transparent and image surfaces with the better opaque backing", () => {
  expect(nameTreatment("#eeeeee")).toEqual({
    kind: "backing",
    edge: "#000000",
  });
  expect(nameTreatment("#111111")).toEqual({
    kind: "backing",
    edge: "#ffffff",
  });
});
