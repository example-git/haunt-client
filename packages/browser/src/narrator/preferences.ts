import type { InstanceClient } from "@haunt/core";
import { getPreferences, setPreferences } from "../preferences";
import { normalizeNarratorSettings, type NarratorSettings } from "./settings";
import type { NarratorSource } from "./playback";

export function getNarratorSettings(scope?: string): NarratorSettings {
  const preferences = getPreferences();
  return scope
    ? (preferences.narratorServers[scope] ??
        normalizeNarratorSettings(undefined))
    : preferences.narrator;
}

export function setNarratorSettings(
  scope: string | undefined,
  patch: Partial<NarratorSettings>,
) {
  const settings = normalizeNarratorSettings({
    ...getNarratorSettings(scope),
    ...patch,
  });
  if (scope)
    setPreferences({
      narratorServers: {
        ...getPreferences().narratorServers,
        [scope]: settings,
      },
    });
  else setPreferences({ narrator: settings });
}

export function serverNarratorSource(
  instance: InstanceClient,
  room?: string,
): NarratorSource {
  return {
    key: instance.scope,
    settings: () => getNarratorSettings(instance.scope),
    generate: (provider, text, voice, signal) => {
      if (instance.snapshot.status !== "online")
        throw Error("Connect to this server to use its speech extension.");
      return instance.extensionSpeech(
        provider,
        { text, voice, ...(room ? { room_id: room } : {}) },
        signal,
      );
    },
  };
}
