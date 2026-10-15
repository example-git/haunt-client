import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { InstanceClient } from "@haunt/core";
import { useArt } from "./People";
import {
  customEmojiGroup,
  emojiColumns,
  layoutEmojiGroups,
  loadEmojiRecents,
  rememberEmoji,
  searchEmojiGroups,
  type EmojiGroup,
  type PickerEmoji,
} from "@haunt/browser/emoji-picker";
import data from "./emoji-data.json";
import { StandardEmoji } from "./StandardEmoji";

const nativeGroups: EmojiGroup[] = (
  data as [string, [string, string, string][]][]
).map(([name, entries], index) => ({
  id: `native-${index}`,
  name,
  icon: ["😀", "👋", "🐻", "🍕", "🚗", "⚽", "💡", "🔣", "🏳️"][index],
  items: entries.map(([text, name, search]) => ({
    key: `unicode:${text}`,
    text,
    name,
    search,
  })),
}));

function PickerImage({
  instance,
  item,
}: {
  instance: InstanceClient;
  item: PickerEmoji;
}) {
  const emoji = item.emoji!;
  const url = useArt(instance, "emoji", emoji.version, emoji.id);
  return url ? (
    <img className="custom-emoji" src={url} alt="" />
  ) : (
    <span className="emoji-loading" aria-hidden="true">
      ·
    </span>
  );
}

