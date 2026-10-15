import { ModerationMenu } from "./Moderation";
import { useSyncExternalStore } from "react";
import type { InstanceClient } from "@haunt/core";
import {
  getVolumes,
  subscribeVolumes,
  userVolumes,
  setUserVolume,
} from "@haunt/browser/volumes";
export function UserVolume({
  instance,
  user,
}: {
  instance: InstanceClient;
  user: string;
}) {
  useSyncExternalStore(subscribeVolumes, getVolumes);
  const values = userVolumes(instance.scope, user);
  if (user === instance.account.login.user.id) return null;
  return (
    <>
      <ModerationMenu instance={instance} user={user} />
      <div className="user-volumes" role="group" aria-label="Playback volume">
        {(
          [
            ["audio", "Microphone"],
            ["camera_audio", "Camera audio"],
            ["screen_audio", "Screen-share audio"],
          ] as const
        ).map(([source, label]) => (
          <label key={source}>
            <span>
              {label}
              <output>{values[source]}%</output>
            </span>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              aria-label={`${label} volume`}
              value={values[source]}
              onChange={(e) =>
                setUserVolume(
                  instance.scope,
                  user,
                  source,
                  Number(e.target.value),
                )
              }
            />
          </label>
        ))}
        <small>Saved on this device</small>
      </div>
    </>
  );
}
