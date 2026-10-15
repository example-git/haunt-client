import { APIError } from "./api.js";
import type { Schemas } from "./types.js";
export type MenuManifest = Omit<Schemas["HttpapiMenuManifest"], "pages"> & {
  pages: MenuPage[];
};
export type MenuPage = Omit<Schemas["HttpapiMenuPage"], "form"> & {
  form?: MenuForm;
};
export type MenuForm = Omit<Schemas["HttpapiMenuForm"], "fields"> & {
  fields: MenuField[];
};
export type MenuField = Schemas["HttpapiMenuField"];
export type MenuCommand = Schemas["HttpapiMenuCommand"];
export type SettingValue = string | number | boolean | null;
export function menuAPIPath(path: string): string {
  // No escaping/normalization, absolute URLs, fragments or query strings. This
  // contract addresses JSON API resources, never arbitrary remote content.
  if (!/^\/api\/v1\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/.test(path))
    throw Error("Unsupported menu API path");
  return path;
}
function segments(path: string) {
  const parts = path.split(".");
  if (
    parts.length > 8 ||
    parts.some(
      (p) =>
        !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(p) ||
        ["__proto__", "prototype", "constructor"].includes(p),
    )
  )
    throw Error("Invalid settings field path");
  return parts;
}
export function readMenuValue(value: unknown, path: string): unknown {
  for (const part of segments(path)) {
    if (!value || typeof value !== "object" || !Object.hasOwn(value, part))
      return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}
function writeValue(
  body: Record<string, unknown>,
  path: string,
  value: unknown,
) {
  const parts = segments(path);
  for (const part of parts.slice(0, -1)) {
    if (!Object.hasOwn(body, part)) body[part] = {};
    if (
      !body[part] ||
      typeof body[part] !== "object" ||
      Array.isArray(body[part])
    )
      throw Error("Conflicting settings field paths");
    body = body[part] as Record<string, unknown>;
  }
  body[parts.at(-1)!] = value;
}
export function menuFormBody(
  form: MenuForm,
  loaded: unknown,
  values: Record<string, SettingValue>,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const path of form.carry_fields ?? []) {
    const value = readMenuValue(loaded, path);
    if (
      value === undefined ||
      (value !== null &&
        !["string", "number", "boolean"].includes(typeof value))
    )
      throw Error("Missing form revision or context. Reload these settings.");
    writeValue(body, path, value);
  }
  for (const field of form.fields) {
    let value = values[field.path];
    if (field.type === "number") {
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        (field.min != null && value < field.min) ||
        (field.max != null && value > field.max)
      )
        throw Error(`Check ${field.label}.`);
      value = Math.round(value * (field.scale ?? 1) * 1e9) / 1e9;
    } else if (field.type === "toggle") {
      if (typeof value !== "boolean") throw Error(`Check ${field.label}.`);
    } else {
      if (
        typeof value !== "string" ||
        (field.required && !value) ||
        value.length > (field.max_length ?? 10000)
      )
        throw Error(`Check ${field.label}.`);
      if (
        field.type === "select" &&
        !field.options?.some((o) => o.value === value)
      )
        throw Error(`Check ${field.label}.`);
    }
    writeValue(body, field.path, value);
  }
  return body;
}
export function validateMenu(raw: unknown): MenuManifest {
  const v = raw as MenuManifest;
  const text = (s: unknown, max = 200) =>
    typeof s === "string" && s.length > 0 && s.length <= max;
  if (!v || v.version !== 1 || !Array.isArray(v.pages) || v.pages.length > 64)
    throw Error("This server uses an unsupported menu format.");
  const ids = new Set<string>();
  for (const page of v.pages) {
    if (
      !page ||
      !text(page.id, 80) ||
      !text(page.label) ||
      ids.has(page.id) ||
      [page.builtin, page.form, page.action].filter(Boolean).length !== 1
    )
      throw Error("Invalid server menu");
    ids.add(page.id);
    if (page.form) {
      const f = page.form;
      menuAPIPath(f.load_path);
      menuAPIPath(f.save_path);
      if (
        !["PUT", "POST"].includes(f.method) ||
        !text(f.submit_label) ||
        !Array.isArray(f.fields) ||
        f.fields.length > 100 ||
        (f.carry_fields?.length ?? 0) > 16
      )
        throw Error("Invalid server form");
      const paths = new Set<string>();
      for (const field of f.fields) {
        segments(field.path);
        if (
          paths.has(field.path) ||
          !text(field.label) ||
          ![
            "text",
            "textarea",
            "password",
            "number",
            "toggle",
            "select",
          ].includes(field.type)
        )
          throw Error("Unsupported server form control");
        paths.add(field.path);
        for (const n of [field.min, field.max, field.step, field.scale])
          if (n !== undefined && !Number.isFinite(n))
            throw Error("Invalid form bounds");
        if (
          (field.scale !== undefined && field.scale <= 0) ||
          (field.step != null && field.step <= 0)
        )
          throw Error("Invalid form scale");
        if (
          field.type === "select" &&
          (!Array.isArray(field.options) ||
            field.options.length > 500 ||
            field.options.some(
              (o) => typeof o.value !== "string" || !text(o.label),
            ))
        )
          throw Error("Invalid form choices");
      }
      for (const path of f.carry_fields ?? []) {
        segments(path);
        if (paths.has(path)) throw Error("Conflicting form fields");
      }
    }
    if (page.action) {
      menuAPIPath(page.action.path);
      if (
        !["POST", "PUT", "DELETE"].includes(page.action.method) ||
        !text(page.action.confirmation, 2000)
      )
        throw Error("Invalid server action");
    }
  }
  return v;
}
// A bounded JSON-only request through the same browser/Electron transport as
// the typed SDK. New API paths do not require regenerating a client bundle.
export async function requestMenuJSON(
  fetcher: (request: Request) => Promise<Response>,
  origin: string,
  token: string,
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
) {
  menuAPIPath(path);
  return requestBoundedJSON(
    fetcher,
    origin,
    token,
    path,
    method,
    body,
    signal,
    256 * 1024,
  );
}
// The caller must validate an internal API path before entering this transport.
export async function requestBoundedJSON(
  fetcher: (request: Request) => Promise<Response>,
  origin: string,
  token: string,
  path: string,
  method: string,
  body: unknown,
  signal: AbortSignal | undefined,
  maximum: number,
) {
  if (!["GET", "POST", "PUT", "DELETE"].includes(method))
    throw Error("Unsupported menu method");
  const response = await fetcher(
    new Request(origin + path, {
      method,
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.any([
        AbortSignal.timeout(
          path === "/api/v1/admin/audio-plugins/repository" ? 100000 : 30000,
        ),
        ...(signal ? [signal] : []),
      ]),
    }),
  );
  if (response.status === 204) return undefined;
  const reader = response.body?.getReader();
  if (!reader) throw Error("Empty menu response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maximum) throw Error("API response is too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (!response.ok)
      throw new APIError(response.status, `http_${response.status}`);
    throw error;
  }
  if (!response.ok)
    throw new APIError(
      response.status,
      typeof data?.error === "string" ? data.error : `http_${response.status}`,
    );
  return data as unknown;
}
