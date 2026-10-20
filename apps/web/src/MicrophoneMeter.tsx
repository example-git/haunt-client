import { useEffect, useRef, useState } from "react";
import { followAudioOutput } from "@haunt/browser/audio-output";
import {
  getPreferences,
  subscribePreferences,
} from "@haunt/browser/preferences";
import {
  MicrophoneCapture,
  type NoiseStatus,
  type NoiseScores,
} from "@haunt/browser/media/microphone";

import type { PluginSelection } from "@haunt/browser/audio-plugins/contract";

/** Local processed-mic monitor. Playback is explicit and never published. */
export function MicrophoneMeter({
  device,
  noiseSuppression,
  gain,
  automaticGain,
  noiseOptions,
  onAccessGranted,
  onListeningChange,
  showDiagnostics = false,
}: {
  device: string;
  noiseSuppression: boolean;
  gain: number;
  automaticGain: boolean;
  noiseOptions?: PluginSelection;
  onAccessGranted: () => void;
  onListeningChange?: (listening: boolean) => void | Promise<void>;
  showDiagnostics?: boolean;
}) {
  const meter = useRef<HTMLDivElement>(null);
  const microphone = useRef<MicrophoneCapture | undefined>(undefined);
  const playback = useRef<HTMLAudioElement>(null);
  const [scores, setScores] = useState<NoiseScores | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [listening, setListening] = useState(false);
  const [playbackError, setPlaybackError] = useState("");
  const playbackGeneration = useRef(0);
  const stopListening = () => {
    playbackGeneration.current++;
    playback.current?.pause();
    setListening(false);
    onListeningChange?.(false);
  };
  useEffect(() => {
    let output = getPreferences().audioOutput;
    const unsubscribe = subscribePreferences(() => {
      const next = getPreferences().audioOutput;
      if (next !== output) {
        output = next;
        stopListening();
      }
    });
    // A monitor must never resume on a different output (including default
    // speakers after unplug). Restarting playback always requires a click.
    navigator.mediaDevices?.addEventListener("devicechange", stopListening);
    const unfollow = followAudioOutput(playback.current!);
    return () => {
      unsubscribe();
      unfollow();
      navigator.mediaDevices?.removeEventListener(
        "devicechange",
        stopListening,
      );
    };
  }, []);
  const desired = useRef({
    noiseSuppression,
    gain,
    automaticGain,
    noiseOptions,
  });
  desired.current = { noiseSuppression, gain, automaticGain, noiseOptions };
  const [noise, setNoise] = useState<NoiseStatus>("loading");
  useEffect(() => {
    void microphone.current?.setSuppression(noiseSuppression, noiseOptions);
    void microphone.current?.setGain(gain, automaticGain);
  }, [
    noiseSuppression,
    gain,
    automaticGain,
    noiseOptions?.plugin.digest,
    noiseOptions?.variant,
    JSON.stringify(noiseOptions?.values),
  ]);
  const [status, setStatus] = useState("Starting microphone…");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let closed = false,
      frame = 0;
    let stream: MediaStream | undefined, context: AudioContext | undefined;
    let processing: MicrophoneCapture | undefined;
    const abort = new AbortController();
    const audio = playback.current!;
    stopListening();
    setReady(false);
    setPlaybackError("");
    setStatus("Starting microphone…");
    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia)
        throw Error(
          "Microphone access requires HTTPS, localhost or the desktop app.",
        );
      const captured = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: device ? { exact: device } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: desired.current.automaticGain,
        },
      });
      if (closed) {
        captured.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = captured;
      onAccessGranted();
      captured.getAudioTracks()[0]?.addEventListener("ended", () => {
        if (!closed) {
          closed = true;
          stopListening();
          setReady(false);
          audio.srcObject = null;
          abort.abort();
          cancelAnimationFrame(frame);
          processing?.close();
          void context?.close().catch(() => {});
          meter.current?.style.setProperty("--mic-level", "0%");
          meter.current?.setAttribute("aria-valuenow", "0");
          setStatus("Microphone disconnected. Retry or select another input.");
        }
      });
      processing = await MicrophoneCapture.open(
        stream,
        desired.current.noiseSuppression,
        (value) => {
          if (closed) return;
          setNoise(value);
          setStatus(
            value === "active"
              ? "Input level · after audio plugin"
              : value === "off"
                ? "Input level · noise cancellation off"
                : value === "fallback"
                  ? "Input level · plugin unavailable, unprocessed audio"
                  : "Starting noise cancellation…",
          );
        },
        abort.signal,
        {
          level: desired.current.gain,
          automatic: desired.current.automaticGain,
        },
        desired.current.noiseOptions,
        showDiagnostics
          ? (value) => {
              if (!closed) setScores(value);
            }
          : undefined,
      );
      if (closed) {
        processing.close();
        return;
      }
      microphone.current = processing;
      await processing.setSuppression(
        desired.current.noiseSuppression,
        desired.current.noiseOptions,
      );
      await processing.setGain(
        desired.current.gain,
        desired.current.automaticGain,
      );
      if (closed) return;
      audio.srcObject = new MediaStream([processing.track]);
      setReady(true);
      context = new AudioContext();
      const source = context.createMediaStreamSource(
        new MediaStream([processing.track]),
      );
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      await context.resume();
      if (closed) return;
      const samples = new Float32Array(analyser.fftSize);
      let last = 0,
        level = 0;
      const update = (time: number) => {
        if (closed) return;
        if (time - last >= 50) {
          last = time;
          analyser.getFloatTimeDomainData(samples);
          let peak = 0;
          for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
          const measured = Math.max(
            0,
            Math.min(1, (20 * Math.log10(Math.max(peak, 0.000001)) + 60) / 60),
          );
          level = Math.max(measured, level - 0.06);
          const node = meter.current;
          if (node) {
            node.style.setProperty("--mic-level", `${level * 100}%`);
            node.setAttribute("aria-valuenow", String(Math.round(level * 100)));
            node.setAttribute(
              "aria-valuetext",
              peak > 0.000001
                ? `${Math.round(20 * Math.log10(peak))} dBFS`
                : "Silent",
            );
          }
        }
        frame = requestAnimationFrame(update);
      };
      frame = requestAnimationFrame(update);
    };
    void start().catch((error: unknown) => {
      if (!closed) {
        stopListening();
        setReady(false);
        audio.srcObject = null;
      }
      processing?.close();
      stream?.getTracks().forEach((t) => t.stop());
      void context?.close().catch(() => {});
      if (!closed)
        setStatus(
          error instanceof DOMException && error.name === "NotAllowedError"
            ? "Allow microphone access to see input levels."
            : error instanceof Error
              ? error.message
              : "Microphone unavailable.",
        );
    });
    return () => {
      closed = true;
      stopListening();
      audio.srcObject = null;
      abort.abort();
      if (microphone.current === processing) microphone.current = undefined;
      processing?.close();
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
      void context?.close().catch(() => {});
      meter.current?.style.setProperty("--mic-level", "0%");
    };
  }, [device, attempt, onAccessGranted, showDiagnostics]);
  return (
    <div className="microphone-monitor" data-noise-suppression={noise}>
      <audio ref={playback} aria-label="Microphone playback test" />
      <div
        ref={meter}
        className="microphone-meter"
        role="meter"
        aria-label="Microphone input level"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={0}
      >
        <div className="microphone-meter-colors" />
        <div className="microphone-meter-mask" />
      </div>
      <div className="microphone-meter-label">
        <small>{status}</small>
        <button
          type="button"
          className="text-button"
          onClick={() => setAttempt((v) => v + 1)}
        >
          Retry
        </button>
      </div>
      <div className="microphone-meter-scale">
        <span>−60 dB</span>
        <span>−18</span>
        <span>−6</span>
        <span>0</span>
      </div>
      {showDiagnostics &&
        noiseOptions?.plugin.manifest.diagnostics
          ?.filter(
            (d) =>
              !d.variants?.length || d.variants.includes(noiseOptions.variant),
          )
          .map((d) => (
            <small key={d.key} className="noise-score">
              {d.label}: {scores?.[d.key]?.toFixed(3) ?? "—"}
            </small>
          ))}
      <div className="microphone-playback">
        <button
          type="button"
          className="secondary"
          disabled={!ready}
          aria-pressed={listening}
          onClick={() => {
            if (listening) {
              stopListening();
              return;
            }
            const version = ++playbackGeneration.current;
            setPlaybackError("");
            setListening(true);
            void Promise.resolve(onListeningChange?.(true))
              .then(() => {
                if (version !== playbackGeneration.current) return;
                return playback.current!.play();
              })
              .catch(() => {
                if (version !== playbackGeneration.current) return;
                setListening(false);
                onListeningChange?.(false);
                setPlaybackError(
                  "Could not play your microphone. Check the output device and try again.",
                );
              });
          }}
        >
          {listening ? "Stop listening" : "Listen to microphone"}
        </button>
        <small className="muted">
          Hear your microphone after noise suppression and gain. Use headphones
          to avoid feedback. Stops when you leave these settings.
        </small>
        {playbackError && <small role="status">{playbackError}</small>}
      </div>
    </div>
  );
}
