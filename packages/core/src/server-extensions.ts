import { APIError, serverOrigin } from "./api.js";

export interface ServerExtension {
  id: string;
  name: string;
  category: "tts";
  enabled: boolean;
  configured: boolean;
}

export interface ServerExtensionConfiguration extends ServerExtension {
  revision: number;
  endpoint: string;
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
      item.category !== "tts" ||
      typeof item.enabled !== "boolean" ||
      typeof item.configured !== "boolean"
    )
      throw Error("Invalid server extension catalog.");
    ids.add(item.id);
    return {
      id: item.id,
      name: item.name,
      category: "tts",
      enabled: item.enabled,
      configured: item.configured,
    };
  });
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
        AbortSignal.timeout(15_000),
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
