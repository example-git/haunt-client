import { useEffect, useState, useSyncExternalStore } from "react";
import { subscribeArt } from "@haunt/browser/art";
import { Bot } from "lucide-react";
import { type AIAuthor, type InstanceClient, type Message } from "@haunt/core";
import { Avatar } from "./People";
import { UserName } from "./UserName";
export function AIAvatar({
  instance,
  author,
  size = "",
}: {
  instance: InstanceClient;
  author: AIAuthor;
  size?: string;
}) {
  const path = author.avatar_url;
  const channel = path?.match(/^\/api\/v1\/channels\/([a-f0-9-]+)\//)?.[1];
  const visible = useSyncExternalStore(
    instance.subscribe,
    () =>
      !!channel &&
      instance.snapshot.status !== "signed-out" &&
      instance.snapshot.channels.some((c) => c.id === channel),
  );
  const [loaded, setLoaded] = useState<{ path: string; url: string }>();
  const url = visible && loaded?.path === path ? loaded?.url : undefined;
  useEffect(() => {
    setLoaded(undefined);
    if (visible && path)
      return subscribeArt(instance, "ai-avatar", path, channel, (url) =>
        setLoaded({ path, url }),
      );
  }, [instance, channel, path, visible]);
  return (
    <span
      className={`avatar ai-avatar ${size}`}
      aria-label={`${author.name} AI avatar`}
    >
      {url ? <img src={url} alt="" /> : <Bot size={20} />}
    </span>
  );
}
export function MessageAvatar({
  instance,
  message,
  size,
}: {
  instance: InstanceClient;
  message: Message;
  size?: string;
}) {
  return message.ai_author ? (
    <AIAvatar instance={instance} author={message.ai_author} size={size} />
  ) : (
    <Avatar
      instance={instance}
      user={instance.snapshot.users.find((u) => u.id === message.author_id)}
      size={size}
    />
  );
}
export function MessageAuthor({
  instance,
  message,
}: {
  instance: InstanceClient;
  message: Message;
}) {
  return message.ai_author ? (
    <>
      {message.ai_author.name} <span className="ai-label">AI</span>
    </>
  ) : (
    <UserName
      instance={instance}
      user={instance.snapshot.users.find((u) => u.id === message.author_id)}
    />
  );
}
