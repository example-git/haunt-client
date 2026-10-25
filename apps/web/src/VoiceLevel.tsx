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
      const value =
        purpose === "audio"
          ? call.microphoneLevel(participant)
          : call.speaking.level(id);
      const element = ref.current;
      if (!element) return;
      element.style.setProperty("--level", `${value ?? 0}%`);
      element.dataset.unavailable = String(value === undefined);
      if (value === undefined) {
        element.removeAttribute("aria-valuenow");
        element.setAttribute("aria-valuetext", "Unavailable");
      } else {
        element.setAttribute("aria-valuenow", String(value));
        element.removeAttribute("aria-valuetext");
      }
      element.title = !available
        ? `No ${label} is being shared`
        : value === undefined
          ? `${label} level unavailable`
          : purpose === "audio"
            ? `${local ? "Outgoing" : call.microphoneLevelSource(participant) === "received" ? "Received" : "Sender"} microphone level`
            : `${local ? "Outgoing " : ""}${label} level${local ? "" : " · includes your playback volume"}`;
    };
    update();
    return purpose === "audio"
      ? call.subscribeMicrophoneLevel(participant, update)
      : call.speaking.subscribeLevel(id, update);
  }, [call, id, participant, purpose, available, label, local]);
  return (
    <div
      ref={ref}
      className="voice-level"
      role="meter"
      aria-label={`${name} ${label} level`}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <i />
    </div>
  );
}
