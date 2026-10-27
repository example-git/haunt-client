import { useState, useEffect, type RefObject } from "react";
import { friendlyError } from "@haunt/core";
import { saveMedia } from "@haunt/browser/downloads";

const speeds = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
function savedSpeed() {
  try {
    const value = Number(localStorage.getItem("haunt-media-speed"));
    return speeds.includes(value) ? value : 1;
  } catch {
    return 1;
  }
}
export function MediaControls({
  video,
  source,
  downloadable = true,
}: {
  video: RefObject<HTMLVideoElement | null>;
  source: string;
  downloadable?: boolean;
}) {
  const [speed, setSpeed] = useState(savedSpeed),
    [error, setError] = useState("");
  useEffect(() => {
    const element = video.current;
    if (element) {
      element.defaultPlaybackRate = speed;
      element.playbackRate = speed;
    }
  }, [video, speed, source]);
  return (
    <div className="media-controls">
      <label>
        Speed{" "}
        <select
          aria-label="Playback speed"
          value={speed}
          onChange={(event) => {
            const value = Number(event.target.value);
            setSpeed(value);
            try {
              localStorage.setItem("haunt-media-speed", String(value));
            } catch {
              setError("Playback speed could not be saved on this device.");
            }
          }}
        >
          {speeds.map((value) => (
            <option key={value} value={value}>
              {value}×
            </option>
          ))}
        </select>
      </label>
      {document.pictureInPictureEnabled && (
        <button
          type="button"
          onClick={() => {
            setError("");
            const action =
              document.pictureInPictureElement === video.current
                ? document.exitPictureInPicture()
                : video.current?.requestPictureInPicture();
            void action?.catch((error) => setError(friendlyError(error)));
          }}
        >
          Picture in picture
        </button>
      )}
      {downloadable && (
        <a
          href={source}
          download="video.mp4"
          onClick={(event) => {
            event.preventDefault();
            setError("");
            void saveMedia(source, "video.mp4").catch((error) =>
              setError(friendlyError(error)),
            );
          }}
        >
          Save video
        </a>
      )}
      {error && (
        <span role="alert" className="error">
          {error}
        </span>
      )}
    </div>
  );
}

export function CopyImage({ source }: { source: string }) {
  const [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  return (
    <>
      <button
        type="button"
        className="viewer-control"
        aria-label="Copy image"
        title="Copy image"
        onClick={() => {
          setError("");
          setNotice("");
          void (async () => {
            const blob = await (
              await fetch(source, {
                credentials: "omit",
                referrerPolicy: "no-referrer",
                redirect: "error",
              })
            ).blob();
            {
              const image = await createImageBitmap(blob);
              try {
                const canvas = document.createElement("canvas");
                canvas.width = image.width;
                canvas.height = image.height;
                canvas.getContext("2d")!.drawImage(image, 0, 0);
                const png = await new Promise<Blob>((resolve, reject) =>
                  canvas.toBlob(
                    (value) =>
                      value
                        ? resolve(value)
                        : reject(Error("Image conversion failed.")),
                    "image/png",
                  ),
                );
                if (window.hauntDesktop?.copyImage)
                  await window.hauntDesktop.copyImage(
                    new Uint8Array(await png.arrayBuffer()),
                  );
                else
                  await navigator.clipboard.write([
                    new ClipboardItem({ "image/png": png }),
                  ]);
              } finally {
                image.close();
              }
            }
            setNotice("Image copied.");
          })().catch((error) => setError(friendlyError(error)));
        }}
      >
        Copy
      </button>
      {notice && <span role="status">{notice}</span>}
      {error && (
        <span role="alert" className="error">
          {error}
        </span>
      )}
    </>
  );
}
