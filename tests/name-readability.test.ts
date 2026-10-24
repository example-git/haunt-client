import { expect, it } from "vitest";
import { nameTreatment } from "../packages/browser/src/name-readability";
import { contrast } from "../packages/browser/src/themes";

it("uses plain text only when every solid surface has enough contrast", () => {
  expect(nameTreatment("#000000", ["#ffffff", "#dddddd"]).kind).toBe("plain");
  expect(nameTreatment("#ffffff", ["#000000", "#222222"]).kind).toBe("plain");
  expect(nameTreatment("#ffffff", ["#000000", "#ffffff"]).kind).toBe("outline");
});
it("uses a contrasting outline when the surfaces cannot all support the fill", () => {
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
    expect(result.kind).toBe("outline");
    expect(contrast(fill, result.edge)).toBeGreaterThanOrEqual(4.5);
  }
});
it("outlines names on unknown, transparent and image surfaces against their fill", () => {
  expect(nameTreatment("#eeeeee")).toEqual({
    kind: "outline",
    edge: "#000000",
  });
  expect(nameTreatment("#111111")).toEqual({
    kind: "outline",
    edge: "#ffffff",
  });
});
