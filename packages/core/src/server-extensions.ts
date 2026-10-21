import { APIError, serverOrigin } from "./api.js";

export interface ExtensionVoice {
  id: string;
  name: string;
  group?: string;
}

export interface ExtensionField {
  key: string;
  label: string;
  type: "text" | "password" | "select";
  help?: string;
  default?: string;
  required?: boolean;
  max_length?: number;
  pattern?: string;
  options?: { value: string; label: string }[];
}

export interface ServerExtension {
  id: string;
  name: string;
  description: string;
  voices: ExtensionVoice[];
  default_voice: string;
  voice_pattern?: string;
  category: "tts";
  enabled: boolean;
  configured: boolean;
}

export interface ServerExtensionConfiguration extends ServerExtension {
  revision: number;
  fields: ExtensionField[];
  values: Record<string, string>;
  configured_secrets: string[];
}

export function parseServerExtensions(value: unknown): ServerExtension[] {
  const items = (value as { extensions?: unknown })?.extensions;
  if (!Array.isArray(items) || items.length > 32)
    throw Error("Invalid server extension catalog.");
  const ids = new Set<string>();
  return items.map((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.id !== "string" ||
      !/^[a-z][a-z0-9-]{0,63}$/.test(item.id) ||
      ids.has(item.id) ||
      typeof item.name !== "string" ||
      !item.name ||
      item.name.length > 100 ||
      typeof item.description !== "string" ||
      item.description.length > 2000 ||
      typeof item.default_voice !== "string" ||
      !item.default_voice ||
      item.default_voice.length > 64 ||
      !Array.isArray(item.voices) ||
      item.voices.length > 512 ||
      item.voices.some(
        (voice: ExtensionVoice) =>
          !voice ||
          typeof voice.id !== "string" ||
          !voice.id ||
          voice.id.length > 64 ||
          typeof voice.name !== "string" ||
          !voice.name ||
          voice.name.length > 150 ||
          (voice.group !== undefined &&
            (typeof voice.group !== "string" || voice.group.length > 100)),
      ) ||
      new Set(item.voices.map((voice: ExtensionVoice) => voice.id)).size !==
        item.voices.length ||
      (item.voice_pattern !== undefined &&
        (typeof item.voice_pattern !== "string" ||
          item.voice_pattern.length > 512)) ||
      item.category !== "tts" ||
      typeof item.enabled !== "boolean" ||
      typeof item.configured !== "boolean"
    )
      throw Error("Invalid server extension catalog.");
    ids.add(item.id);
    if (item.voice_pattern) new RegExp(item.voice_pattern);
    return {
      id: item.id,
      name: item.name,
      description: item.description,
      default_voice: item.default_voice,
      ...(item.voice_pattern ? { voice_pattern: item.voice_pattern } : {}),
      voices: item.voices.map((voice: ExtensionVoice) => ({
        id: voice.id,
        name: voice.name,
        ...(voice.group ? { group: voice.group } : {}),
      })),
      category: "tts",
      enabled: item.enabled,
      configured: item.configured,
    };
  });
}

export function parseExtensionConfiguration(
  raw: unknown,
  id: string,
): ServerExtensionConfiguration {
  const value = raw as ServerExtensionConfiguration;
  const extension = parseServerExtensions({ extensions: [raw] })[0];
  if (
    extension.id !== id ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !Array.isArray(value.fields) ||
    value.fields.length > 32 ||
    !value.values ||
    typeof value.values !== "object" ||
    Array.isArray(value.values) ||
    !Array.isArray(value.configured_secrets)
  )
    throw Error("Invalid extension configuration.");
  const keys = new Set<string>();
  const fields = value.fields.map((field) => {
    if (
      !field ||
      typeof field.key !== "string" ||
      !/^[a-z][a-z0-9_]{0,63}$/.test(field.key) ||
      ["constructor", "prototype", "__proto__"].includes(field.key) ||
      keys.has(field.key) ||
      typeof field.label !== "string" ||
      !field.label ||
      field.label.length > 100 ||
      !["text", "password", "select"].includes(field.type) ||
      (field.help !== undefined &&
        (typeof field.help !== "string" || field.help.length > 2000)) ||
      (field.max_length !== undefined &&
        (!Number.isInteger(field.max_length) ||
          field.max_length < 0 ||
          field.max_length > 4096)) ||
      (field.required !== undefined && typeof field.required !== "boolean")
    )
      throw Error("Invalid extension field.");
    keys.add(field.key);
    if (
      field.type === "select" &&
      (!Array.isArray(field.options) ||
        !field.options.length ||
        field.options.length > 128 ||
        field.options.some(
          (option) =>
            !option ||
            typeof option.value !== "string" ||
            option.value.length > 4096 ||
            typeof option.label !== "string" ||
            !option.label ||
            option.label.length > 150,
        ))
    )
      throw Error("Invalid extension choices.");
    return {
      key: field.key,
      label: field.label,
      type: field.type,
      help: field.help,
      required: field.required,
      max_length: field.max_length,
      ...(field.type === "select"
        ? {
            options: field.options!.map((option) => ({
              value: option.value,
              label: option.label,
            })),
          }
        : {}),
    };
  });
  const values: Record<string, string> = {};
  for (const field of fields) {
    if (field.type === "password") continue;
    const current = value.values[field.key];
    if (typeof current !== "string" || current.length > 4096)
      throw Error("Invalid extension value.");
    values[field.key] = current;
  }
  if (
    value.configured_secrets.some(
      (key) =>
        !fields.some((field) => field.key === key && field.type === "password"),
    )
  )
    throw Error("Invalid extension credential status.");
  return {
    ...extension,
    revision: value.revision,
    fields,
    values,
    configured_secrets: [...value.configured_secrets],
  };
}

export async function requestExtensionSpeech(
  fetcher: (request: Request) => Promise<Response>,
  origin: string,
  token: string,
  extension: string,
  prompt: { text: string; voice: string; room_id?: string },
  signal?: AbortSignal,
  test = false,
) {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(extension))
    throw Error("Invalid server extension.");
  const path = test
    ? `/api/v1/admin/server-extensions/${extension}/test`
    : `/api/v1/server-extensions/${extension}/speech`;
  const response = await fetcher(
    new Request(serverOrigin(origin) + path, {
      method: "POST",
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(prompt),
      signal: AbortSignal.any([
        AbortSignal.timeout(25_000),
        ...(signal ? [signal] : []),
      ]),
    }),
  );
  const reader = response.body?.getReader();
  if (!reader) throw Error("The speech provider returned no audio.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > (response.ok ? 8 * 1024 * 1024 : 4096))
        throw Error("The speech response is too large.");
      chunks.push(item.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (!response.ok) {
    let code = "server_extension_unavailable";
    try {
      const message = JSON.parse(new TextDecoder().decode(bytes)).error;
      if (typeof message === "string" && /^[a-z_]{1,100}$/.test(message))
        code = message;
    } catch {}
    throw new APIError(response.status, code);
  }
  if (!size || !response.headers.get("Content-Type")?.startsWith("audio/mpeg"))
    throw Error("The speech provider returned invalid audio.");
  return bytes;
}
