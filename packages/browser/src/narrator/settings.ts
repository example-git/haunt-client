export const narrationTemplates = {
  joined: "{{DISPLAY_NAME}} joined {{CHANNEL}}",
  left: "{{DISPLAY_NAME}} left {{CHANNEL}}",
  muted: "{{DISPLAY_NAME}} muted",
  unmuted: "{{DISPLAY_NAME}} unmuted",
  deafened: "{{DISPLAY_NAME}} deafened",
  undeafened: "{{DISPLAY_NAME}} undeafened",
  streamStarted: "{{DISPLAY_NAME}} started sharing their screen",
  streamStopped: "{{DISPLAY_NAME}} stopped sharing their screen",
};

export type NarrationEvent = keyof typeof narrationTemplates;
export interface NarratorSettings {
  enabled: boolean;
  provider: string;
  voice: string;
  deviceVoice: string;
  fallback: boolean;
  volume: number;
  rate: number;
  joins: boolean;
  leaves: boolean;
  mute: boolean;
  deafen: boolean;
  screen: boolean;
  ignoreSelf: boolean;
  cooldownMs: number;
  templates: Record<NarrationEvent, string>;
  users: Record<string, { voice: string; ignored: boolean }>;
}

export const defaultNarratorSettings: NarratorSettings = {
  enabled: false,
  provider: "device",
  voice: "",
  deviceVoice: "",
  fallback: true,
  volume: 80,
  rate: 1,
  joins: true,
  leaves: true,
  mute: false,
  deafen: false,
  screen: false,
  ignoreSelf: true,
  cooldownMs: 1500,
  templates: narrationTemplates,
  users: {},
};

export const narratorUserKey = (scope: string, user: string) =>
  JSON.stringify([scope, user]);

export function narrationText(value: string) {
  let result = "",
    bytes = 0;
  for (const character of value.trim()) {
    const size = new TextEncoder().encode(character).length;
    if (bytes + size > 500) break;
    result += character;
    bytes += size;
  }
  return result;
}

export function normalizeNarratorSettings(value: unknown): NarratorSettings {
  const next = {
    ...defaultNarratorSettings,
    templates: { ...narrationTemplates },
    users: {} as NarratorSettings["users"],
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) return next;
  const raw = value as Record<string, unknown>;
  for (const key of [
    "enabled",
    "fallback",
    "joins",
    "leaves",
    "mute",
    "deafen",
    "screen",
    "ignoreSelf",
  ] as const)
    if (typeof raw[key] === "boolean") next[key] = raw[key];
  if (
    typeof raw.provider === "string" &&
    /^[a-z][a-z0-9-]{0,63}$/.test(raw.provider)
  )
    next.provider = raw.provider === "tiktok" ? "tiktok-tts" : raw.provider;
  for (const key of ["deviceVoice"] as const)
    if (typeof raw[key] === "string") next[key] = raw[key].slice(0, 512);
  if (typeof raw.voice === "string" && raw.voice.length <= 64)
    next.voice = raw.voice;
  for (const [key, minimum, maximum] of [
    ["volume", 0, 100],
    ["rate", 0.5, 2],
    ["cooldownMs", 0, 30_000],
  ] as const)
    if (typeof raw[key] === "number" && Number.isFinite(raw[key]))
      next[key] = Math.max(minimum, Math.min(maximum, raw[key]));
  if (raw.templates && typeof raw.templates === "object")
    for (const key of Object.keys(narrationTemplates) as NarrationEvent[]) {
      const text = (raw.templates as Record<string, unknown>)[key];
      if (typeof text === "string") next.templates[key] = text.slice(0, 300);
    }
  if (raw.users && typeof raw.users === "object" && !Array.isArray(raw.users))
    next.users = Object.fromEntries(
      Object.entries(raw.users)
        .slice(0, 1024)
        .flatMap(([key, entry]) => {
          if (key.length > 512 || !entry || typeof entry !== "object")
            return [];
          const override = entry as Record<string, unknown>;
          return [
            [
              key,
              {
                ignored: override.ignored === true,
                voice:
                  typeof override.voice === "string" &&
                  override.voice.length <= 64
                    ? override.voice
                    : "",
              },
            ],
          ];
        }),
    );
  return next;
}

export function normalizeNarratorServers(
  value: unknown,
): Record<string, NarratorSettings> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 128)
      .filter(([scope]) => scope.length <= 512)
      .map(([scope, settings]) => [scope, normalizeNarratorSettings(settings)]),
  );
}
