import { openProfile } from "./Profile";
import { UserName } from "./UserName";
import { CaptureSettings, VideoSettings } from "./VideoSettings";
import { VoiceModerationMenu, VoiceRestrictions } from "./VoiceModeration";
import { createPortal } from "react-dom";
import { Titlebar } from "./Titlebar";
import { useCallWindow } from "./CallWindow";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import {
  ChevronDown,
  GripVertical,
  Maximize2,
  ExternalLink,
  PanelTopClose,
  Mic,
  MicOff,
  Headphones,
  HeadphoneOff,
  Video,
  MonitorUp,
  LogOut,
  Settings,
} from "lucide-react";
import { isAudioPurpose, friendlyError } from "@haunt/core";
import type { Call, CallSnapshot } from "@haunt/browser/media/call";
import {
  getVolumes,
  subscribeVolumes,
  playbackVolume,
} from "@haunt/browser/volumes";
import { ErrorNotice, VoiceChannelChat } from "./App";
import { Avatar, displayName, UserStatus } from "./People";
import { CallTimer } from "./CallTimer";
import { UserVolume } from "./UserVolume";
import { useFloatingCall } from "./FloatingCall";
import { useContextMenu, MenuAction } from "./ContextMenu";
import { useSpeaking } from "./Speaking";
import { VoiceLevel } from "./VoiceLevel";
import { VoiceChatToggle } from "./VoiceChatToggle";
import {
  followAudioOutput,
  supportsAudioOutput,
} from "@haunt/browser/audio-output";
import {
  getPreferences,
  setPreferences,
  subscribePreferences,
} from "@haunt/browser/preferences";
import type { NativeDevice } from "@haunt/browser/media/native-types";
import { audioActivityKey } from "@haunt/browser/media/speaking";
import type { AudioSource } from "@haunt/browser/volumes";

function Stream({
  stream,
  muted,
  video = false,
  label,
  volume = 1,
  call,
  participant,
  purpose = "audio",
  onPlaybackBlocked,
}: {
  stream: MediaStream;
  muted: boolean;
  video?: boolean;
  label: string;
  volume?: number;
  call?: Call;
  participant?: string;
  purpose?: AudioSource;
  onPlaybackBlocked?: (element: HTMLMediaElement, blocked: boolean) => void;
}) {
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => followAudioOutput(ref.current!), []);
  useEffect(() => {
    const el = ref.current!;
    let active = true;
    const blocked = (value: boolean) => {
      if (!active) return;
      setBlocked(value);
      onPlaybackBlocked?.(el, value);
    };
    const playing = () => blocked(false);
    el.addEventListener("playing", playing);
    el.srcObject = stream;
    blocked(false);
    void el.play().then(playing, (error: DOMException) => {
      // Replacing a source aborts its pending play promise. An old rejection
      // must not mark the replacement track as blocked after it starts playing.
      if (error.name !== "AbortError" && el.paused) blocked(true);
    });
    return () => {
      active = false;
      el.removeEventListener("playing", playing);
      onPlaybackBlocked?.(el, false);
      el.pause();
      el.srcObject = null;
    };
  }, [stream, onPlaybackBlocked]);
  useLayoutEffect(() => {
    if (ref.current) ref.current.volume = volume;
  }, [volume]);
  useEffect(() => {
    if (!call || !participant || video) return;
    const el = ref.current!;
    const off = call.speaking.observe(
      audioActivityKey(participant, purpose),
      stream,
      () => {
        const state = call.snapshot;
        const sender = state.participants.find(
          (p) => p.participant_id === participant,
        );
        return state.status === "connected" &&
          sender &&
          !(purpose === "audio"
            ? sender.state.muted
            : purpose === "camera_audio"
              ? sender.state.camera_off
              : sender.state.screen_off) &&
          !state.state.deafened &&
          !el.paused &&
          !el.muted &&
          el.readyState >= 2
          ? el.volume
          : 0;
      },
      purpose !== "audio",
    );
    const refresh = call.speaking.sample;
    for (const event of [
      "volumechange",
      "playing",
      "pause",
      "waiting",
      "ended",
    ])
      el.addEventListener(event, refresh);
    return () => {
      off();
      for (const event of [
        "volumechange",
        "playing",
        "pause",
        "waiting",
        "ended",
      ])
        el.removeEventListener(event, refresh);
    };
  }, [call, participant, purpose, stream, video]);
  return (
    <div className={video ? "media-stream" : "audio-track"}>
      {video ? (
        <video ref={ref} autoPlay playsInline muted={muted} />
      ) : (
        <audio ref={ref} autoPlay muted={muted} aria-label={label} />
      )}
      {blocked && !onPlaybackBlocked && (
        <button
          className="secondary"
          onClick={() => void ref.current?.play().catch(() => {})}
        >
          Play {label}
        </button>
      )}
    </div>
  );
}

