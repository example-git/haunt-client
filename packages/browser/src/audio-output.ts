import { getPreferences, subscribePreferences } from "./preferences";

type Sink = { setSinkId?: (id: string) => Promise<void> };
export const supportsAudioOutput = () =>
  typeof HTMLMediaElement !== "undefined" &&
  typeof HTMLMediaElement.prototype.setSinkId === "function";

/** Follow the local preference without restarting media. Serialize switches so
 * an older device request cannot win a race with a newer selection. The media
 * sink/browser resamples to the output device's clock (e.g. 44.1 or 48 kHz).
 * Do not change Opus's 48 kHz RTP clock or relabel PCM when switching devices. */
export function followAudioOutput(playback: Sink | AudioContext) {
  const target = playback as Sink;
  let disposed = false;
  let revision = 0;
  let previous: string | undefined;
  let queue = Promise.resolve();
  const update = (force = false) => {
    const id = getPreferences().audioOutput;
    if (!force && id === previous) return;
    previous = id;
    const version = ++revision;
    queue = queue.then(async () => {
      if (disposed || version !== revision || !target.setSinkId) return;
      try {
        await target.setSinkId(id);
      } catch {
        // Unplugging/revoking a device must not leave a call silent. Keep its
        // saved ID so plugging it back in restores the user's choice.
        if (!disposed && version === revision)
          await target.setSinkId("").catch(() => {});
      }
    });
  };
  const changed = () => update(true);
  const unsubscribe = subscribePreferences(() => update());
  navigator.mediaDevices?.addEventListener("devicechange", changed);
  update();
  return () => {
    disposed = true;
    unsubscribe();
    navigator.mediaDevices?.removeEventListener("devicechange", changed);
  };
}

export async function selectAudioOutput() {
  const devices = navigator.mediaDevices as MediaDevices & {
    selectAudioOutput?: (options: {
      deviceId: string;
    }) => Promise<MediaDeviceInfo>;
  };
  return devices?.selectAudioOutput?.({
    deviceId: getPreferences().audioOutput,
  });
}
export const canSelectAudioOutput = () =>
  !!(navigator.mediaDevices as MediaDevices & { selectAudioOutput?: unknown })
    ?.selectAudioOutput;
