import { useEffect, useState } from "react";
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
  const [url, setURL] = useState<string>();
  useEffect(() => {
    setURL(undefined);
    if (!author.avatar_url) return;
    const abort = new AbortController();
    let object: string | undefined;
    void instance
      .aiAvatar(author.avatar_url, undefined, abort.signal)
      .then((blob) => {
        if (abort.signal.aborted) return;
        object = URL.createObjectURL(blob);
        setURL(object);
      })
      .catch(() => {});
    return () => {
      abort.abort();
      if (object) URL.revokeObjectURL(object);
    };
  }, [instance, author.avatar_url]);
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
