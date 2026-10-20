import type { MediaState } from "@haunt/core";
import type { CallSnapshot } from "../media/call";
import {
  narratorUserKey,
  narrationText,
  type NarrationEvent,
  type NarratorSettings,
} from "./settings";

export interface Narration {
  text: string;
  voice: string;
  user: string;
  event: NarrationEvent;
}

export class NarratorEvents {
  private previous = new Map<string, MediaState>();
  private connected = false;
  private cooldowns = new Map<string, number>();

  constructor(
    private self: string,
    private scope: string,
    private name: (id: string) => { username: string; displayName: string },
    private channel: () => string,
    private now = Date.now,
  ) {}

  observe(
    snapshot: Pick<CallSnapshot, "status" | "participants" | "state">,
    settings: NarratorSettings,
  ): Narration[] {
    const current = new Map<string, MediaState>();
    for (const participant of snapshot.participants) {
      const before = current.get(participant.user_id);
      const state = participant.state;
      current.set(
        participant.user_id,
        before
          ? {
              muted: before.muted && state.muted,
              deafened: before.deafened && state.deafened,
              camera_off: before.camera_off && state.camera_off,
              screen_off: before.screen_off && state.screen_off,
            }
          : { ...state },
      );
    }
    if (current.has(this.self)) current.set(this.self, { ...snapshot.state });
    const results: Narration[] = [];
    const announce = (user: string, event: NarrationEvent) => {
      const override = settings.users[narratorUserKey(this.scope, user)];
      if ((settings.ignoreSelf && user === this.self) || override?.ignored)
        return;
      const group =
        event === "joined" || event === "left" ? "membership" : event;
      const key = JSON.stringify([user, group]);
      const now = this.now();
      if (now - (this.cooldowns.get(key) ?? -Infinity) < settings.cooldownMs)
        return;
      const name = this.name(user);
      const values: Record<string, string> = {
        USER: name.username,
        DISPLAY_NAME: name.displayName,
        CHANNEL: this.channel(),
      };
      const text = narrationText(
        settings.templates[event].replace(
          /\{\{(USER|DISPLAY_NAME|CHANNEL)\}\}/g,
          (_, field: string) =>
            values[field]
              .normalize("NFKC")
              .replace(/[\p{Cc}\p{Cf}]/gu, "")
              .slice(0, 80),
        ),
      );
      if (!text) return;
      this.cooldowns.delete(key);
      this.cooldowns.set(key, now);
      if (this.cooldowns.size > 1024)
        this.cooldowns.delete(this.cooldowns.keys().next().value!);
      results.push({
        text,
        voice: override?.voice || settings.voice,
        user,
        event,
      });
    };
    if (
      this.connected &&
      snapshot.status === "connected" &&
      settings.enabled &&
      !snapshot.state.deafened
    ) {
      for (const [user, state] of current) {
        const before = this.previous.get(user);
        if (!before) {
          if (settings.joins) announce(user, "joined");
          continue;
        }
        if (settings.mute && state.muted !== before.muted)
          announce(user, state.muted ? "muted" : "unmuted");
        if (settings.deafen && state.deafened !== before.deafened)
          announce(user, state.deafened ? "deafened" : "undeafened");
        if (settings.screen && state.screen_off !== before.screen_off)
          announce(user, state.screen_off ? "streamStopped" : "streamStarted");
      }
      if (settings.leaves)
        for (const user of this.previous.keys())
          if (!current.has(user)) announce(user, "left");
    }
    this.previous = current;
    this.connected = snapshot.status === "connected";
    return results;
  }
}
