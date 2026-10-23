import type { NativeDevice } from "./native-types";

export interface VideoMode {
  width: number;
  height: number;
  fps: number;
}
export const screenHeights = [360, 480, 720, 1080, 1440, 2160];
export const frameRates = [15, 24, 25, 30, 50, 60, 90, 120, 144, 165, 180, 240];
export const defaultScreenMode: VideoMode = {
  width: 1920,
  height: 1080,
  fps: 60,
};
export function screenFrameRates(track?: MediaStreamTrack): number[] {
  const range = track?.getCapabilities?.().frameRate;
  if (!range) return [15, 30, 60];
  return [
    ...new Set([...frameRates, range.max, track?.getSettings().frameRate]),
  ]
    .filter(
      (fps): fps is number =>
        typeof fps === "number" &&
        Number.isFinite(fps) &&
        fps > 0 &&
        fps <= 1000 &&
        fps >= (range.min ?? 0) &&
        fps <= (range.max ?? 60),
    )
    .sort((a, b) => a - b);
}
export const modeKey = (mode: VideoMode) =>
  `${mode.width}x${mode.height}@${mode.fps}`;
export const validVideoMode = (mode: unknown): mode is VideoMode => {
  const value = mode as VideoMode | undefined;
  return (
    !!value &&
    Number.isInteger(value.width) &&
    value.width > 0 &&
    value.width <= 8192 &&
    Number.isInteger(value.height) &&
    value.height > 0 &&
    value.height <= 8192 &&
    Number.isFinite(value.fps) &&
    value.fps > 0 &&
    value.fps <= 1000
  );
};
export function preferredCameraMode(modes: VideoMode[]): VideoMode {
  const candidates = modes
    .filter(
      (mode) => mode.width <= 1920 && mode.height <= 1080 && mode.fps <= 60,
    )
    .sort((a, b) => b.width * b.height - a.width * a.height || b.fps - a.fps);
  if (!candidates.length)
    throw Error(
      "This camera has no supported mode at or below 1080p / 60 FPS. Choose an available mode.",
    );
  return candidates[0];
}
export function nativeCameraModes(device: NativeDevice): VideoMode[] {
  const modes = new Map<string, VideoMode>();
  for (const format of device.formats ?? []) {
    for (const fps of new Set([...frameRates, format.minFPS, format.maxFPS])) {
      const mode = { width: format.width, height: format.height, fps };
      if (validVideoMode(mode) && fps >= format.minFPS && fps <= format.maxFPS)
        modes.set(modeKey(mode), mode);
    }
  }
  return [...modes.values()].sort(
    (a, b) => a.width * a.height - b.width * b.height || a.fps - b.fps,
  );
}
export async function cameraModes(device: string): Promise<VideoMode[]> {
  if (
    typeof window !== "undefined" &&
    window.hauntDesktop?.nativeCaptureAvailable
  ) {
    const catalog = await window.hauntDesktop.nativeDevices(true);
    let camera = device
      ? catalog.cameras.find((item) => `swift:${item.id}` === device)
      : catalog.cameras[0];
    if (!camera && device && !device.startsWith("swift:")) {
      const browser = (await navigator.mediaDevices.enumerateDevices()).find(
        (item) => item.deviceId === device,
      );
      const matches = catalog.cameras.filter(
        (item) => item.label === browser?.label,
      );
      if (matches.length === 1) camera = matches[0];
    }
    if (!camera)
      throw Error(
        "The selected camera is unavailable. Choose a camera in Devices.",
      );
    const modes = nativeCameraModes(camera);
    if (!modes.length)
      throw Error("The camera did not report supported capture modes.");
    return modes;
  }
  return browserCameraModes(device);
}
export async function selectedCameraMode(
  device: string,
  saved?: VideoMode,
): Promise<VideoMode> {
  const modes = await cameraModes(device);
  if (!saved) return preferredCameraMode(modes);
  if (!modes.some((mode) => modeKey(mode) === modeKey(saved)))
    throw Error(
      `Saved camera mode ${saved.width}×${saved.height} at ${saved.fps} FPS is unavailable on this device.`,
    );
  return saved;
}
export function fitVideo(
  width: number,
  height: number,
  bound: VideoMode,
): VideoMode {
  const scale = Math.min(1, bound.width / width, bound.height / height);
  return {
    width: Math.max(2, Math.floor((width * scale) / 2) * 2),
    height: Math.max(2, Math.floor((height * scale) / 2) * 2),
    fps: bound.fps,
  };
}
export function exactVideoConstraints(mode: VideoMode): MediaTrackConstraints {
  return {
    width: { exact: mode.width },
    height: { exact: mode.height },
    frameRate: { exact: mode.fps },
  };
}
export function matchesVideoMode(
  settings: MediaTrackSettings,
  mode: VideoMode,
) {
  return (
    settings.width === mode.width &&
    settings.height === mode.height &&
    typeof settings.frameRate === "number" &&
    Math.abs(settings.frameRate - mode.fps) < 0.1
  );
}
export async function applyCameraMode(
  track: MediaStreamTrack,
  mode: VideoMode,
) {
  const original = track.getConstraints();
  try {
    await track.applyConstraints({
      ...original,
      ...exactVideoConstraints(mode),
    });
    if (!matchesVideoMode(track.getSettings(), mode))
      throw Error(
        "The camera did not provide the selected resolution and frame rate.",
      );
  } catch (error) {
    await track.applyConstraints(original);
    throw Error(
      `Camera mode ${mode.width}×${mode.height} at ${mode.fps} FPS is unavailable. ${error instanceof Error ? error.message : ""}`,
    );
  }
}

