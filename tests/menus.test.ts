import { describe, it, expect } from "vitest";
import {
  menuAPIPath,
  validateMenu,
  menuFormBody,
  requestMenuJSON,
  type MenuForm,
} from "../packages/core/src/menus";
const form: MenuForm = {
  load_path: "/api/v1/future/settings",
  save_path: "/api/v1/future/settings",
  method: "PUT",
  submit_label: "Save",
  carry_fields: ["revision"],
  fields: [
    {
      path: "settings.limit",
      label: "New limit",
      type: "number",
      min: 1,
      max: 10,
      scale: 1024,
    },
    { path: "settings.enabled", label: "New switch", type: "toggle" },
  ],
};
describe("declarative menus", () => {
  it("renders unknown page IDs and encodes nested future fields with a revision", () => {
    expect(
      validateMenu({
        version: 1,
        pages: [
          { id: "new-backend-feature", label: "New backend feature", form },
        ],
      }).pages[0].form,
    ).toEqual(form);
    expect(
      menuFormBody(
        form,
        { revision: 8, secret: "not submitted" },
        { "settings.limit": 3, "settings.enabled": false },
      ),
    ).toEqual({ revision: 8, settings: { limit: 3072, enabled: false } });
  });
  it("rejects external/escaped paths and prototype mutations", () => {
    for (const path of [
      "https://evil.test/api/v1/foo",
      "//evil.test/api/v1/foo",
      "/api/v1/../auth",
      "/api/v1/%2e%2e/foo",
      "/api/v1/foo?x=1",
      "/api/v1/a\\b",
    ])
      expect(() => menuAPIPath(path)).toThrow();
    for (const path of ["__proto__.polluted", "constructor.prototype.bad"])
      expect(() =>
        validateMenu({
          version: 1,
          pages: [
            {
              id: "x",
              label: "X",
              form: { ...form, fields: [{ path, label: "X", type: "text" }] },
            },
          ],
        }),
      ).toThrow();
    expect(({} as any).polluted).toBeUndefined();
  });
  it("refuses unknown controls, duplicate pages, future incompatible versions and invalid numbers", () => {
    expect(() => validateMenu({ version: 2, pages: [] })).toThrow();
    expect(() =>
      validateMenu({
        version: 1,
        pages: [
          {
            id: "x",
            label: "X",
            form: {
              ...form,
              fields: [{ path: "js", label: "Script", type: "javascript" }],
            },
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      menuFormBody(
        form,
        { revision: 0 },
        { "settings.limit": Infinity, "settings.enabled": true },
      ),
    ).toThrow();
  });
  it("uses authenticated bounded JSON requests with redirects and cookies disabled", async () => {
    let request: Request | undefined;
    const data = await requestMenuJSON(
      async (r) => {
        request = r;
        return Response.json({ ok: true });
      },
      "https://haunt.example",
      "token",
      "/api/v1/future/settings",
      "PUT",
      { a: 1 },
    );
    expect(data).toEqual({ ok: true });
    expect(request!.redirect).toBe("error");
    expect(request!.credentials).toBe("omit");
    expect(request!.headers.get("Authorization")).toBe("Bearer token");
    await expect(
      requestMenuJSON(
        async () => new Response("x".repeat(256 * 1024 + 1)),
        "https://haunt.example",
        "token",
        "/api/v1/menus/server",
      ),
    ).rejects.toThrow("too large");
  });
});
