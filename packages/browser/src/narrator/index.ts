import type { Call } from "../media/call";
import { subscribePreferences } from "../preferences";
import { getNarratorSettings, serverNarratorSource } from "./preferences";
import { NarratorEvents } from "./events";
import { narratorPlayback } from "./playback";

export function attachNarrator(call: Call) {
  const instance = call.client;
  const source = serverNarratorSource(instance, call.room);
  const events = new NarratorEvents(
    instance.account.login.user.id,
    instance.scope,
    (id) => {
      const user = instance.snapshot.users.find((user) => user.id === id);
      return {
        username: user?.username || "Someone",
        displayName: user?.display_name || user?.username || "Someone",
      };
    },
    () =>
      instance.snapshot.channels.find((channel) => channel.id === call.room)
        ?.name || "the call",
  );
  const update = () => {
    const snapshot = call.snapshot;
    const settings = getNarratorSettings(instance.scope);
    if (
      !settings.enabled ||
      snapshot.status !== "connected" ||
      snapshot.state.deafened
    )
      narratorPlayback.stop();
    for (const narration of events.observe(snapshot, settings))
      narratorPlayback.enqueue(narration.text, narration.voice, source);
  };
  let settings = getNarratorSettings(instance.scope);
  const offPreferences = subscribePreferences(() => {
    const next = getNarratorSettings(instance.scope);
    if (JSON.stringify(next) !== JSON.stringify(settings))
      narratorPlayback.stop();
    settings = next;
    update();
  });
  const off = call.subscribe(update);
  update();
  return () => {
    off();
    offPreferences();
    narratorPlayback.stop();
  };
}
