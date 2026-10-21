import { useId, useState } from "react";
import type { ExtensionVoice } from "@haunt/core";

const customChoice = ":custom:";

export function ExtensionVoiceSelect({
  label,
  value,
  onChange,
  voices,
  defaultLabel,
  pattern,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  voices: ExtensionVoice[];
  defaultLabel?: string;
  pattern?: string;
}) {
  const id = useId();
  const [custom, setCustom] = useState(false);
  const [invalid, setInvalid] = useState<string>();
  const showCustom =
    custom ||
    (!voices.some((voice) => voice.id === value) &&
      !(defaultLabel && value === ""));
  const groups = [...new Set(voices.map((voice) => voice.group ?? "Voices"))];
  return (
    <div className="tts-voice-select">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={showCustom ? customChoice : value}
        onChange={(event) => {
          const next = event.target.value;
          setCustom(next === customChoice);
          setInvalid(undefined);
          if (next !== customChoice) onChange(next);
        }}
      >
        {defaultLabel && <option value="">{defaultLabel}</option>}
        {groups.map((group) => (
          <optgroup key={group} label={group}>
            {voices
              .filter((voice) => (voice.group ?? "Voices") === group)
              .map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.name} ({voice.id})
                </option>
              ))}
          </optgroup>
        ))}
        <option value={customChoice}>Custom voice ID…</option>
      </select>
      {showCustom && (
        <label>
          Custom voice ID
          <input
            aria-label={`${label} ID`}
            value={invalid ?? value}
            maxLength={64}
            spellCheck={false}
            aria-invalid={invalid !== undefined}
            aria-describedby={invalid === undefined ? undefined : `${id}-error`}
            onChange={(event) => {
              const next = event.target.value;
              if (
                pattern &&
                !new RegExp(pattern).test(next) &&
                !(defaultLabel && !next)
              ) {
                setInvalid(next);
                return;
              }
              setInvalid(undefined);
              onChange(next);
            }}
          />
          {invalid !== undefined && (
            <span id={`${id}-error`} role="alert" className="error small">
              This ID does not match the extension’s format and hasn’t been
              saved.
            </span>
          )}
        </label>
      )}
    </div>
  );
}
