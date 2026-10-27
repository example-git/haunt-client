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
  friendlyError,
  safeExternalURL,
  providerPlayer,
  type InstanceClient,
  type Message,
  type Schemas,
} from "@haunt/core";
import {
  attachmentMetadata,
  attachmentMedia,
  messageEmbeds,
  previewImage,
  previewVideo,
  clientPost,
  type Embed,
} from "@haunt/browser/embeds";
import { providerAsset, directPostImage } from "@haunt/browser/provider-posts";

import { ImagePreview } from "./ImageViewer";
import { MediaControls } from "./MediaControls";
import { saveMedia } from "@haunt/browser/downloads";
import { hauntLink } from "@haunt/browser/deep-links";

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
  const [linkError, setLinkError] = useState("");
  const internal = hauntLink(href);
  const safe = safeExternalURL(href) || internal;
  if (!safe) return <span>{children}</span>;
  return (
    <>
      <a
        className={className}
        href={safe}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => {
          if (window.hauntDesktop) {
            event.preventDefault();
            setLinkError("");
            const task = internal
              ? (window.hauntDesktop.links?.open(safe) ??
                Promise.reject(Error("Update Haunt to open desktop links.")))
              : window.hauntDesktop.openExternal(safe);
            void task.catch((error) => setLinkError(friendlyError(error)));
          }
        }}
      >
        {children}
      </a>
      {linkError && (
        <span role="alert" className="error">
          {linkError}
        </span>
      )}
    </>
  );
}
function NativePostVideo({
  source,
  poster,
  hls,
  onFailure,
}: {
  source: string;
  poster?: string;
  hls: boolean;
  onFailure: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const failure = useRef(onFailure);
  failure.current = onFailure;
  useEffect(() => {
    const video = ref.current!;
    const releaseOutput = followAudioOutput(video);
    let disposed = false;
    let destroy: (() => void) | undefined;
    if (!hls) {
      video.src = source;
    } else {
      void import("hls.js")
        .then(({ default: Hls, FetchLoader }) => {
          if (disposed) return;
          if (Hls.isSupported()) {
            const player = new Hls({
              loader: FetchLoader,
              maxBufferLength: 30,
              backBufferLength: 15,
              capLevelToPlayerSize: true,
              async fetchSetup(context, init) {
                const url = providerAsset("bluesky", context.url, true);
                if (!url) throw Error("Invalid Bluesky video source");
                return new Request(url, {
                  ...init,
                  credentials: "omit",
                  redirect: "error",
                  referrerPolicy: "no-referrer",
                });
              },
            });
            destroy = () => player.destroy();
            player.on(Hls.Events.ERROR, (_event, data) => {
              if (data.fatal && !disposed) failure.current();
            });
            player.loadSource(source);
            player.attachMedia(video);
          } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
            video.src = source;
          } else failure.current();
        })
        .catch(() => {
          if (!disposed) failure.current();
        });
    }
    return () => {
      disposed = true;
      destroy?.();
      releaseOutput();
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [source, hls]);
  return (
    <>
      <video
        ref={ref}
        poster={poster}
        controls
        autoPlay
        playsInline
        crossOrigin="anonymous"
        preload="metadata"
        onError={() => failure.current()}
      />
      <MediaControls video={ref} source={source} downloadable={!hls} />
    </>
  );
}

function PostMedia({
  instance,
  message,
  embed,
  asset,
  avatar = false,
}: {
  instance: InstanceClient;
  message: Message;
  embed: Embed;
  asset?: number;
  avatar?: boolean;
}) {
  const media = asset === undefined ? undefined : embed.media?.[asset];
  const [image, setImage] = useState<string>(),
    [video, setVideo] = useState<string>(),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false),
    [attempt, setAttempt] = useState(0);
  const controller = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    let url: string | undefined;
    setError(false);
    setImage(undefined);
    setVideo(undefined);
    const direct = directPostImage(embed, asset, avatar);
    if (direct) setImage(direct);
    else if (avatar || !media || media.kind === "image" || media.poster)
      void previewImage(instance, message, embed.index, abort.signal, {
        asset,
        avatar,
        cacheKey: avatar
          ? embed.avatar_key
          : (media?.cache_key ?? embed.image_key),
        embed,
      })
        .then((blob) => {
          if (!abort.signal.aborted) {
            url = URL.createObjectURL(blob);
            setImage(url);
          }
        })
        .catch(() => {
          if (
            !abort.signal.aborted &&
            media?.kind !== "video" &&
            media?.kind !== "audio"
          )
            setError(true);
        });
    return () => {
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [
    instance,
    message.id,
    message.edited_at,
    embed.index,
    asset,
    avatar,
    attempt,
    embed,
  ]);
  if (avatar)
    return image ? (
      <img
        className="embed-avatar"
        src={image}
        alt=""
        referrerPolicy="no-referrer"
      />
    ) : null;
  if (media?.kind === "video" || media?.kind === "audio")
    return (
      <div className="embed-native-video">
        {video && media.kind === "audio" ? (
          <audio
            ref={(element) =>
              element ? followAudioOutput(element) : undefined
            }
            src={video}
            controls
            autoPlay
            crossOrigin="anonymous"
            preload="metadata"
            onError={() => {
              setVideo(undefined);
              setError(true);
            }}
          />
        ) : video ? (
          <NativePostVideo
            source={video}
            poster={image}
            hls={!!embed.local?.media[asset!]?.hls}
            onFailure={() => {
              setVideo(undefined);
              setError(true);
            }}
          />
        ) : (
          <button
            className="embed-play"
            disabled={busy}
            aria-label={
              busy
                ? `Loading ${media.kind}`
                : error
                  ? `Retry ${media.kind}`
                  : `Play ${media.kind}`
            }
            onClick={() => {
              const refresh = error;
              setBusy(true);
              setError(false);
              void previewVideo(
                instance,
                message,
                embed.index,
                asset!,
                controller.current!.signal,
                embed,
                refresh,
              )
                .then((url) => {
                  if (!controller.current?.signal.aborted) setVideo(url);
                })
                .catch(() => {
                  if (!controller.current?.signal.aborted) setError(true);
                })
                .finally(() => setBusy(false));
            }}
          >
            {image && (
              <img
                src={image}
                alt={media.alt || ""}
                referrerPolicy="no-referrer"
              />
            )}
            <span>
              <Play size={28} />
              {busy
                ? `Loading ${media.kind}…`
                : error
                  ? `Retry ${media.kind}`
                  : `Play ${media.kind}`}
            </span>
          </button>
        )}
      </div>
    );
  if (image)
    return (
      <ImagePreview className="embed-picture" label="Enlarge preview image">
        <img
          src={image}
          referrerPolicy="no-referrer"
          alt={media?.alt || embed.image_alt || "Post image"}
          onError={() => {
            setImage(undefined);
            setError(true);
          }}
        />
      </ImagePreview>
    );
  return (
    <div className="embed-media-status" role="status">
      {error ? (
        <button
          className="text-button"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Retry image
        </button>
      ) : (
        "Loading image…"
      )}
    </div>
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
  const player = providerPlayer(embed, location.hostname);
  useEffect(() => {
    if (!embed.image || embed.media?.length) return;
    const controller = new AbortController();
    let url: string | undefined;
    void previewImage(instance, message, embed.index, controller.signal, {
      cacheKey: embed.image_key,
    })
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
        {embed.provider && (
          <div className="embed-post-author">
            {embed.avatar && (
              <PostMedia
                instance={instance}
                message={message}
                embed={embed}
                avatar
              />
            )}
            <span>
              <strong>{embed.author_name}</strong>
              {embed.author_handle && <span>{embed.author_handle}</span>}
            </span>
          </div>
        )}
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
            {!embed.provider && embed.author_name && (
              <span>{embed.author_name}</span>
            )}
            {!embed.provider &&
              embed.author_name &&
              Number.isFinite(published) &&
              " · "}
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
      {embed.media?.length ? (
        <div
          className={`embed-gallery ${embed.media.length > 1 ? "embed-gallery-multiple" : ""}`}
        >
          {embed.media.map((_, asset) => (
            <PostMedia
              key={asset}
              instance={instance}
              message={message}
              embed={embed}
              asset={asset}
            />
          ))}
        </div>
      ) : player && playing ? (
        <div
          className={`embed-player ${embed.player?.startsWith("twitch-") ? "embed-twitch" : ""}`}
        >
          <iframe
            title={embed.title || "Embedded video"}
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
          aria-label={`Play ${embed.site_name || "embedded"} video: ${embed.title || host}`}
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
  const eligible = messageLinks(message.body).some(
    (link) => link.preview && (supported || clientPost(link.url)),
  );
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
      {embeds.map((embed) =>
        embed.status === "unavailable" ? (
          <div className="embed-error" key={embed.url}>
            <ExternalLink href={embed.url}>Preview unavailable</ExternalLink>
            <button
              className="text-button"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Retry
            </button>
          </div>
        ) : (
          <PreviewCard
            key={embed.url}
            instance={instance}
            message={message}
            embed={embed}
          />
        ),
      )}
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
    [downloadError, setDownloadError] = useState(""),
    [data, setData] = useState<{ url: string; type: string }>(),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | undefined>(undefined),
    url = useRef<string | undefined>(undefined);
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(
    () => (videoRef.current ? followAudioOutput(videoRef.current) : undefined),
    [data],
  );
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
              <>
                <video
                  ref={videoRef}
                  className="attachment-image"
                  src={data.url}
                  controls
                  playsInline
                  preload="metadata"
                />
                <MediaControls
                  video={videoRef}
                  source={data.url}
                  downloadable={false}
                />
              </>
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
              onClick={(event) => {
                event.preventDefault();
                setDownloadError("");
                void saveMedia(data.url, meta?.filename || "attachment").catch(
                  (error) => setDownloadError(friendlyError(error)),
                );
              }}
            >
              <Download size={13} />
              {meta?.filename || "Download attachment"}
              {meta && <small>{sizeLabel(meta.bytes)}</small>}
            </a>
          )}
          {downloadError && (
            <p role="alert" className="error">
              {downloadError}
            </p>
          )}
        </>
      )}
    </div>
  );
}
