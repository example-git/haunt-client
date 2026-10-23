import { useEffect, useState, useSyncExternalStore } from "react";
import { APIError, unwrap, type InstanceClient } from "@haunt/core";
import {
  clearVoiceReconnect,
  getVoiceReconnect,
  subscribeVoiceReconnect,
} from "@haunt/browser/media/reconnect";
import type { VoiceIntent } from "@haunt/browser/media/state";

export function VoiceReconnectBanner({
  instances,
  restoring,
  active,
  join,
}: {
  instances: InstanceClient[];
  restoring: boolean;
  active: boolean;
  join: (
    instance: InstanceClient,
    room: string,
    intent: VoiceIntent,
  ) => Promise<void>;
}) {
  const record = useSyncExternalStore(
    subscribeVoiceReconnect,
    getVoiceReconnect,
  );
  const [verified, setVerified] = useState<{
    record: typeof record;
    name: string;
  }>();
  const [busy, setBusy] = useState(false);
  const instance = instances.find(
    (candidate) =>
      candidate.account.instance.instance_id === record?.instance &&
      candidate.account.login.user.id === record?.user,
  );
  useEffect(() => {
    setVerified(undefined);
    if (!record || restoring || active) return;
    if (!instance) {
      clearVoiceReconnect();
      return;
    }
    let live = true,
      pending = false,
      generation = 0,
      checked = false;
    const check = async () => {
      if (!live || pending || checked || instance.snapshot.status !== "online")
        return;
      pending = true;
      const attempt = generation;
      try {
        const channel = await unwrap(
          instance.http.GET("/api/v1/channels/{id}", {
            params: { path: { id: record.channel } },
          }),
        );
        if (!live || attempt !== generation || record !== getVoiceReconnect())
          return;
        if (channel.kind !== "voice" || ((channel.permissions ?? 0) & 5) !== 5)
          clearVoiceReconnect(instance, record.channel);
        else {
          checked = true;
          setVerified({ record, name: channel.name });
        }
      } catch (error) {
        if (!live || attempt !== generation || record !== getVoiceReconnect())
          return;
        setVerified(undefined);
        if (error instanceof APIError && [401, 403, 404].includes(error.status))
          clearVoiceReconnect(instance, record.channel);
      } finally {
        pending = false;
      }
    };
    let status = instance.snapshot.status,
      channels = instance.snapshot.channels,
      permissions = instance.snapshot.permissions;
    const off = instance.subscribe(() => {
      const next = instance.snapshot;
      if (
        next.status === status &&
        next.channels === channels &&
        next.permissions === permissions
      )
        return;
      status = next.status;
      channels = next.channels;
      permissions = next.permissions;
      generation++;
      checked = false;
      setVerified(undefined);
      if (status === "signed-out")
        clearVoiceReconnect(instance, record.channel);
      else void check();
    });
    void check();
    const timer = setInterval(() => void check(), 10_000);
    return () => {
      live = false;
      off();
      clearInterval(timer);
    };
  }, [record, instance, restoring, active]);
  if (!record || !instance || active || verified?.record !== record)
    return null;
  return (
    <aside className="voice-reconnect-banner" role="status">
      <span>Return to {verified.name}?</span>
      <button
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void join(instance, record.channel, record.intent).finally(() =>
            setBusy(false),
          );
        }}
      >
        Reconnect
      </button>
      <button
        className="secondary"
        disabled={busy}
        onClick={() => clearVoiceReconnect(instance, record.channel)}
      >
        Dismiss
      </button>
    </aside>
  );
}
