import { useEffect, useRef, useState } from "react";
import {
  friendlyError,
  unwrap,
  type InstanceClient,
  type Participant,
  type Schemas,
} from "@haunt/core";
import { Shield } from "lucide-react";
import { Permission, can } from "./Permissions";
import { MenuAction } from "./ContextMenu";
import { Modal, ErrorNotice } from "./App";
import { UserName } from "./UserName";

type Restriction = Schemas["IdentityVoiceRestriction"];
type RestrictionMember = Schemas["IdentityVoiceRestrictionMember"];
export const canModerateVoice = (instance: InstanceClient) =>
  !!instance.account.instance.capabilities?.includes("media.moderation.v1") &&
  (can(instance, Permission.MuteMembers) ||
    can(instance, Permission.DeafenMembers));
async function update(
  instance: InstanceClient,
  channel: string,
  user: string,
  patch: Partial<Pick<Restriction, "muted" | "deafened">>,
) {
  return unwrap(
    instance.http.PATCH("/api/v1/voice/{id}/restrictions/{user}", {
      params: { path: { id: channel, user } },
      body: patch,
    }),
  );
}

export function VoiceModerationMenu({
  instance,
  channel,
  participant,
  onError,
}: {
  instance: InstanceClient;
  channel: string;
  participant: Pick<Participant, "user_id" | "restriction">;
  onError: (error: string) => void;
}) {
  if (
    !participant ||
    !canModerateVoice(instance) ||
    participant.user_id === instance.account.login.user.id ||
    instance.snapshot.users.find((u) => u.id === participant.user_id)?.is_owner
  )
    return null;
  const run = (patch: Partial<Pick<Restriction, "muted" | "deafened">>) =>
    void update(instance, channel, participant.user_id, patch).catch((error) =>
      onError(friendlyError(error)),
    );
  return (
    <>
      {can(instance, Permission.MuteMembers) && (
        <MenuAction
          onClick={() => run({ muted: !participant.restriction?.muted })}
        >
          {participant.restriction?.muted
            ? "Remove moderator mute"
            : "Mute member"}
        </MenuAction>
      )}
      {can(instance, Permission.DeafenMembers) && (
        <MenuAction
          onClick={() => run({ deafened: !participant.restriction?.deafened })}
        >
          {participant.restriction?.deafened
            ? "Remove moderator deafen"
            : "Deafen member"}
        </MenuAction>
      )}
    </>
  );
}

export function VoiceRestrictions({
  instance,
  channel,
  onClose,
}: {
  instance: InstanceClient;
  channel: string;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(!!onClose);
  const [items, setItems] = useState<RestrictionMember[]>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const generation = useRef(0);
  const refresh = async (after?: string) => {
    const attempt = ++generation.current;
    const page = await unwrap(
      instance.http.GET("/api/v1/voice/{id}/restrictions", {
        params: { path: { id: channel }, query: { after } },
      }),
    );
    if (attempt !== generation.current) return;
    setItems((previous) => (after ? [...(previous ?? []), ...page] : page));
    setMore(page.length === 100);
  };
  useEffect(() => {
    if (!open) return;
    let active = true;
    setItems(undefined);
    setMore(false);
    void refresh().catch((e) => active && setError(friendlyError(e)));
    const off = instance.onWire((event) => {
      if (event.type === "media.participant.state")
        void refresh().catch((e) => active && setError(friendlyError(e)));
    });
    return () => {
      active = false;
      generation.current++;
      off();
    };
  }, [open, instance, channel]);
  if (!canModerateVoice(instance)) return null;
  const clear = async (item: Restriction, field: "muted" | "deafened") => {
    setBusy(true);
    setError("");
    try {
      await update(instance, channel, item.user_id, { [field]: false });
      await refresh();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {!onClose && (
        <button
          className="icon"
          title="Voice restrictions"
          aria-label="Voice restrictions"
          onClick={() => setOpen(true)}
        >
          <Shield size={18} />
        </button>
      )}
      {open && (
        <Modal
          title="Voice restrictions"
          onClose={() => {
            setOpen(false);
            onClose?.();
          }}
        >
          <ErrorNotice error={error} />
          {!items ? (
            <p>Loading restrictions…</p>
          ) : items.length === 0 ? (
            <p>No restricted members.</p>
          ) : (
            items.map((item) => (
              <div className="settings-row" key={item.user_id}>
                <UserName
                  instance={instance}
                  user={
                    instance.snapshot.users.find(
                      (user) => user.id === item.user_id,
                    ) ?? item.user
                  }
                />
                {item.muted && (
                  <button
                    disabled={busy || !can(instance, Permission.MuteMembers)}
                    onClick={() => void clear(item, "muted")}
                  >
                    Remove mute
                  </button>
                )}
                {item.deafened && (
                  <button
                    disabled={busy || !can(instance, Permission.DeafenMembers)}
                    onClick={() => void clear(item, "deafened")}
                  >
                    Remove deafen
                  </button>
                )}
              </div>
            ))
          )}
          {more && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void refresh(items?.at(-1)?.user_id)
                  .catch((e) => setError(friendlyError(e)))
                  .finally(() => setBusy(false));
              }}
            >
              Load more restrictions
            </button>
          )}
        </Modal>
      )}
    </>
  );
}
