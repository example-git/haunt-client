import { useId, useState } from "react";
import { tikTokVoiceGroups } from "@haunt/browser/narrator/voices";

const knownVoices = new Set<string>(
  Object.values(tikTokVoiceGroups).flatMap((voices) =>
    voices.map(([id]) => id),
  ),
);
const customChoice = ":custom:";

export function TikTokVoiceSelect({
  label,
  value,
  onChange,
  defaultLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  defaultLabel?: string;
}) {
  const id = useId();
  const [custom, setCustom] = useState(false);
  const [invalid, setInvalid] = useState<string>();
  const showCustom =
    custom || (!knownVoices.has(value) && !(defaultLabel && value === ""));
  return (
    <div className="tts-voice-select">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={showCustom ? customChoice : value}
        onChange={(event) => {
          const next = event.target.value;
          setInvalid(undefined);
          setCustom(next === customChoice);
          if (next !== customChoice) onChange(next);
        }}
      >
        {defaultLabel && <option value="">{defaultLabel}</option>}
        {Object.entries(tikTokVoiceGroups).map(([group, voices]) => (
          <optgroup key={group} label={group}>
            {voices.map(([voice, name]) => (
              <option key={voice} value={voice}>
                {name} ({voice})
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
            aria-invalid={invalid !== undefined}
            aria-describedby={invalid === undefined ? undefined : `${id}-error`}
            maxLength={64}
            spellCheck={false}
            onChange={(event) => {
              const next = event.target.value;
              if (
                !/^[a-z0-9_]{2,64}$/i.test(next) &&
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
              Use 2–64 letters, numbers or underscores. This value hasn’t been
              saved; the previous voice is still selected.
            </span>
          )}
        </label>
      )}
    </div>
  );
}
