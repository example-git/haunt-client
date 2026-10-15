import { useEffect, useRef } from "react";
import type { Call } from "@haunt/browser/media/call";
import { audioActivityKey } from "@haunt/browser/media/speaking";
import type { AudioSource } from "@haunt/browser/volumes";

// Update only this small meter's DOM, not React's call/roster/message trees.
export function VoiceLevel({
  call,
  participant,
  name,
  purpose = "audio",
  local = false,
  available = true,
}: {
  call: Call;
  participant: string;
  name: string;
  purpose?: AudioSource;
  local?: boolean;
  available?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const id = audioActivityKey(participant, purpose);
  const label = {
    audio: "microphone",
    camera_audio: "camera audio",
    screen_audio: "screen-share audio",
  }[purpose];
  useEffect(() => {
    const update = () => {
      const value = call.speaking.level(id);
      ref.current?.style.setProperty("--level", `${value}%`);
      ref.current?.setAttribute("aria-valuenow", String(value));
    };
    update();
    return call.speaking.subscribeLevel(id, update);
  }, [call, id]);
  return (
    <div
      ref={ref}
      className="voice-level"
      role="meter"
      aria-label={`${name} ${label} level`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={0}
      title={
        !available
          ? `No ${label} is being shared`
          : `${local ? "Outgoing " : ""}${label} level${local ? "" : " · includes your playback volume"}`
      }
    >
      <i />
    </div>
  );
}
