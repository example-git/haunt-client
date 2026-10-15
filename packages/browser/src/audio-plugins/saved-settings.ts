import type { PluginPreferences } from "./contract";
export interface ServerPluginPreferences {
  selected: string;
  plugins: Record<string, PluginPreferences>;
}
export function parsePluginPreferences(
  value: unknown,
): Record<string, ServerPluginPreferences> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, ServerPluginPreferences> = {};
  for (const [server, raw] of Object.entries(value).slice(0, 128)) {
    if (
      server.length > 128 ||
      !server ||
      ["__proto__", "constructor", "prototype"].includes(server) ||
      !raw ||
      typeof raw !== "object" ||
      typeof raw.selected !== "string"
    )
      continue;
    const plugins: Record<string, PluginPreferences> = {};
    for (const [id, p] of Object.entries(raw.plugins ?? {}).slice(0, 16) as [
      string,
      any,
    ][]) {
      if (
        !/^[a-z][a-z0-9_-]{0,63}$/.test(id) ||
        ["constructor", "prototype"].includes(id) ||
        !p ||
        typeof p.variant !== "string"
      )
        continue;
      const values = Object.fromEntries(
        Object.entries(p.values ?? {})
          .slice(0, 32)
          .filter(
            ([k, n]) =>
              /^[a-z][a-z0-9_-]{0,63}$/.test(k) &&
              !["constructor", "prototype"].includes(k) &&
              typeof n === "number" &&
              Number.isFinite(n),
          ),
      ) as Record<string, number>;
      plugins[id] = { id, variant: p.variant.slice(0, 64), values };
    }
    out[server] = { selected: raw.selected.slice(0, 64), plugins };
  }
  return out;
}
