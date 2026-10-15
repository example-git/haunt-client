import { useEffect, useRef } from "react";
import type { Call } from "@haunt/browser/media/call";

// Update only this small meter's DOM, not React's call/roster/message trees.
export function VoiceLevel({
  call,
  participant,
  name,
}: {
  call: Call;
  participant: string;
  name: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const update = () => {
      const value = call.speaking.level(participant);
      ref.current?.style.setProperty("--level", `${value}%`);
      ref.current?.setAttribute("aria-valuenow", String(value));
    };
    update();
    return call.speaking.subscribeLevel(participant, update);
  }, [call, participant]);
  return (
    <div
      ref={ref}
      className="voice-level"
      role="meter"
      aria-label={`${name} microphone level`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={0}
      title="Microphone level · includes your playback volume"
    >
      <i />
    </div>
  );
}