export async function applyScreenMode(
  track: MediaStreamTrack,
  mode: VideoMode,
) {
  const previous = track.getConstraints();
  try {
    await track.applyConstraints({
      ...previous,
      width: { max: mode.width },
      height: { max: mode.height },
      frameRate: { exact: mode.fps },
    });
    const actual = track.getSettings();
    if (
      !actual.width ||
      !actual.height ||
      actual.width > mode.width ||
      actual.height > mode.height ||
      Math.abs((actual.frameRate ?? 0) - mode.fps) > 0.1
    )
      throw Error(
        "The screen capture backend did not provide the selected settings.",
      );
  } catch (error) {
    await track.applyConstraints(previous);
    throw error;
  }
}

const cache = new Map<string, Promise<VideoMode[]>>();
let generation = 0;
export function invalidateCameraModes() {
  generation++;
  cache.clear();
}
if (typeof navigator !== "undefined")
  navigator.mediaDevices?.addEventListener?.(
    "devicechange",
    invalidateCameraModes,
  );
export function browserCameraModes(device: string): Promise<VideoMode[]> {
  const cached = cache.get(device);
  if (cached) return cached;
  const current = generation;
  const task = (async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: device ? { deviceId: { exact: device } } : true,
      audio: false,
    });
    const track = stream.getVideoTracks()[0];
    try {
      const capability = track.getCapabilities() as MediaTrackCapabilities & {
          resizeMode?: string[];
        },
        actual = track.getSettings();
      const dimensions = [
        [640, 360],
        [640, 480],
        [800, 600],
        [960, 540],
        [1280, 720],
        [1280, 960],
        [1920, 1080],
        [1920, 1440],
        [2560, 1440],
        [3840, 2160],
      ];
      if (actual.width && actual.height)
        dimensions.push([actual.width, actual.height]);
      if (capability.width?.max && capability.height?.max)
        dimensions.push([capability.width.max, capability.height.max]);
      const fpsValues = new Set([
        ...frameRates,
        actual.frameRate ?? 30,
        capability.frameRate?.max ?? 30,
      ]);
      const modes = new Map<string, VideoMode>();
      for (const [width, height] of dimensions) {
        if (
          width < (capability.width?.min ?? 0) ||
          width > (capability.width?.max ?? Infinity) ||
          height < (capability.height?.min ?? 0) ||
          height > (capability.height?.max ?? Infinity)
        )
          continue;
        for (const fps of fpsValues) {
          if (current !== generation)
            throw Error("Camera devices changed. Refresh available modes.");
          if (
            fps < (capability.frameRate?.min ?? 0) ||
            fps > (capability.frameRate?.max ?? Infinity)
          )
            continue;
          const mode = { width, height, fps };
          if (!validVideoMode(mode) || modes.has(modeKey(mode))) continue;
          try {
            await track.applyConstraints({
              deviceId: device ? { exact: device } : undefined,
              ...(capability.resizeMode?.includes("none")
                ? { resizeMode: { exact: "none" } }
                : {}),
              ...exactVideoConstraints(mode),
            });
            if (matchesVideoMode(track.getSettings(), mode))
              modes.set(modeKey(mode), mode);
          } catch (error) {
            if (
              !(error instanceof DOMException) ||
              error.name !== "OverconstrainedError"
            )
              throw error;
          }
        }
      }
      if (!modes.size)
        throw Error("This browser did not verify any camera modes.");
      return [...modes.values()].sort(
        (a, b) => a.width * a.height - b.width * b.height || a.fps - b.fps,
      );
    } finally {
      stream.getTracks().forEach((source) => source.stop());
    }
  })();
  cache.set(device, task);
  void task.catch(() => {
    if (cache.get(device) === task) cache.delete(device);
  });
  return task;
}
