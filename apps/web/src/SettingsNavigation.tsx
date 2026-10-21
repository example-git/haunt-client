import { useId, useState } from "react";
import {
  ArchiveRestore,
  AudioLines,
  Bell,
  ChevronDown,
  Cloud,
  Download,
  HardDrive,
  Hash,
  KeyRound,
  Palette,
  Plug,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  ShieldOff,
  Smile,
  Speech,
  Ticket,
  UserRound,
  Users,
  ScrollText,
  X,
  type LucideIcon,
} from "lucide-react";
import "./settings.css";

const icons: Record<string, LucideIcon> = {
  profile: UserRound,
  account: KeyRound,
  invites: Ticket,
  appearance: Palette,
  overview: Palette,
  notifications: Bell,
  devices: AudioLines,
  "audio-plugins": Plug,
  narrator: Speech,
  backups: ArchiveRestore,
  sync: Cloud,
  updates: Download,
  "server-extensions": Plug,
  configuration: Settings2,
  storage: HardDrive,
  emojis: Smile,
  channels: Hash,
  roles: ShieldCheck,
  members: Users,
  bans: ShieldOff,
  audit: ScrollText,
};
const keywords: Record<string, string> = {
  narrator: "voice tts speech announcements",
  devices: "microphone speaker camera voice video",
  "audio-plugins": "noise suppression voice",
  "server-extensions": "extensions tts speech credentials",
  account: "password login sessions",
  appearance: "theme colors size font",
};
const voicePages = new Set(["devices", "audio-plugins", "narrator"]);
const accountPages = new Set(["profile", "account", "invites"]);
const peoplePages = new Set(["roles", "members", "bans", "audit"]);
const systemPages = new Set([
  "configuration",
  "storage",
  "audio-plugins",
  "server-extensions",
]);

export function SettingsNavigation({
  items,
  selected,
  onSelect,
  scope,
  kind = "account",
}: {
  items: ReadonlyArray<readonly [string, string]>;
  selected?: string;
  onSelect: (id: string) => void;
  scope: string;
  kind?: "account" | "device" | "server";
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [mobileOpen, setMobileOpen] = useState(false);
  const term = query.trim().toLocaleLowerCase();
  const groups =
    kind === "server"
      ? ["Community", "People & access", "Server"]
      : [
          ...(kind === "account" ? ["Your account"] : []),
          "Voice & audio",
          "This device",
        ];
  const groupFor = (page: string) =>
    kind === "server"
      ? peoplePages.has(page)
        ? "People & access"
        : systemPages.has(page)
          ? "Server"
          : "Community"
      : accountPages.has(page)
        ? "Your account"
        : voicePages.has(page)
          ? "Voice & audio"
          : "This device";
  const visible = items.filter(([page, label]) =>
    `${label} ${keywords[page] ?? ""}`.toLocaleLowerCase().includes(term),
  );
  return (
    <nav
      className="settings-nav"
      aria-label={`${kind === "server" ? "Server" : "User"} settings sections`}
    >
      <button
        className="settings-nav-toggle"
        aria-label="Browse settings"
        aria-expanded={mobileOpen}
        aria-controls={`${id}-navigation`}
        onClick={() => setMobileOpen(!mobileOpen)}
      >
        <Settings2 size={16} aria-hidden="true" />
        <span>
          {items.find(([page]) => page === selected)?.[1] ?? "Browse settings"}
        </span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      <div
        id={`${id}-navigation`}
        className={`settings-nav-body${mobileOpen ? " is-open" : ""}`}
      >
        <div className="settings-scope" title={scope}>
          <Server size={14} aria-hidden="true" />
          <span>{scope}</span>
        </div>
        <div className="settings-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            aria-label="Search settings"
            placeholder="Find a setting…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button
              className="icon"
              aria-label="Clear settings search"
              onClick={() => setQuery("")}
            >
              <X size={13} aria-hidden="true" />
            </button>
          )}
        </div>
        {groups.map((group, index) => {
          const pages = visible.filter(([page]) => groupFor(page) === group);
          if (!pages.length) return null;
          const expanded = !!term || !collapsed[group];
          return (
            <section className="settings-nav-group" key={group}>
              <button
                className="settings-group-toggle"
                aria-label={`${group} sections`}
                aria-expanded={expanded}
                aria-controls={`${id}-group-${index}`}
                onClick={() => {
                  if (term) setQuery("");
                  setCollapsed({ ...collapsed, [group]: expanded });
                }}
              >
                <span>{group}</span>
                <ChevronDown size={13} aria-hidden="true" />
              </button>
              <div id={`${id}-group-${index}`} hidden={!expanded}>
                {pages.map(([page, label]) => {
                  const Icon = icons[page] ?? Settings2;
                  return (
                    <button
                      key={page}
                      className={`settings-nav-item${selected === page ? " active" : ""}`}
                      aria-current={selected === page ? "page" : undefined}
                      title={label}
                      onClick={() => {
                        onSelect(page);
                        setMobileOpen(false);
                      }}
                    >
                      <Icon size={16} aria-hidden="true" />
                      <span>{label}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
        {!visible.length && (
          <p className="settings-search-empty" role="status">
            No matching settings.
          </p>
        )}
      </div>
    </nav>
  );
}