export default function EmojiPicker({
  instance,
  onPick,
  onClose,
}: {
  instance: InstanceClient;
  onPick: (text: string) => void;
  onClose: () => void;
}) {
  const snapshot = useSyncExternalStore(
    instance.subscribe,
    instance.getSnapshot,
  );
  const [query, setQuery] = useState(""),
    [active, setActive] = useState(0),
    [hover, setHover] = useState<PickerEmoji>();
  const recentKey = `chatxo-emoji-recents:${instance.scope}`;
  const [recent, setRecent] = useState(() =>
    loadEmojiRecents(localStorage, recentKey),
  );
  const panel = useRef<HTMLDivElement>(null),
    scroller = useRef<HTMLDivElement>(null),
    input = useRef<HTMLInputElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 280 });
  const listID = useId();
  const groups = useMemo(() => {
    const all = [
      customEmojiGroup(snapshot.emojis, instance.account.instance.name),
      ...nativeGroups,
    ];
    const byKey = new Map(
      all.flatMap((group) =>
        group.items.map((item) => [item.key, item] as const),
      ),
    );
    const items = recent.flatMap((key) =>
      byKey.has(key) ? [byKey.get(key)!] : [],
    );
    return items.length
      ? [{ id: "recent", name: "Recently used", icon: "◷", items }, ...all]
      : all;
  }, [snapshot.emojis, instance, recent]);
  // The search index is prepared once per catalog, never per scroll or hover.
  const filtered = useMemo(
    () =>
      searchEmojiGroups(groups, query).filter(
        (group) => !query.trim() || group.id !== "recent",
      ),
    [groups, query],
  );
  const layout = useMemo(() => layoutEmojiGroups(filtered), [filtered]);
  const selected = Math.min(active, Math.max(0, layout.items.length - 1));
  const visible = layout.rows.filter(
    (row) =>
      row.top + row.height >= viewport.top - 42 &&
      row.top < viewport.top + viewport.height + 42,
  );
  const currentGroup = layout.rows.find(
    (row) => row.top + row.height > viewport.top,
  )?.group.id;
  const preview = hover ?? layout.items[selected];
  useEffect(() => {
    const document = panel.current!.ownerDocument;
    const outside = (event: PointerEvent) => {
      if (
        !panel.current?.contains(event.target as Node) &&
        !(event.target as Element).closest?.('[aria-label="Choose emoji"]')
      )
        onClose();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [onClose]);
  useEffect(() => {
    const element = scroller.current!;
    const resize = new ResizeObserver(() =>
      setViewport({ top: element.scrollTop, height: element.clientHeight }),
    );
    resize.observe(element);
    return () => resize.disconnect();
  }, []);
  const scrollTo = (top: number) => {
    const element = scroller.current!;
    element.scrollTop = top;
    setViewport({ top: element.scrollTop, height: element.clientHeight });
  };
  const select = (index: number) => {
    index = Math.max(0, Math.min(index, layout.items.length - 1));
    setActive(index);
    setHover(undefined);
    const top = layout.positions[index];
    if (top < viewport.top) scrollTo(top);
    else if (top + 42 > viewport.top + viewport.height)
      scrollTo(top + 42 - viewport.height);
  };
  const pick = (item: PickerEmoji) => {
    setRecent(rememberEmoji(localStorage, recentKey, recent, item.key));
    onPick(item.text);
  };
  return (
    <div
      ref={panel}
      className="emoji-picker"
      role="dialog"
      aria-label="Emoji picker"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
          return;
        }
        if (event.target !== input.current) return;
        const moves: Record<string, number> = {
          ArrowDown: 1,
          ArrowUp: -1,
          PageDown: emojiColumns * 5,
          PageUp: -emojiColumns * 5,
        };
        if (event.key in moves && layout.items.length) {
          event.preventDefault();
          select(selected + moves[event.key]);
        }
        if (event.key === "Enter" && layout.items[selected]) {
          event.preventDefault();
          pick(layout.items[selected]);
        }
      }}
    >
      <div className="panel-title">
        <strong>Emojis</strong>
        <button
          type="button"
          className="icon"
          aria-label="Close emoji picker"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <input
        ref={input}
        autoFocus
        role="combobox"
        aria-expanded="true"
        aria-controls={listID}
        aria-activedescendant={
          layout.items[selected] &&
          visible.some(
            (row) =>
              selected >= row.start && selected < row.start + row.items.length,
          )
            ? `${listID}-${selected}`
            : undefined
        }
        aria-label="Search emojis"
        placeholder="Search emojis"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setHover(undefined);
          scrollTo(0);
        }}
      />
      <nav className="emoji-categories" aria-label="Emoji categories">
        {groups
          .filter((group) => group.items.length)
          .map((group) => (
            <button
              key={group.id}
              type="button"
              aria-label={group.id === "server" ? "Server emojis" : group.name}
              title={group.name}
              aria-pressed={!query && currentGroup === group.id}
              onClick={() => {
                const next = layoutEmojiGroups(
                  groups.filter((group) => group.items.length),
                );
                const row = next.rows.find((row) => row.group.id === group.id)!;
                setQuery("");
                setActive(row.start);
                setHover(undefined);
                // Search may have shortened the scroll area; position after the new layout commits.
                requestAnimationFrame(() => {
                  scrollTo(row.top);
                  input.current?.focus();
                });
              }}
            >
              <StandardEmoji text={group.icon} />
            </button>
          ))}
      </nav>
      <div
        ref={scroller}
        className="emoji-scroll"
        onScroll={(event) =>
          setViewport({
            top: event.currentTarget.scrollTop,
            height: event.currentTarget.clientHeight,
          })
        }
      >
        <div
          id={listID}
          role="listbox"
          aria-label="Emojis"
          style={{ height: layout.height, position: "relative" }}
        >
          {visible.map((row) =>
            row.items.length ? (
              <div
                className="emoji-grid-row"
                key={`${row.group.id}-${row.top}`}
                style={{ top: row.top }}
                role="presentation"
              >
                {row.items.map((item, offset) => (
                  <button
                    type="button"
                    key={item.key}
                    id={`${listID}-${row.start + offset}`}
                    role="option"
                    aria-label={`Insert :${item.name}:`}
                    aria-selected={selected === row.start + offset}
                    aria-posinset={row.start + offset + 1}
                    aria-setsize={layout.items.length}
                    tabIndex={-1}
                    title={`:${item.name}:`}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setHover(item)}
                    onMouseLeave={() => setHover(undefined)}
                    onClick={() => pick(item)}
                  >
                    {item.emoji ? (
                      <PickerImage instance={instance} item={item} />
                    ) : (
                      <StandardEmoji text={item.text} />
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <div
                className="emoji-group-title"
                role="presentation"
                key={row.group.id}
                style={{ top: row.top }}
              >
                {row.group.name}
              </div>
            ),
          )}
        </div>
        {!layout.items.length && (
          <p className="muted small">No matching emojis.</p>
        )}
      </div>
      <div className="emoji-preview" aria-hidden="true">
        {preview && (
          <>
            <span>
              {preview.emoji ? (
                <PickerImage instance={instance} item={preview} />
              ) : (
                <StandardEmoji text={preview.text} />
              )}
            </span>
            <strong>:{preview.name}:</strong>
          </>
        )}
      </div>
    </div>
  );
}
