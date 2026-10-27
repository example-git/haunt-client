import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CopyImage } from "./MediaControls";
import { saveMedia } from "@haunt/browser/downloads";
import { ArrowLeft, ArrowRight, Download, Minus, Plus, X } from "lucide-react";

type Picture = { src: string; alt: string };
type Point = { x: number; y: number };
type View = Point & { scale: number };

/** A conversation's loaded image thumbnails form its gallery in message order. */
export function ImagePreview({
  className,
  label,
  children,
}: {
  className: string;
  label: string;
  children: ReactNode;
}) {
  const [gallery, setGallery] = useState<{
    pictures: Picture[];
    index: number;
  }>();
  return (
    <>
      <button
        type="button"
        className={`${className} image-preview-trigger`}
        aria-label={label}
        onClick={(event) => {
          const button = event.currentTarget;
          const scope = button.closest(".conversation-view");
          const buttons = scope
            ? [
                ...scope.querySelectorAll<HTMLButtonElement>(
                  ".image-preview-trigger",
                ),
              ]
            : [button];
          const pictures = buttons.flatMap((item) => {
            const img = item.querySelector("img");
            return img?.src ? [{ src: img.src, alt: img.alt }] : [];
          });
          const src = button.querySelector("img")?.src;
          const index = pictures.findIndex((picture) => picture.src === src);
          if (index >= 0) setGallery({ pictures, index });
        }}
      >
        {children}
      </button>
      {gallery && (
        <ImageViewer {...gallery} close={() => setGallery(undefined)} />
      )}
    </>
  );
}

