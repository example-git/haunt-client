import { fitVideo, type VideoMode } from "./video-settings";

export interface VideoLayer extends VideoMode {
  id: string;
}
export interface ViewingQuality {
  mode: string;
  current: string;
  layers: VideoLayer[];
  error?: string;
}
export function videoLayers(mode: VideoMode): VideoLayer[] {
  const layers = [{ ...mode, id: "h" }];
  for (const [id, width, height, fps] of [
    ["m", 1280, 720, 30],
    ["l", 640, 360, 15],
  ] as const) {
    const lower = fitVideo(mode.width, mode.height, {
      width,
      height,
      fps: Math.min(mode.fps, fps),
    });
    if (
      !layers.some(
        (layer) =>
          layer.width === lower.width &&
          layer.height === lower.height &&
          layer.fps === lower.fps,
      )
    )
      layers.push({ ...lower, id });
  }
  return layers;
}
export class QualityController {
  private bad = 0;
  private good = 0;
  private switched = -Infinity;
  reset(now = -Infinity) {
    this.bad = 0;
    this.good = 0;
    this.switched = now;
  }
  sample(
    loss: number | undefined,
    drops: number | undefined,
    current: number,
    count: number,
    now: number,
  ) {
    const metrics = [loss, drops].filter(
      (value) => value !== undefined && Number.isFinite(value),
    );
    if (!metrics.length) {
      this.bad = 0;
      this.good = 0;
      return current;
    }
    const bad =
      (loss !== undefined && loss > 0.05) ||
      (drops !== undefined && drops > 0.1);
    const good =
      (loss === undefined || loss < 0.01) &&
      (drops === undefined || drops < 0.02);
    this.bad = bad ? this.bad + 1 : 0;
    this.good = good ? this.good + 2000 : 0;
    if (now - this.switched < 10_000) return current;
    if (this.bad >= 2 && current < count - 1) {
      this.reset(now);
      return current + 1;
    }
    if (this.good >= 20_000 && current > 0) {
      this.reset(now);
      return current - 1;
    }
    return current;
  }
}

export function incomingQuality(
  previous: RTCInboundRtpStreamStats | undefined,
  current: RTCInboundRtpStreamStats,
) {
  if (
    !previous ||
    previous.id !== current.id ||
    current.timestamp <= previous.timestamp
  )
    return {};
  const delta = (
    key: "packetsLost" | "packetsReceived" | "framesDecoded" | "framesDropped",
  ) => {
    const a = previous[key],
      b = current[key];
    return typeof a === "number" && typeof b === "number" && b >= a
      ? b - a
      : undefined;
  };
  const lost = delta("packetsLost"),
    received = delta("packetsReceived"),
    decoded = delta("framesDecoded"),
    dropped = delta("framesDropped");
  return {
    loss:
      lost !== undefined && received !== undefined && lost + received > 0
        ? lost / (lost + received)
        : undefined,
    drops:
      dropped !== undefined && decoded !== undefined && dropped + decoded > 0
        ? dropped / (dropped + decoded)
        : undefined,
  };
}