type Tile = {
  id: string;
  participant: string;
  user: string;
  joinedAt: string;
  muted: boolean;
  purpose: "avatar" | "camera" | "screen";
  stream?: MediaStream;
  sourceAudio: boolean;
  local: boolean;
};
function CallTile({
  call,
  tile,
  focused,
  onFocus,
  context,
  style,
}: {
  call: Call;
  tile: Tile;
  style?: CSSProperties;
  focused: boolean;
  onFocus: () => void;
  context: ReturnType<ReturnType<typeof useContextMenu>>;
}) {
  const speaking = useSpeaking(call, tile.participant);
  const user = call.client.snapshot.users.find((u) => u.id === tile.user);
  const name = displayName(user);
  const label = tile.purpose === "screen" ? `${name} · screen` : name;
  const quality =
    call.snapshot.qualities[`${tile.participant}:${tile.purpose}`];
  const [qualityError, setQualityError] = useState("");
  return (
    <div
      className={`call-tile ${tile.stream ? "video-tile" : "avatar-tile"} ${focused ? "focused" : ""} ${speaking ? "speaking" : ""}`}
      data-tile-id={tile.id}
      data-participant={tile.participant}
      data-speaking={speaking}
      style={style}
      role={tile.stream ? "button" : "group"}
      tabIndex={0}
      aria-label={
        tile.stream
          ? `${focused ? "Shrink" : "Expand"} ${label} view`
          : `${name} voice tile`
      }
      aria-pressed={tile.stream ? focused : undefined}
      aria-haspopup="menu"
      {...context}
      onClick={(e) => {
        if (tile.stream && !(e.target as HTMLElement).closest("button, select"))
          onFocus();
      }}
      onKeyDown={(e) => {
        context.onKeyDown(e);
        if (
          tile.stream &&
          !e.defaultPrevented &&
          e.target === e.currentTarget &&
          (e.key === "Enter" || e.key === " ")
        ) {
          e.preventDefault();
          onFocus();
        }
      }}
    >
      <div className="call-tile-content">
        {tile.stream ? (
          <Stream stream={tile.stream} muted video label={label} />
        ) : (
          <div
            className="call-avatar"
            onDragStart={(event) => event.preventDefault()}
          >
            <Avatar instance={call.client} user={user} size="large" />
          </div>
        )}
        <div className="call-tile-label">
          <UserStatus instance={call.client} user={tile.user} />
          <button
            className="user-name"
            onClick={(e) => {
              e.stopPropagation();
              openProfile(call.client, tile.user);
            }}
          >
            <UserName instance={call.client} user={user} />
            {tile.purpose === "screen" ? " · screen" : ""}
          </button>
          <CallTimer joinedAt={tile.joinedAt} />
          {!tile.local &&
            tile.stream &&
            (quality?.layers.length ? (
              <label
                className="viewing-quality"
                onClick={(event) => event.stopPropagation()}
              >
                <span className="sr-only">Viewing quality for {label}</span>
                <select
                  aria-label={`Viewing quality for ${label}`}
                  value={quality.mode}
                  onChange={(event) => {
                    setQualityError("");
                    void call
                      .setViewingQuality(
                        tile.participant,
                        tile.purpose === "screen" ? "screen" : "camera",
                        event.target.value,
                      )
                      .catch((error) => setQualityError(friendlyError(error)));
                  }}
                >
                  <option value="auto">
                    Auto
                    {quality.current
                      ? ` · ${quality.layers.find((layer) => layer.id === quality.current)?.height ?? ""}p`
                      : ""}
                  </option>
                  {quality.mode !== "auto" &&
                    !quality.layers.some(
                      (layer) => layer.id === quality.mode,
                    ) && (
                      <option value={quality.mode} disabled>
                        Selected quality unavailable
                      </option>
                    )}
                  {quality.layers.map((layer) => (
                    <option key={layer.id} value={layer.id}>
                      {layer.width} × {layer.height} · {layer.fps} FPS
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <small>Single quality</small>
            ))}
          {tile.muted ? (
            <MicOff size={13} aria-label="Muted" />
          ) : speaking ? (
            <Mic size={13} className="speaking-mic" aria-label="Speaking" />
          ) : null}
        </div>
      </div>
      {(qualityError || quality?.error) && (
        <p className="error" role="alert">
          {qualityError || quality?.error}
        </p>
      )}
      <div className="call-tile-levels">
        {tile.purpose === "avatar" && (
          <div className="call-tile-level">
            <Mic size={10} aria-hidden="true" />
            <span aria-hidden="true">Mic</span>
            <VoiceLevel
              call={call}
              participant={tile.participant}
              name={name}
              local={tile.local}
            />
          </div>
        )}
        {tile.stream && (
          <div
            className="call-tile-level source-audio-level"
            title={
              tile.purpose === "camera" ? "Camera audio" : "Screen-share audio"
            }
          >
            {tile.purpose === "camera" ? (
              <Video size={10} aria-hidden="true" />
            ) : (
              <MonitorUp size={10} aria-hidden="true" />
            )}
            <VoiceLevel
              call={call}
              participant={tile.participant}
              name={name}
              purpose={
                tile.purpose === "camera" ? "camera_audio" : "screen_audio"
              }
              local={tile.local}
              available={tile.sourceAudio}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function CallTileMenu({
  call,
  tile,
  focused,
  onFocus,
  onProfile,
  onSettings,
  onError,
}: {
  call: Call;
  tile: Tile;
  focused: boolean;
  onFocus: () => void;
  onProfile: () => void;
  onSettings: () => void;
  onError: (error: string) => void;
}) {
  const state = useSyncExternalStore(call.subscribe, call.getSnapshot);
  const [captureSettings, setCaptureSettings] = useState(false);
  const participant = state.participants.find(
    (p) => p.participant_id === tile.participant,
  );
  const run = (task: Promise<unknown>) =>
    void task.catch((error) => onError(friendlyError(error)));
  if (tile.purpose === "avatar")
    return (
      <>
        <MenuAction onClick={onProfile}>View profile</MenuAction>
        {tile.local ? (
          <>
            <MenuAction
              disabled={
                state.status !== "connected" ||
                state.state.deafened ||
                state.restriction.muted ||
                state.restriction.deafened
              }
              onClick={() =>
                run(call.setState({ muted: !call.snapshot.state.muted }))
              }
            >
              {state.state.muted ? "Unmute microphone" : "Mute microphone"}
            </MenuAction>
            <MenuAction
              disabled={
                state.status !== "connected" || state.restriction.deafened
              }
              onClick={() =>
                run(call.setState({ deafened: !call.snapshot.state.deafened }))
              }
            >
              {state.state.deafened ? "Undeafen" : "Deafen"}
            </MenuAction>
            <MenuAction onClick={onSettings}>Audio & video settings</MenuAction>
          </>
        ) : (
          <>
            <UserVolume
              instance={call.client}
              user={tile.user}
              source="audio"
            />
            {participant && (
              <VoiceModerationMenu
                instance={call.client}
                channel={call.room}
                participant={participant}
                onError={onError}
              />
            )}
          </>
        )}
      </>
    );
  const purpose = tile.purpose;
  const camera = purpose === "camera";
  const label = camera ? "camera" : "screen share";
  const sources = tile.local
    ? state.local
    : state.remote.filter((source) => source.participant === tile.participant);
  const active = sources.some((source) => source.purpose === purpose);
  const audio = camera ? "camera_audio" : "screen_audio";
  const quality = state.qualities[`${tile.participant}:${purpose}`];
  return (
    <>
      <MenuAction disabled={!active} onClick={onFocus}>
        {focused ? "Shrink" : "Expand"} {label}
      </MenuAction>
      {tile.local ? (
        <>
          <button
            role="menuitem"
            aria-expanded={captureSettings}
            disabled={!active}
            onClick={() => setCaptureSettings(!captureSettings)}
          >
            {camera ? "Camera" : "Screen-share"} capture settings
          </button>
          {captureSettings && <VideoSettings purpose={purpose} call={call} />}
          <MenuAction
            danger
            disabled={!active || state.busy || state.status !== "connected"}
            onClick={() => {
              if (
                call.snapshot.local.some((source) => source.purpose === purpose)
              )
                run(call.toggleVideo(purpose));
            }}
          >
            {camera ? "Turn off camera" : "Stop sharing screen"}
          </MenuAction>
        </>
      ) : (
        <>
          {quality?.layers.length ? (
            <div role="group" aria-label="Viewing quality">
              <div className="context-menu-title">Viewing quality</div>
              {[
                { id: "auto", label: "Auto" },
                ...quality.layers.map((layer) => ({
                  id: layer.id,
                  label: `${layer.width} × ${layer.height} · ${layer.fps} FPS`,
                })),
              ].map((option) => (
                <MenuAction
                  key={option.id}
                  checked={quality.mode === option.id}
                  disabled={!active}
                  onClick={() =>
                    run(
                      call.setViewingQuality(
                        tile.participant,
                        purpose,
                        option.id,
                      ),
                    )
                  }
                >
                  {option.label}
                </MenuAction>
              ))}
            </div>
          ) : (
            <small>Single quality</small>
          )}
          {sources.some((source) => source.purpose === audio) && (
            <UserVolume
              instance={call.client}
              user={tile.user}
              source={audio}
            />
          )}
          <MenuAction onClick={onProfile}>View profile</MenuAction>
        </>
      )}
    </>
  );
}

function useTileGrid(
  tiles: Tile[],
  focused?: string,
  destination?: HTMLElement,
) {
  const ref = useRef<HTMLDivElement>(null);
  const [positions, setPositions] = useState<Record<string, CSSProperties>>({});
  const signature = tiles.map((tile) => tile.id).join("\n");
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      const gap = 8;
      const result: Record<string, CSSProperties> = {};
      const pack = (items: Tile[], availableHeight: number, top: number) => {
        if (!items.length) return 0;
        const ratio = (tile: Tile) => (tile.stream ? 16 / 9 : 1);
        const rowsAt = (size: number) => {
          const rows: Tile[][] = [[]];
          let used = 0;
          for (const tile of items) {
            const w = size * ratio(tile);
            if (used && used + gap + w > width + 0.01) {
              rows.push([]);
              used = 0;
            }
            rows[rows.length - 1].push(tile);
            used += (used ? gap : 0) + w;
          }
          return rows;
        };
        let low = 0;
        let high = Math.max(
          0,
          Math.min(availableHeight, width / Math.max(...items.map(ratio))),
        );
        for (let step = 0; step < 32; step++) {
          const mid = (low + high) / 2;
          const rows = rowsAt(mid);
          if (rows.length * mid + (rows.length - 1) * gap <= availableHeight)
            low = mid;
          else high = mid;
        }
        const rows = rowsAt(low);
        const usedHeight = rows.length * low + (rows.length - 1) * gap;
        let y = top + (availableHeight - usedHeight) / 2;
        for (const row of rows) {
          const usedWidth =
            row.reduce((sum, tile) => sum + low * ratio(tile), 0) +
            (row.length - 1) * gap;
          let x = (width - usedWidth) / 2;
          for (const tile of row) {
            result[tile.id] = {
              left: x,
              top: y,
              width: low * ratio(tile),
              height: low,
            };
            x += low * ratio(tile) + gap;
          }
          y += low + gap;
        }
        return usedHeight;
      };
      const media = tiles.filter((tile) => tile.stream);
      if (!media.length) pack(tiles, height, 0);
      else {
        const main = focused
          ? media.filter((tile) => tile.id === focused)
          : media;
        const below = tiles.filter((tile) => !main.includes(tile));
        const stripHeight = below.length ? pack(below, height * 0.28, 0) : 0;
        pack(below, stripHeight, height - stripHeight);
        pack(
          main,
          Math.max(0, height - stripHeight - (below.length ? gap : 0)),
          0,
        );
      }
      setPositions(result);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [signature, focused, destination]);
  return { ref, positions };
}

export function CallPanel({
  onSettings,
  call,
  target,
  onOpen,
  onClose,
}: {
  onSettings: () => void;
  call: Call;
  target: HTMLDivElement | null;
  onOpen: () => void;
  onClose: () => Promise<void>;
}) {
  const state = useSyncExternalStore(call.subscribe, call.getSnapshot);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(true);
  const [blockedAudio, setBlockedAudio] = useState<Set<HTMLMediaElement>>(
    () => new Set(),
  );
  const playbackBlocked = useCallback(
    (element: HTMLMediaElement, blocked: boolean) => {
      setBlockedAudio((current) => {
        if (current.has(element) === blocked) return current;
        const next = new Set(current);
        if (blocked) next.add(element);
        else next.delete(element);
        return next;
      });
    },
    [],
  );
  const resumeAudio = () => {
    // Start every blocked source in the same user gesture. Audio elements stay
    // in the main window even when the visual tiles are detached or collapsed.
    for (const element of blockedAudio) void element.play().catch(() => {});
  };
  const audioNotice = blockedAudio.size > 0 && (
    <button className="secondary call-audio-resume" onClick={resumeAudio}>
      Enable call audio
    </button>
  );
  useSyncExternalStore(subscribeVolumes, getVolumes);
  const menu = useContextMenu();
  const [focus, setFocus] = useState<string>();
  const tiles: Tile[] = [...state.participants]
    .sort(
      (a, b) =>
        a.joined_at.localeCompare(b.joined_at) ||
        a.participant_id.localeCompare(b.participant_id),
    )
    .flatMap((p) => {
      const sources =
        p.participant_id === state.participantId
          ? state.local
          : state.remote.filter((m) => m.participant === p.participant_id);
      const camera = sources.find((m) => m.purpose === "camera");
      const screen = sources.find((m) => m.purpose === "screen");
      const tile: Tile = {
        id: `${p.participant_id}:avatar`,
        participant: p.participant_id,
        user: p.user_id,
        joinedAt: p.joined_at,
        muted:
          p.participant_id === state.participantId
            ? state.state.muted
            : p.state.muted,
        purpose: "avatar",
        sourceAudio: false,
        local: p.participant_id === state.participantId,
      };
      return [
        tile,
        ...(camera
          ? [
              {
                ...tile,
                id: `${p.participant_id}:camera`,
                purpose: "camera" as const,
                stream: camera.stream,
                sourceAudio: sources.some((m) => m.purpose === "camera_audio"),
              },
            ]
          : []),
        ...(screen
          ? [
              {
                ...tile,
                id: `${p.participant_id}:screen`,
                purpose: "screen" as const,
                stream: screen.stream,
                sourceAudio: sources.some((m) => m.purpose === "screen_audio"),
              },
            ]
          : []),
      ];
    });
  const focused = tiles.some((tile) => tile.id === focus && tile.stream)
    ? focus
    : undefined;
  useEffect(() => {
    if (focus && !focused) setFocus(undefined);
  }, [focus, focused]);
  const popout = useCallWindow();
  const detached = !!popout.destination;
  const grid = useTileGrid(tiles, focused, popout.destination);
  const [frame, setFrame] = useState<CSSProperties>();
  const full = !!target || detached;
  const floating = useFloatingCall(!full);
  useLayoutEffect(() => {
    if (!target) return;
    const measure = () => {
      const box = target.getBoundingClientRect();
      setFrame({
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [target]);
  const action = (task: Promise<unknown>) =>
    void task.catch((e) => setError(friendlyError(e)));
  const options = (tile: Tile) =>
    menu(
      `${displayName(call.client.snapshot.users.find((user) => user.id === tile.user))} · ${tile.purpose === "avatar" ? "Voice" : tile.purpose === "camera" ? "Camera" : "Screen share"}`,
      <CallTileMenu
        key={tile.id}
        call={call}
        tile={tile}
        focused={focused === tile.id}
        onFocus={() =>
          setFocus((current) => (current === tile.id ? undefined : tile.id))
        }
        onProfile={() => {
          if (detached)
            void window.hauntDesktop?.windowControl("focus", "main");
          openProfile(call.client, tile.user);
        }}
        onSettings={settings}
        onError={setError}
      />,
    );
  const settings = () => {
    if (detached) void window.hauntDesktop?.windowControl("focus", "main");
    onSettings();
  };
  const room =
    call.client.snapshot.channels.find((c) => c.id === call.room)?.name ??
    "Voice room";
  const view = (
    <>
      <header
        {...(!full ? floating.move : {})}
        onPointerDown={(e) => {
          if (!full && !(e.target as HTMLElement).closest("button"))
            floating.move.onPointerDown(e);
        }}
      >
        {!full && (
          <button
            className="icon pip-move"
            aria-label="Move call window"
            title="Drag to move · Arrow keys to move"
            {...floating.move}
            onKeyDown={floating.moveKey}
          >
            <GripVertical size={16} />
          </button>
        )}
        <i
          className={`presence ${state.status === "connected" ? "online" : "connecting"}`}
        />
        <div>
          <strong>{room}</strong>
          <small>
            {call.client.account.instance.name} ·{" "}
            {state.status === "connected"
              ? `${state.participants.length} in the room`
              : state.status}
          </small>
        </div>
        <VoiceChatToggle
          instance={call.client}
          room={call.room}
          onOpen={full ? undefined : onOpen}
        />
        {window.hauntDesktop && (
          <button
            className="icon"
            aria-label={
              detached ? "Return call to main window" : "Pop out call"
            }
            title={
              detached ? "Return to main window" : "Open in separate window"
            }
            onClick={() => (detached ? popout.close() : action(popout.open()))}
          >
            {detached ? (
              <PanelTopClose size={18} />
            ) : (
              <ExternalLink size={18} />
            )}
          </button>
        )}
        {!full && (
          <button
            className="icon"
            aria-label="Open voice channel"
            onClick={onOpen}
          >
            <Maximize2 size={18} />
          </button>
        )}
        {!full && (
          <button
            className="icon"
            aria-label={expanded ? "Collapse call" : "Expand call"}
            onClick={() => setExpanded(!expanded)}
          >
            <ChevronDown size={20} />
          </button>
        )}
      </header>
      <ErrorNotice error={error || state.error} />
      {audioNotice}
      <div className="call-stage" ref={grid.ref} hidden={!full && !expanded}>
        <div
          className={`call-tiles ${focused ? "has-focus" : ""} ${tiles.some((tile) => tile.stream) ? "has-media" : ""}`}
        >
          {tiles.map((tile) => (
            <CallTile
              key={tile.id}
              call={call}
              tile={tile}
              style={grid.positions[tile.id]}
              focused={focused === tile.id}
              onFocus={() =>
                setFocus((current) =>
                  current === tile.id ? undefined : tile.id,
                )
              }
              context={options(tile)}
            />
          ))}
        </div>
      </div>
      {!full && expanded && (
        <button
          className="pip-resize"
          aria-label="Resize call window"
          title="Drag to resize · Arrow keys to resize"
          {...floating.resize}
          onKeyDown={floating.resizeKey}
        >
          <Maximize2 size={13} />
        </button>
      )}
      {full && (
        <CallControls
          call={call}
          state={state}
          action={action}
          onSettings={settings}
          onClose={onClose}
        />
      )}
    </>
  );
  return (
    <>
      {popout.destination &&
        createPortal(
          <>
            <Titlebar target="call">
              <span className="titlebar-name">
                {room} · {call.client.account.instance.name}
              </span>
            </Titlebar>
            <div className="call-popout-workspace">
              <section
                className="call-panel full native-popout"
                aria-label="Call"
              >
                {view}
              </section>
              <VoiceChannelChat instance={call.client} room={call.room} />
            </div>
          </>,
          popout.destination,
        )}
      <section
        className={`call-panel ${target ? "full" : "mini"} ${detached ? "detached" : ""}`}
        hidden={detached && !target}
        style={
          target
            ? frame
            : {
                ...floating.box,
                height: expanded ? floating.box.height : 64,
                right: "auto",
                bottom: "auto",
              }
        }
        aria-label="Call"
        data-noise-suppression={state.noiseSuppression}
        data-update-busy={state.status !== "ended"}
      >
        {detached ? (
          <div className="call-detached-notice">
            <ExternalLink size={28} />
            <strong>Voice view is in another window</strong>
            <div>
              <button
                className="secondary"
                onClick={() => action(popout.open())}
              >
                Show window
              </button>
              <button className="secondary" onClick={popout.close}>
                Return here
              </button>
            </div>
          </div>
        ) : (
          view
        )}
        {state.remote
          .filter((m) => isAudioPurpose(m.purpose))
          .map((m) => (
            <Stream
              key={`${m.participant}-${m.purpose}`}
              stream={m.stream}
              muted={state.state.deafened}
              volume={playbackVolume(
                call.client.scope,
                userID(m.participant),
                m.purpose,
              )}
              call={call}
              purpose={m.purpose as AudioSource}
              participant={m.participant}
              onPlaybackBlocked={playbackBlocked}
              label={`${name(m.participant)} · ${m.purpose}`}
            />
          ))}
      </section>
      <aside className="call-dock" aria-label="Current call controls">
        {audioNotice}
        <div className="call-dock-heading">
          <button
            className="call-dock-room"
            onClick={onOpen}
            title="Return to voice channel"
            aria-label={`Return to call in ${room}`}
          >
            <strong>
              <i
                className={`presence ${state.status === "connected" ? "online" : "connecting"}`}
              />
              {state.status === "connected"
                ? "Voice connected"
                : state.status === "ended"
                  ? "Call ended"
                  : "Connecting…"}
            </strong>
            <small>
              {room} · {call.client.account.instance.name}
            </small>
          </button>
          <CallTimer
            joinedAt={
              state.participants.find(
                (p) => p.participant_id === state.participantId,
              )?.joined_at
            }
          />
        </div>
        <CallControls
          call={call}
          state={state}
          action={action}
          onSettings={onSettings}
          showSettings={false}
          onClose={onClose}
        />
      </aside>
    </>
  );
}

function CallDeviceMenu({
  camera = false,
  outputFirst = false,
}: {
  camera?: boolean;
  outputFirst?: boolean;
}) {
  const prefs = useSyncExternalStore(subscribePreferences, getPreferences);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>();
  const [native, setNative] = useState<{
    cameras: NativeDevice[];
    audio: NativeDevice[];
  }>();
  const [error, setError] = useState("");
  const nativeCamera = camera && window.hauntDesktop?.nativeCaptureAvailable;
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const browser = await navigator.mediaDevices.enumerateDevices();
        if (active) setDevices(browser);
        if (nativeCamera) {
          const catalog = await window.hauntDesktop!.nativeDevices();
          if (active) setNative(catalog);
        }
      } catch (error) {
        if (active) setError(friendlyError(error));
      }
    };
    const changed = () => void refresh();
    changed();
    navigator.mediaDevices?.addEventListener("devicechange", changed);
    const off = window.hauntDesktop?.onNativeEvent?.((event) => {
      if (active && event.kind === "devices" && event.devices)
        setNative(event.devices);
    });
    return () => {
      active = false;
      off?.();
      navigator.mediaDevices?.removeEventListener("devicechange", changed);
    };
  }, [nativeCamera]);
  const fields = camera
    ? (["camera", "cameraAudio"] as const)
    : outputFirst
      ? (["audioOutput", "microphone"] as const)
      : (["microphone", "audioOutput"] as const);
  return (
    <>
      {fields.map((field) => {
        const label =
          field === "microphone"
            ? "Input device"
            : field === "audioOutput"
              ? "Output device"
              : field === "camera"
                ? "Camera"
                : "Camera audio source";
        const kind =
          field === "audioOutput"
            ? "audiooutput"
            : field === "camera"
              ? "videoinput"
              : "audioinput";
        const available = nativeCamera
          ? (field === "camera" ? native?.cameras : native?.audio)?.map(
              (device) => ({
                deviceId: `swift:${device.id}`,
                label: device.label,
              }),
            )
          : devices?.filter(
              (device) =>
                device.kind === kind &&
                device.deviceId &&
                device.deviceId !== "default",
            );
        const disabled = field === "audioOutput" && !supportsAudioOutput();
        return (
          <div key={field} role="group" aria-label={label}>
            <div className="context-menu-title">{label}</div>
            <MenuAction
              checked={!prefs[field]}
              disabled={disabled}
              onClick={() => setPreferences({ [field]: "" })}
            >
              {field === "cameraAudio" ? "None" : "System default"}
            </MenuAction>
            {prefs[field] &&
              available &&
              !available.some((device) => device.deviceId === prefs[field]) && (
                <MenuAction checked disabled onClick={() => {}}>
                  Saved device (unavailable)
                </MenuAction>
              )}
            {available?.map((device, index) => (
              <MenuAction
                key={device.deviceId}
                checked={prefs[field] === device.deviceId}
                disabled={disabled}
                onClick={() => setPreferences({ [field]: device.deviceId })}
              >
                {device.label || `${label} ${index + 1}`}
              </MenuAction>
            ))}
            {!available && !error && <small>Loading devices…</small>}
            {disabled && (
              <small>This browser uses your system output device.</small>
            )}
          </div>
        );
      })}
      {camera && <small>Camera changes apply when capture starts.</small>}
      <ErrorNotice error={error} />
    </>
  );
}

function CallControls({
  showSettings = true,
  call,
  state,
  action,
  onSettings,
  onClose,
}: {
  showSettings?: boolean;
  call: Call;
  state: CallSnapshot;
  action: (task: Promise<unknown>) => void;
  onSettings: () => void;
  onClose: () => Promise<void>;
}) {
  const menu = useContextMenu();
  return (
    <div
      className="call-controls"
      {...menu(
        "Call settings",
        <MenuAction onClick={onSettings}>Audio & video settings</MenuAction>,
      )}
    >
      <button
        className={state.state.muted ? "toggled" : ""}
        aria-haspopup="menu"
        {...menu("Audio devices", <CallDeviceMenu />)}
        aria-label={state.state.muted ? "Unmute microphone" : "Mute microphone"}
        aria-pressed={state.state.muted}
        disabled={
          state.status !== "connected" ||
          state.state.deafened ||
          state.restriction.muted
        }
        title={
          state.restriction.muted || state.restriction.deafened
            ? "A moderator has restricted your microphone in this channel"
            : state.state.deafened
              ? "Undeafen before enabling your microphone"
              : undefined
        }
        onClick={() => action(call.setState({ muted: !state.state.muted }))}
      >
        {state.state.muted ? <MicOff size={18} /> : <Mic size={18} />}
      </button>
      <button
        className={state.state.deafened ? "toggled" : ""}
        aria-haspopup="menu"
        {...menu("Audio devices", <CallDeviceMenu outputFirst />)}
        aria-label="Deafen"
        aria-pressed={state.state.deafened}
        disabled={
          state.status !== "connected" ||
          state.microphoneMonitoring ||
          state.restriction.deafened
        }
        title={
          state.restriction.deafened
            ? "A moderator has deafened you in this channel"
            : state.microphoneMonitoring
              ? "Stop microphone playback before undeafening"
              : undefined
        }
        onClick={() =>
          action(call.setState({ deafened: !state.state.deafened }))
        }
      >
        {state.state.deafened ? (
          <HeadphoneOff size={18} />
        ) : (
          <Headphones size={18} />
        )}
      </button>
      <div className="capture-control">
        <button
          className={!state.state.camera_off ? "toggled" : ""}
          aria-haspopup="menu"
          {...menu("Camera devices", <CallDeviceMenu camera />)}
          aria-label={
            state.state.camera_off ? "Turn on camera" : "Turn off camera"
          }
          disabled={state.busy || state.status !== "connected"}
          onClick={() => action(call.toggleVideo("camera"))}
        >
          <Video size={18} />
        </button>
        <CaptureSettings purpose="camera" call={call} />
      </div>
      <div className="capture-control">
        <button
          className={!state.state.screen_off ? "toggled" : ""}
          aria-label={
            state.state.screen_off ? "Share screen" : "Stop sharing screen"
          }
          disabled={state.busy || state.status !== "connected"}
          onClick={() => action(call.toggleVideo("screen"))}
        >
          <MonitorUp size={18} />
        </button>
        <CaptureSettings purpose="screen" call={call} />
      </div>
      {showSettings && (
        <button
          aria-label="Audio & video settings"
          aria-haspopup="menu"
          {...menu("Audio devices", <CallDeviceMenu />)}
          title="Audio & video settings"
          onClick={onSettings}
        >
          <Settings size={18} />
        </button>
      )}
      <VoiceRestrictions instance={call.client} channel={call.room} />
      <button
        className="leave"
        aria-label="Leave call"
        onClick={() => action(onClose())}
      >
        <LogOut size={18} />
      </button>
    </div>
  );
}
