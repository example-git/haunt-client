import { useSyncExternalStore, type ReactNode } from "react";
import type { InstanceClient, Message, AIAuthor } from "@haunt/core";
import { AIAvatar } from "./AIIdentity";

export function StructuredEmbedCard({
  title,
  portrait,
  children,
}: {
  title: string;
  portrait: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="structured-embed-card" aria-label="Consultation">
      <p className="structured-card-title">{title}</p>
      <div className="structured-card-content">
        {portrait}
        <div>{children}</div>
      </div>
    </section>
  );
}

export function ConsultationCards({
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
        const portrait = <AIAvatar instance={instance} author={author} />;
        const open = preset && onProfile ? () => onProfile(preset) : undefined;
        return (
          <StructuredEmbedCard
            key={card.call_id}
            title={card.question}
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
            <p className="consultation-answer">
              {card.status === "answered"
                ? card.answer
                : card.status === "waiting"
                  ? "Waiting for an answer…"
                  : "Consultation unavailable."}
            </p>
          </StructuredEmbedCard>
        );
      })}
    </div>
  );
}