function ImageViewer({
  pictures,
  index: initialIndex,
  close,
}: {
  pictures: Picture[];
  index: number;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(initialIndex);
  const [saveError, setSaveError] = useState("");
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  const dismiss = () => {
    dialog.current?.close();
    close();
  };
  const picture = pictures[index];
  const previous = index > 0 ? () => setIndex(index - 1) : undefined;
  const next =
    index < pictures.length - 1 ? () => setIndex(index + 1) : undefined;
  return createPortal(
    <dialog
      ref={dialog}
      className="image-viewer"
      aria-label="Image preview"
      onClick={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
    >
      <div className="viewer-actions">
        {saveError && <span role="alert">{saveError}</span>}
        <CopyImage key={picture.src} source={picture.src} />
        <a
          className="viewer-control"
          href={picture.src}
          download={picture.alt || "image"}
          aria-label="Download image"
          title="Download image"
          onClick={(event) => {
            event.preventDefault();
            setSaveError("");
            void saveMedia(picture.src, picture.alt || "image.png").catch(
              (error) => setSaveError(error.message),
            );
          }}
        >
          <Download size={19} />
        </a>
        <button
          autoFocus
          className="viewer-control"
          aria-label="Close image preview"
          title="Close (Esc)"
          onClick={dismiss}
        >
          <X size={20} />
        </button>
      </div>
      <ImageStage
        key={picture.src}
        picture={picture}
        dialog={dialog}
        previous={previous}
        next={next}
        close={dismiss}
      />
      {previous && (
        <button
          className="viewer-control viewer-previous"
          aria-label="Previous image"
          title="Previous image (←)"
          onClick={previous}
        >
          <ArrowLeft size={20} />
        </button>
      )}
      {next && (
        <button
          className="viewer-control viewer-next"
          aria-label="Next image"
          title="Next image (→)"
          onClick={next}
        >
          <ArrowRight size={20} />
        </button>
      )}
      <span className="sr-only" aria-live="polite">
        Image {index + 1} of {pictures.length}: {picture.alt}
      </span>
    </dialog>,
    document.body,
  );
}

function ImageStage({
  picture,
  dialog,
  previous,
  next,
  close,
}: {
  picture: Picture;
  dialog: React.RefObject<HTMLDialogElement | null>;
  previous?: () => void;
  next?: () => void;
  close: () => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [error, setError] = useState(false);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const current = useRef(view);
  const [dragging, setDragging] = useState(false);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<
    | { start: Point; moved: boolean; pinched: boolean; onImage: boolean }
    | undefined
  >(undefined);
  const fit = () => {
    const bounds = stage.current!.getBoundingClientRect();
    return Math.min(1, bounds.width / size.width, bounds.height / size.height);
  };
  const update = (value: View) => {
    const bounds = stage.current!.getBoundingClientRect();
    const scale = Math.max(Math.min(0.1, fit()), Math.min(8, value.scale));
    const maxX = Math.max(0, (size.width * scale - bounds.width) / 2);
    const maxY = Math.max(0, (size.height * scale - bounds.height) / 2);
    current.current = {
      scale,
      x: Math.max(-maxX, Math.min(maxX, value.x)),
      y: Math.max(-maxY, Math.min(maxY, value.y)),
    };
    setView(current.current);
  };
  const reset = () => update({ scale: fit(), x: 0, y: 0 });
  const zoom = (scale: number, point?: Point) => {
    if (!size.width) return;
    const old = current.current;
    const bounds = stage.current!.getBoundingClientRect();
    const x = point ? point.x - bounds.left - bounds.width / 2 : 0;
    const y = point ? point.y - bounds.top - bounds.height / 2 : 0;
    const clamped = Math.max(Math.min(0.1, fit()), Math.min(8, scale));
    update({
      scale: clamped,
      x: x - ((x - old.x) * clamped) / old.scale,
      y: y - ((y - old.y) * clamped) / old.scale,
    });
  };
  useEffect(() => {
    if (!size.width) return;
    const observer = new ResizeObserver(reset);
    observer.observe(stage.current!);
    reset();
    return () => observer.disconnect();
  }, [size]);
  useEffect(() => {
    const element = stage.current!;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      zoom(current.current.scale * Math.exp(-event.deltaY * 0.002), {
        x: event.clientX,
        y: event.clientY,
      });
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.altKey || event.metaKey || event.ctrlKey) return;
      if (event.key === "ArrowLeft") previous?.();
      else if (event.key === "ArrowRight") next?.();
      else if (event.key === "+" || event.key === "=")
        zoom(current.current.scale * 1.25);
      else if (event.key === "-") zoom(current.current.scale / 1.25);
      else if (event.key === "0" && size.width) reset();
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    element.addEventListener("wheel", wheel, { passive: false });
    const modal = dialog.current!;
    modal.addEventListener("keydown", keyboard);
    return () => {
      element.removeEventListener("wheel", wheel);
      modal.removeEventListener("keydown", keyboard);
    };
  }, [size, previous, next]);
  const release = (event: React.PointerEvent<HTMLDivElement>) => {
    const active = gesture.current;
    pointers.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (pointers.current.size) return;
    setDragging(false);
    if (
      event.type === "pointerup" &&
      active &&
      !active.pinched &&
      event.pointerType === "touch" &&
      current.current.scale <= fit() + 0.001
    ) {
      const dx = event.clientX - active.start.x;
      const dy = event.clientY - active.start.y;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 2) {
        if (dx > 0) previous?.();
        else next?.();
      }
    }
  };
  return (
    <>
      <div
        ref={stage}
        className={`viewer-stage${dragging ? " is-dragging" : ""}${size.width && view.scale > fit() ? " is-zoomed" : ""}`}
        onClick={(event) => {
          if (
            event.target === event.currentTarget &&
            !gesture.current?.moved &&
            !gesture.current?.onImage
          )
            close();
        }}
        onDoubleClick={(event) => {
          if (
            (event.target as HTMLElement).tagName !== "IMG" &&
            !gesture.current?.onImage
          )
            return;
          if (current.current.scale > fit() + 0.001) reset();
          else
            zoom(Math.max(1, fit() * 2), {
              x: event.clientX,
              y: event.clientY,
            });
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          gesture.current ??= {
            start: { x: event.clientX, y: event.clientY },
            moved: false,
            pinched: false,
            onImage: (event.target as HTMLElement).tagName === "IMG",
          };
          if (!pointers.current.size)
            gesture.current = {
              start: { x: event.clientX, y: event.clientY },
              moved: false,
              pinched: false,
              onImage: (event.target as HTMLElement).tagName === "IMG",
            };
          if (
            (event.target as HTMLElement).tagName !== "IMG" &&
            event.pointerType !== "touch"
          )
            return;
          event.currentTarget.setPointerCapture(event.pointerId);
          pointers.current.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY,
          });
          if (pointers.current.size > 1) gesture.current.pinched = true;
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const before = pointers.current.get(event.pointerId);
          if (!before || !size.width) return;
          const after = { x: event.clientX, y: event.clientY };
          const other = [...pointers.current.entries()].find(
            ([id]) => id !== event.pointerId,
          )?.[1];
          pointers.current.set(event.pointerId, after);
          if (
            gesture.current &&
            Math.hypot(
              after.x - gesture.current.start.x,
              after.y - gesture.current.start.y,
            ) > 4
          )
            gesture.current.moved = true;
          if (other) {
            const distance = Math.hypot(before.x - other.x, before.y - other.y);
            if (distance > 0)
              zoom(
                (current.current.scale *
                  Math.hypot(after.x - other.x, after.y - other.y)) /
                  distance,
                { x: (other.x + before.x) / 2, y: (other.y + before.y) / 2 },
              );
            update({
              ...current.current,
              x: current.current.x + (after.x - before.x) / 2,
              y: current.current.y + (after.y - before.y) / 2,
            });
          } else
            update({
              ...current.current,
              x: current.current.x + after.x - before.x,
              y: current.current.y + after.y - before.y,
            });
        }}
        onPointerUp={release}
        onPointerCancel={release}
      >
        {!size.width && !error && (
          <span className="viewer-status" role="status">
            Loading image…
          </span>
        )}
        {error ? (
          <span className="viewer-status" role="alert">
            This image could not be loaded.
          </span>
        ) : (
          <img
            className="viewer-image"
            src={picture.src}
            alt={picture.alt}
            draggable={false}
            onLoad={(event) =>
              setSize({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
            onError={() => setError(true)}
            style={{
              visibility: size.width ? "visible" : "hidden",
              width: size.width * view.scale,
              height: size.height * view.scale,
              transform: `translate(calc(-50% + ${view.x}px), calc(-50% + ${view.y}px))`,
            }}
          />
        )}
      </div>
      <div className="viewer-zoom" role="group" aria-label="Image zoom">
        <button
          className="viewer-control"
          aria-label="Zoom out"
          title="Zoom out (−)"
          disabled={
            !size.width || error || view.scale <= Math.min(0.1, fit()) + 0.001
          }
          onClick={() => zoom(view.scale / 1.25)}
        >
          <Minus size={18} />
        </button>
        <button
          className="viewer-scale"
          aria-label="Fit image to window"
          title="Fit to window (0)"
          disabled={!size.width || error}
          onClick={reset}
        >
          {Math.round(view.scale * 100)}%
        </button>
        <button
          className="viewer-control"
          aria-label="Zoom in"
          title="Zoom in (+)"
          disabled={!size.width || error || view.scale >= 8}
          onClick={() => zoom(view.scale * 1.25)}
        >
          <Plus size={18} />
        </button>
      </div>
    </>
  );
}
