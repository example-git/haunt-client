import { useSyncExternalStore, type ReactNode } from "react";
import type { InstanceClient, Message, AIAuthor } from "@haunt/core";
import { AIAvatar } from "./AIIdentity";
import MessageText from "./MessageText";

export function StructuredEmbedCard({
  title,
  portrait,
  children,
}: {
  title: ReactNode;
  portrait: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="structured-embed-card" aria-label="Consultation">
      <div className="structured-card-title">{title}</div>
      <div className="structured-card-content">
        {portrait}
        <div>{children}</div>
      </div>
    </section>
  );
}

export default function ConsultationCards({
  instance,
  message,
  onProfile,
}: {
  instance: InstanceClient;
  message: Message;
  onProfile?: (author: AIAuthor) => void;
}) {
  const channel = useSyncExternalStore(instance.ai.subscribe, () =>
    instance.ai.channel(message.conversation_id),
  );
  return (
    <div className="message-consultations">
      {message.consultations?.map((card) => {
        const preset = channel.presets.find(
          (entry) => entry.id === card.preset_id,
        );
        const author = preset ?? {
          id: "",
          name:
            card.preset_id && !channel.settings
              ? "Personality"
              : "Deleted personality",
        };
        const portrait = (
          <AIAvatar instance={instance} author={author} size="tiny" />
        );
        const open = preset && onProfile ? () => onProfile(preset) : undefined;
        return (
          <StructuredEmbedCard
            key={card.call_id}
            title={
              <MessageText
                instance={instance}
                text={card.question}
                variant="embed"
              />
            }
            portrait={
              open ? (
                <button
                  type="button"
                  className="ai-author-portrait"
                  aria-label={`Open ${author.name}’s AI profile`}
                  onClick={open}
                >
                  {portrait}
                </button>
              ) : (
                portrait
              )
            }
          >
            {open ? (
              <button className="user-name" type="button" onClick={open}>
                {author.name}
              </button>
            ) : (
              <strong>{author.name}</strong>
            )}
            {card.status === "answered" && card.answer ? (
              <MessageText
                instance={instance}
                text={card.answer}
                variant="embed"
              />
            ) : (
              <span className="consultation-status">
                {card.status === "waiting"
                  ? "Waiting for an answer…"
                  : "Consultation unavailable."}
              </span>
            )}
          </StructuredEmbedCard>
        );
      })}
    </div>
  );
}
