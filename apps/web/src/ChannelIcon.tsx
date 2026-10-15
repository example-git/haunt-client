import {
  Hash,
  Headphones,
  MessageCircle,
  Megaphone,
  Volume2,
  Mic,
  Music,
  Radio,
  Gamepad2,
  Monitor,
  Video,
  Camera,
  Image,
  Film,
  Code,
  Terminal,
  BookOpen,
  GraduationCap,
  Coffee,
  Users,
  Calendar,
  Star,
  Heart,
  Shield,
  Wrench,
} from "lucide-react";

// Explicit imports keep the picker small; no dynamic icon-library lookup or assets.
const choices = [
  ["hash", "Text", Hash],
  ["headphones", "Headphones", Headphones],
  ["message-circle", "Conversation", MessageCircle],
  ["megaphone", "Announcements", Megaphone],
  ["volume-2", "Speaker", Volume2],
  ["mic", "Microphone", Mic],
  ["music", "Music", Music],
  ["radio", "Radio", Radio],
  ["gamepad-2", "Gaming", Gamepad2],
  ["monitor", "Desktop", Monitor],
  ["video", "Video", Video],
  ["camera", "Camera", Camera],
  ["image", "Pictures", Image],
  ["film", "Movies", Film],
  ["code", "Code", Code],
  ["terminal", "Terminal", Terminal],
  ["book-open", "Reading", BookOpen],
  ["graduation-cap", "Learning", GraduationCap],
  ["coffee", "Lounge", Coffee],
  ["users", "Group", Users],
  ["calendar", "Events", Calendar],
  ["star", "Star", Star],
  ["heart", "Heart", Heart],
  ["shield", "Moderation", Shield],
  ["wrench", "Help", Wrench],
] as const;
const icons = new Map<string, typeof Hash>(
  choices.map(([key, , Icon]) => [key, Icon]),
);
export type ChannelIconKey = (typeof choices)[number][0] | "";
export function channelIconKey(value?: string): ChannelIconKey {
  return choices.find(([key]) => key === value)?.[0] ?? "";
}
type Channel = { kind: string; icon?: string };
export function ChannelIcon({
  channel,
  size = 17,
}: {
  channel?: Channel;
  size?: number;
}) {
  const key =
    channel?.icon && icons.has(channel.icon)
      ? channel.icon
      : channel?.kind === "voice"
        ? "headphones"
        : "hash";
  const Icon = icons.get(key)!;
  return <Icon size={size} aria-hidden="true" data-channel-icon={key} />;
}
export function ChannelIconPicker({
  kind,
  value,
  onChange,
}: {
  kind: string;
  value: ChannelIconKey;
  onChange: (value: ChannelIconKey) => void;
}) {
  return (
    <fieldset className="channel-icon-picker">
      <legend>Channel icon</legend>
      <div className="channel-icon-choices">
        <label className="channel-icon-choice" title="Default">
          <input
            type="radio"
            name="icon"
            aria-label="Default icon"
            value=""
            checked={value === ""}
            onChange={() => onChange("")}
          />
          <span>
            <ChannelIcon channel={{ kind }} size={19} />
          </span>
        </label>
        {choices.map(([key, label, Icon]) => (
          <label className="channel-icon-choice" title={label} key={key}>
            <input
              type="radio"
              name="icon"
              aria-label={`${label} icon`}
              value={key}
              checked={value === key}
              onChange={() => onChange(key)}
            />
            <span>
              <Icon size={19} aria-hidden="true" />
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
