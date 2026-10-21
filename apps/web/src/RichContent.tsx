import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { followAudioOutput } from "@haunt/browser/audio-output";
import {
  ExternalLink as LinkIcon,
  FileImage,
  FileVideo,
  Play,
  X,
  Download,
  EyeOff,
  RefreshCw,
} from "lucide-react";
import {
  messageLinks,
  safeExternalURL,
  youtubePlayer,
  type InstanceClient,
  type Message,
  type Schemas,
} from "@haunt/core";
import {
  attachmentMetadata,
  attachmentMedia,
  messageEmbeds,
  previewImage,
  type Embed,
} from "@haunt/browser/embeds";

import { ImagePreview } from "./ImageViewer";

let visibilityObserver: IntersectionObserver | undefined;
const visibilityCallbacks = new WeakMap<Element, () => void>();
function useVisible(enabled = true) {
  const ref = useRef<HTMLDivElement>(null),
    [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    visibilityObserver ??= new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) {
            visibilityCallbacks.get(entry.target)?.();
            visibilityObserver!.unobserve(entry.target);
            visibilityCallbacks.delete(entry.target);
          }
      },
      { rootMargin: "200px" },
    );
    visibilityCallbacks.set(element, () => setVisible(true));
    visibilityObserver.observe(element);
    return () => {
      visibilityObserver!.unobserve(element);
      visibilityCallbacks.delete(element);
    };
  }, [enabled]);
  return { ref, visible };
}
export function ExternalLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  const safe = safeExternalURL(href);
  if (!safe) return <span>{children}</span>;
  return (
    <a
      className={className}
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => {
        if (window.hauntDesktop) {
          event.preventDefault();
          void window.hauntDesktop.openExternal(safe).catch(() => {});
        }
      }}
    >
      {children}
    </a>
  );
}
function PreviewCard({
  instance,
  message,
  embed,
}: {
  instance: InstanceClient;
  message: Message;
  embed: Embed;
}) {
  const [image, setImage] = useState<string>(),
    [playing, setPlaying] = useState(false);
  const player = youtubePlayer(embed.youtube_id ?? "");
  useEffect(() => {
    if (!embed.image) return;
    const controller = new AbortController();
    let url: string | undefined;
    void previewImage(instance, message, embed.index, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setImage(url);
      })
      .catch(() => {});
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [instance, message.id, message.edited_at, embed.index, embed.image]);
  let host = "";
  try {
    host = new URL(embed.url).hostname;
  } catch {
    return null;
  }
  const published = embed.published_at ? Date.parse(embed.published_at) : NaN;
  const theme = /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(embed.theme_color ?? "")
    ? embed.theme_color
    : undefined;
  return (
    <section
      className={`embed-card embed-${embed.kind}`}
      aria-label={`Link preview from ${host}`}
      style={
        {
          "--embed-accent": theme || "var(--accent)",
        } as CSSProperties
      }
    >
      <div className="embed-copy">
        <span className="embed-site">
          {embed.site_name ? `${embed.site_name} · ` : ""}
          {host}
        </span>
        {embed.title && (
          <ExternalLink className="embed-title" href={embed.url}>
            {embed.title}
          </ExternalLink>
        )}
        {embed.description && (
          <p className="embed-description">{embed.description}</p>
        )}
        {(embed.author_name || Number.isFinite(published)) && (
          <span className="embed-byline">
            {embed.author_name && <span>{embed.author_name}</span>}
            {embed.author_name && Number.isFinite(published) && " · "}
            {Number.isFinite(published) && (
              <time dateTime={embed.published_at}>
                {new Date(published).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </time>
            )}
          </span>
        )}
      </div>
      {player && playing ? (
        <div className="embed-player">
          <iframe
            title={embed.title || "YouTube video"}
            src={player}
            sandbox="allow-scripts allow-same-origin allow-presentation"
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
          <button
            className="icon embed-stop"
            aria-label="Close embedded video"
            onClick={() => setPlaying(false)}
          >
            <X size={16} />
          </button>
        </div>
      ) : player ? (
        <button
          className="embed-play"
          aria-label={`Play YouTube video: ${embed.title || host}`}
          onClick={() => setPlaying(true)}
        >
          {image && (
            <img
              src={image}
              alt={embed.image_alt || ""}
              onError={() => setImage(undefined)}
            />
          )}
          <span>
            <Play size={28} fill="currentColor" /> Play video
          </span>
        </button>
      ) : image ? (
        <ImagePreview className="embed-picture" label="Enlarge preview image">
          <img
            src={image}
            alt={embed.image_alt || embed.title || "Link preview"}
            onError={() => setImage(undefined)}
          />
        </ImagePreview>
      ) : null}
      <ExternalLink className="embed-open" href={embed.url}>
        <LinkIcon size={12} /> Open {host}
      </ExternalLink>
    </section>
  );
}
export function MessageEmbeds({
  instance,
  message,
}: {
  instance: InstanceClient;
  message: Message;
}) {
  const supported =
    instance.account.instance.capabilities?.includes("messages.embeds");
  const eligible =
    !!supported && messageLinks(message.body).some((link) => link.preview);
  const { ref, visible } = useVisible(eligible),
    [embeds, setEmbeds] = useState<Embed[]>([]),
    [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
      "idle",
    ),
    [attempt, setAttempt] = useState(0),
    [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!visible || !eligible) return;
    const controller = new AbortController();
    setStatus("loading");
    void messageEmbeds(instance, message, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setEmbeds(value.slice(0, 3));
          setStatus("ready");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus("error");
      });
    return () => controller.abort();
  }, [visible, eligible, instance, message.id, message.edited_at, attempt]);
  if (!eligible) return null;
  if (hidden)
    return (
      <button
        type="button"
        className="embed-show text-button"
        onClick={() => setHidden(false)}
      >
        Show link previews
      </button>
    );
  return (
    <div className="message-embeds" ref={ref}>
      {status === "loading" && (
        <div className="embed-loading" role="status">
          <i />
          <span>Loading link preview…</span>
        </div>
      )}
      {status === "error" && (
        <div className="embed-error" role="status">
          <span>Link preview unavailable.</span>
          <button
            type="button"
            className="text-button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      )}
      {embeds.map((embed) => (
        <PreviewCard
          key={embed.url}
          instance={instance}
          message={message}
          embed={embed}
        />
      ))}
      {status === "ready" && embeds.length > 0 && (
        <button
          type="button"
          className="embed-hide text-button"
          onClick={() => setHidden(true)}
        >
          <EyeOff size={12} /> Hide previews
        </button>
      )}
    </div>
  );
}
const sizeLabel = (bytes: number) =>
  bytes >= 1048576
    ? `${(bytes / 1048576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
export function Attachment({
  instance,
  id,
}: {
  instance: InstanceClient;
  id: string;
}) {
  const { ref, visible } = useVisible(),
    [meta, setMeta] = useState<Schemas["AttachmentsAttachment"]>(),
    [data, setData] = useState<{ url: string; type: string }>(),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | undefined>(undefined),
    url = useRef<string | undefined>(undefined);
  const load = (signal: AbortSignal) => {
    if (busy || data) return;
    setBusy(true);
    setError(false);
    void attachmentMedia(instance, id, signal)
      .then((blob) => {
        if (signal.aborted) return;
        url.current = URL.createObjectURL(blob);
        setData({ url: url.current, type: blob.type });
      })
      .catch(() => {
        if (!signal.aborted) setError(true);
      })
      .finally(() => {
        if (!signal.aborted) setBusy(false);
      });
  };
  useEffect(() => {
    if (!visible) return;
    const abort = new AbortController();
    controller.current = abort;
    if (instance.account.instance.capabilities?.includes("messages.embeds"))
      void attachmentMetadata(instance, id, abort.signal)
        .then((value) => {
          if (abort.signal.aborted) return;
          setMeta(value);
          if (value.content_type.startsWith("image/") && value.bytes <= 2 << 20)
            load(abort.signal);
        })
        .catch(() => {
          if (!abort.signal.aborted) setError(true);
        });
    return () => {
      abort.abort();
      if (url.current) URL.revokeObjectURL(url.current);
    };
  }, [visible, instance, id]);
  return (
    <div className="attachment-card" ref={ref}>
      {error ? (
        <div className="attachment-expired">
          <p>Attachment unavailable or expired.</p>
          <button
            type="button"
            onClick={() =>
              controller.current && load(controller.current.signal)
            }
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          {data ? (
            data.type.startsWith("image/") ? (
              <ImagePreview
                className="attachment-picture"
                label={`Enlarge ${meta?.filename || "attachment"}`}
              >
                <img
                  className="attachment-image"
                  src={data.url}
                  alt={meta?.filename || "Message attachment"}
                />
              </ImagePreview>
            ) : data.type.startsWith("video/") ? (
              <video
                ref={(element) =>
                  element ? followAudioOutput(element) : undefined
                }
                className="attachment-image"
                src={data.url}
                controls
                playsInline
                preload="metadata"
              />
            ) : null
          ) : (
            <button
              className="attachment-button"
              disabled={busy}
              onClick={() =>
                controller.current && load(controller.current.signal)
              }
            >
              {meta?.content_type.startsWith("video/") ? (
                <FileVideo size={20} />
              ) : (
                <FileImage size={20} />
              )}
              <span>
                {busy
                  ? "Loading attachment…"
                  : meta?.filename || "Open attachment"}
                {meta && (
                  <small>
                    {sizeLabel(meta.bytes)}
                    {meta.content_type.startsWith("video/")
                      ? " · Open video"
                      : ""}
                  </small>
                )}
              </span>
            </button>
          )}
          {data && (
            <a
              className="attachment-caption"
              href={data.url}
              download={meta?.filename || "attachment"}
            >
              <Download size={13} />
              {meta?.filename || "Download attachment"}
              {meta && <small>{sizeLabel(meta.bytes)}</small>}
            </a>
          )}
        </>
      )}
    </div>
  );
}
