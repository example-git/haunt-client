import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { friendlyError } from "@haunt/core";
import type { Call } from "@haunt/browser/media/call";
import {
  cameraModes,
  modeKey,
  preferredCameraMode,
  screenHeights,
  type VideoMode,
} from "@haunt/browser/media/video-settings";
import {
  getPreferences,
  setPreferences,
  subscribePreferences,
} from "@haunt/browser/preferences";

const idle = () => () => {};
const empty = () => undefined;
export function VideoSettings({
  purpose,
  call,
}: {
  purpose: "camera" | "screen";
  call?: Call;
}) {
  const prefs = useSyncExternalStore(subscribePreferences, getPreferences);
  const snapshot = useSyncExternalStore(
    call?.subscribe ?? idle,
    call?.getSnapshot ?? empty,
  );
  const [modes, setModes] = useState<VideoMode[]>();
  const [busy, setBusy] = useState(false);
  const changing = busy || snapshot?.busy;
  const [error, setError] = useState("");
  const generation = useRef(0);
  const camera = purpose === "camera";
  const cameraDevice = call?.cameraSettingsDevice() ?? prefs.camera;
  const saved = camera ? prefs.cameraModes[cameraDevice] : prefs.screenMode;
  const load = async () => {
    const attempt = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const available = await cameraModes(cameraDevice);
      if (attempt === generation.current) setModes(available);
    } catch (error) {
      if (attempt === generation.current) setError(friendlyError(error));
    } finally {
      if (attempt === generation.current) setBusy(false);
    }
  };
  useEffect(() => {
    const changed = () => {
      generation.current++;
      setModes(undefined);
      setError("");
      setBusy(false);
    };
    changed();
    navigator.mediaDevices?.addEventListener("devicechange", changed);
    return () => {
      generation.current++;
      navigator.mediaDevices?.removeEventListener("devicechange", changed);
    };
  }, [cameraDevice]);
  const options = camera
    ? (modes ?? [])
    : screenHeights.flatMap((height) =>
        (call?.screenFrameRates() ?? [15, 30, 60]).map((fps) => ({
          width: Math.round((height * 16) / 9),
          height,
          fps,
        })),
      );
  let selected = saved;
  if (!selected && options.length) {
    try {
      selected = preferredCameraMode(options);
    } catch {}
  }
  const unavailable =
    !!selected &&
    options.length > 0 &&
    !options.some((mode) => modeKey(mode) === modeKey(selected!));
  const resolutions = [
    ...new Map(
      options.map((mode) => [`${mode.width}x${mode.height}`, mode]),
    ).values(),
  ];
  const rates = options
    .filter(
      (mode) =>
        mode.width === selected?.width && mode.height === selected.height,
    )
    .map((mode) => mode.fps);
  const change = async (mode: VideoMode) => {
    setBusy(true);
    setError("");
    try {
      if (call && call.snapshot.status !== "ended")
        await call.setVideoMode(purpose, mode);
      else
        setPreferences(
          camera
            ? { cameraModes: { ...prefs.cameraModes, [cameraDevice]: mode } }
            : { screenMode: mode },
        );
    } catch (error) {
      setError(friendlyError(error));
    } finally {
      setBusy(false);
    }
  };
  const actual = call?.videoSettings(purpose);
  const label = camera ? "Camera" : "Screen share";
  return (
    <fieldset className="video-settings">
      <legend>{label} capture</legend>
      {camera && cameraDevice !== prefs.camera && (
        <p>
          These settings apply to the camera currently in the call. The newly
          selected device will be used next time you turn the camera on.
        </p>
      )}
      {camera && !modes && (
        <button
          className="secondary"
          disabled={changing}
          onClick={() => void load()}
        >
          {busy ? "Checking camera modes…" : "Check camera modes"}
        </button>
      )}
      <label>
        Resolution
        <select
          aria-label={`${label} resolution`}
          disabled={changing || !options.length}
          value={selected ? `${selected.width}x${selected.height}` : ""}
          onChange={(event) => {
            const available = options.filter(
              (mode) => `${mode.width}x${mode.height}` === event.target.value,
            );
            const next =
              available.find((mode) => mode.fps === selected?.fps) ??
              [...available].sort(
                (a, b) =>
                  Math.abs(a.fps - (selected?.fps ?? 60)) -
                  Math.abs(b.fps - (selected?.fps ?? 60)),
              )[0];
            if (next) void change(next);
          }}
        >
          {!selected && <option value="">Default: up to 1080p / 60 FPS</option>}
          {selected &&
            !resolutions.some(
              (mode) =>
                mode.width === selected.width &&
                mode.height === selected.height,
            ) && (
              <option value={`${selected.width}x${selected.height}`}>
                {selected.width} × {selected.height}
                {unavailable ? " (unavailable)" : " (saved)"}
              </option>
            )}
          {resolutions.map((mode) => (
            <option
              key={`${mode.width}x${mode.height}`}
              value={`${mode.width}x${mode.height}`}
            >
              {camera
                ? `${mode.width} × ${mode.height}`
                : `${mode.height}p maximum`}
            </option>
          ))}
        </select>
      </label>
      <label>
        Frame rate
        <select
          aria-label={`${label} frame rate`}
          disabled={changing || !rates.length}
          value={selected?.fps ?? ""}
          onChange={(event) =>
            selected &&
            void change({ ...selected, fps: Number(event.target.value) })
          }
        >
          {!selected && <option value="">Default</option>}
          {selected && !rates.includes(selected.fps) && (
            <option value={selected.fps}>
              {selected.fps} FPS{unavailable ? " (unavailable)" : ""}
            </option>
          )}
          {rates.map((fps) => (
            <option key={fps} value={fps}>
              {fps} FPS
            </option>
          ))}
        </select>
      </label>
      {actual && (
        <output>
          Capturing {actual.width} × {actual.height} at{" "}
          {Math.round(actual.fps * 100) / 100} FPS
        </output>
      )}
      {(error || unavailable) && (
        <p role="alert" className="error">
          {error ||
            "The saved camera mode is unavailable. Choose a supported mode."}
        </p>
      )}
    </fieldset>
  );
}
