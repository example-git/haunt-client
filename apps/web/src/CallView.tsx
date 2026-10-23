import { openProfile } from "./Profile";
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
import { followAudioOutput } from "@haunt/browser/audio-output";
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
  purpose: "camera" | "screen";
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
}: {
  call: Call;
  tile: Tile;
  focused: boolean;
  onFocus: () => void;
  context: ReturnType<ReturnType<typeof useContextMenu>>;
}) {
  const speaking = useSpeaking(call, tile.participant);
  const user = call.client.snapshot.users.find((u) => u.id === tile.user);
  const name = displayName(user);
  const label = tile.purpose === "screen" ? `${name} · screen` : name;
  return (
    <div
      className={`call-tile ${tile.stream ? "video-tile" : "avatar-tile"} ${focused ? "focused" : ""} ${speaking ? "speaking" : ""}`}
      data-tile-id={tile.id}
      data-participant={tile.participant}
      data-speaking={speaking}
      role="button"
      tabIndex={0}
      aria-label={`${focused ? "Shrink" : "Expand"} ${label} view`}
      aria-pressed={focused}
      {...context}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest("button")) onFocus();
      }}
      onKeyDown={(e) => {
        context.onKeyDown(e);
        if (
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
          <Avatar instance={call.client} user={user} size="large" />
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
            {label}
          </button>
          <CallTimer joinedAt={tile.joinedAt} />
          {tile.muted ? (
            <MicOff size={13} aria-label="Muted" />
          ) : speaking ? (
            <Mic size={13} className="speaking-mic" aria-label="Speaking" />
          ) : null}
        </div>
      </div>
      <div className="call-tile-levels">
        {tile.purpose === "camera" && !tile.stream && (
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

// Choose the largest equal 16:9 tiles that fit the available stage. This also
// handles a resized PiP; focus changes CSS placement, never media element keys.
function useTileGrid(count: number, destination?: HTMLElement) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !count) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      let best = { columns: 1, width: 0, height: 0, area: 0 };
      const gap = 8;
      for (let columns = 1; columns <= count; columns++) {
        const rows = Math.ceil(count / columns);
        const w = Math.max(
          1,
          Math.min(
            (width - gap * (columns - 1)) / columns,
            (((height - gap * (rows - 1)) / rows) * 16) / 9,
          ),
        );
        if (w * w > best.area)
          best = {
            columns,
            width: w * columns + gap * (columns - 1),
            height: ((w * 9) / 16) * rows + gap * (rows - 1),
            area: w * w,
          };
      }
      setStyle({
        "--tile-columns": best.columns,
        "--strip-count": Math.max(1, count - 1),
        "--grid-width": `${best.width}px`,
        "--grid-height": `${best.height}px`,
      } as CSSProperties);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [count, destination]);
  return { ref, style };
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
        id: `${p.participant_id}:camera`,
        participant: p.participant_id,
        user: p.user_id,
        joinedAt: p.joined_at,
        muted:
          p.participant_id === state.participantId
            ? state.state.muted
            : p.state.muted,
        purpose: "camera",
        stream: camera?.stream,
        sourceAudio: sources.some((m) => m.purpose === "camera_audio"),
        local: p.participant_id === state.participantId,
      };
      return screen
        ? [
            tile,
            {
              ...tile,
              id: `${p.participant_id}:screen`,
              purpose: "screen",
              stream: screen.stream,
              sourceAudio: sources.some((m) => m.purpose === "screen_audio"),
            },
          ]
        : [tile];
    });
  const focused = tiles.some((tile) => tile.id === focus) ? focus : undefined;
  useEffect(() => {
    if (focus && !focused) setFocus(undefined);
  }, [focus, focused]);
  const popout = useCallWindow();
  const detached = !!popout.destination;
  const grid = useTileGrid(tiles.length, popout.destination);
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
  const userID = (id: string) =>
    state.participants.find((p) => p.participant_id === id)?.user_id ?? "";
  const name = (id: string) =>
    displayName(call.client.snapshot.users.find((u) => u.id === userID(id)));
  const options = (id: string) =>
    menu(
      name(id),
      userID(id) === call.client.account.login.user.id ? (
        <>
          <MenuAction
            disabled={state.state.deafened}
            onClick={() => action(call.setState({ muted: !state.state.muted }))}
          >
            {state.state.muted ? "Unmute microphone" : "Mute microphone"}
          </MenuAction>
          <MenuAction onClick={settings}>Audio & video settings</MenuAction>
        </>
      ) : (
        <UserVolume instance={call.client} user={userID(id)} />
      ),
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
          className={`call-tiles ${focused ? "has-focus" : ""} ${tiles.length === 1 ? "single-tile" : ""}`}
          style={grid.style}
        >
          {tiles.map((tile) => (
            <CallTile
              key={tile.id}
              call={call}
              tile={tile}
              focused={focused === tile.id}
              onFocus={() =>
                setFocus((current) =>
                  current === tile.id ? undefined : tile.id,
                )
              }
              context={options(tile.participant)}
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
        aria-label={state.state.muted ? "Unmute microphone" : "Mute microphone"}
        aria-pressed={state.state.muted}
        disabled={state.status !== "connected" || state.state.deafened}
        title={
          state.state.deafened
            ? "Undeafen before enabling your microphone"
            : undefined
        }
        onClick={() => action(call.setState({ muted: !state.state.muted }))}
      >
        {state.state.muted ? <MicOff size={18} /> : <Mic size={18} />}
      </button>
      <button
        className={state.state.deafened ? "toggled" : ""}
        aria-label="Deafen"
        aria-pressed={state.state.deafened}
        disabled={state.status !== "connected" || state.microphoneMonitoring}
        title={
          state.microphoneMonitoring
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
      <button
        className={!state.state.camera_off ? "toggled" : ""}
        aria-label={
          state.state.camera_off ? "Turn on camera" : "Turn off camera"
        }
        disabled={state.busy || state.status !== "connected"}
        onClick={() => action(call.toggleVideo("camera"))}
      >
        <Video size={18} />
      </button>
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
      {showSettings && (
        <button
          aria-label="Audio & video settings"
          title="Audio & video settings"
          onClick={onSettings}
        >
          <Settings size={18} />
        </button>
      )}
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
