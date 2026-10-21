import { afterEach, expect, it, vi } from "vitest";
import {
  desktopClient,
  multiServerClient,
} from "../packages/browser/src/client-context";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("restricts a normal hosted client even when a native-looking bridge is present", () => {
  vi.stubEnv("MODE", "production");
  vi.stubGlobal("window", { hauntDesktop: {} });
  vi.stubGlobal("location", { origin: "https://community.example.test" });
  expect(desktopClient()).toBe(false);
  expect(multiServerClient()).toBe(false);
});

it("enables multi-server web builds without enabling native desktop capabilities", () => {
  vi.stubEnv("MODE", "standalone");
  vi.stubGlobal("window", {});
  vi.stubGlobal("location", { origin: "https://client.example.test" });
  expect(multiServerClient()).toBe(true);
  expect(desktopClient()).toBe(false);
});

it("retains the trusted desktop mode", () => {
  vi.stubEnv("MODE", "production");
  vi.stubGlobal("window", { hauntDesktop: {} });
  vi.stubGlobal("location", { origin: "https://app.chatxo.local" });
  expect(desktopClient()).toBe(true);
  expect(multiServerClient()).toBe(true);
});
