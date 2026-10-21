import { expect, it } from "vitest";
import {
  newerWebBuild,
  type WebBuild,
} from "../packages/browser/src/web-cache";

const current: WebBuild = {
  version: 2,
  id: "11111111-2222-4333-8444-555555555555",
  release: "1.0.0",
  revision: 100,
};
const next = {
  ...current,
  id: "22222222-2222-4333-8444-555555555555",
  revision: 101,
};

it("updates only to a distinct higher build revision", () => {
  expect(newerWebBuild(next, current)).toBe(true);
  expect(newerWebBuild(current, current)).toBe(false);
  expect(newerWebBuild({ ...next, revision: 100 }, current)).toBe(false);
  expect(newerWebBuild({ ...next, revision: 99 }, current)).toBe(false);
  expect(newerWebBuild({ ...next, id: current.id }, current)).toBe(false);
});

it("rejects malformed update metadata instead of selecting a different source", () => {
  for (const value of [
    null,
    {},
    { ...next, version: 1 },
    { ...next, revision: "101" },
    { ...next, revision: NaN },
    { ...next, id: "https://another.example.test" },
  ])
    expect(newerWebBuild(value, current)).toBe(false);
});
