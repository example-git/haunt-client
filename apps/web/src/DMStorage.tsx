import { useEffect, useState, useSyncExternalStore } from "react";
import {
  friendlyError,
  unwrap,
  type InstanceClient,
  type Schemas,
} from "@haunt/core";
import {
  dmUsage,
  dmStorageChanged,
  storageSize,
} from "@haunt/browser/dm-storage";
import { exportConversation } from "@haunt/browser/dm-export";
import { Modal, ErrorNotice } from "./App";
export function PurgeDMUploads({
  instance,
  onClose,
}: {
  instance: InstanceClient;
  onClose: () => void;
}) {
  const [days, setDays] = useState(30),
    [preview, setPreview] = useState<Schemas["AttachmentsDMPurge"]>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const run = async (confirm: boolean) => {
    setBusy(true);
    setError("");
    try {
      const before = confirm
        ? preview!.before
        : new Date(Date.now() - days * 86400000 - 1000).toISOString();
      if (!confirm) {
        setPreview(
          await unwrap(
            instance.http.POST("/api/v1/me/dm-storage/purge", {
              body: { before, confirm: false },
            }),
          ),
        );
        return;
      }
      let files = 0,
        bytes = 0;
      for (;;) {
        const result = await unwrap(
          instance.http.POST("/api/v1/me/dm-storage/purge", {
            body: { before, confirm: true },
          }),
        );
        files += result.files;
        bytes += result.bytes;
        if (result.files < 128) break;
        await new Promise((resolve) => setTimeout(resolve, 2100));
      }
      setPreview(undefined);
      setNotice(
        `Removed ${files} uploads and freed ${storageSize(bytes)}. Message text was kept.`,
      );
      dmStorageChanged(instance);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Purge old DM uploads" onClose={onClose}>
      <div className="form">
        <p>
          Remove your older image uploads across all DMs on{" "}
          {instance.account.instance.name}. Other participants will lose access
          to those server copies. Cached copies and backups may remain.
        </p>
        <label>
          Older than{" "}
          <select
            value={days}
            disabled={busy}
            onChange={(e) => {
              setDays(Number(e.target.value));
              setPreview(undefined);
            }}
          >
            {[0, 7, 30, 90, 365].map((n) => (
              <option key={n} value={n}>
                {n ? `${n} days` : "Now (all existing uploads)"}
              </option>
            ))}
          </select>
        </label>
        <ErrorNotice error={error} />
        {notice && <p role="status">{notice}</p>}
        {preview ? (
          <>
            <p>
              {preview.files} uploads · {storageSize(preview.bytes)}. This
              cannot be undone on the server.
            </p>
            <button
              className="danger"
              disabled={busy || !preview.files}
              onClick={() => void run(true)}
            >
              {busy ? "Removing…" : "Purge these uploads"}
            </button>
          </>
        ) : (
          <button disabled={busy} onClick={() => void run(false)}>
            {busy ? "Checking…" : "Review uploads"}
          </button>
        )}
      </div>
    </Modal>
  );
}
export function DMStorageMeter({ instance }: { instance: InstanceClient }) {
  const monitor = dmUsage(instance),
    value = useSyncExternalStore(monitor.subscribe, monitor.getSnapshot);
  const [purge, setPurge] = useState(false);
  if (!value) return null;
  const ratio = value.limit_bytes ? value.used_bytes / value.limit_bytes : 0;
  return (
    <section className="dm-storage-meter">
      <div>
        <strong>DM upload storage</strong>
        <span>
          {storageSize(value.used_bytes)} / {storageSize(value.limit_bytes)}
        </span>
      </div>
      <progress
        aria-label="DM upload storage"
        className={ratio >= 1 ? "full" : ratio >= 0.8 ? "near" : ""}
        value={value.used_bytes}
        max={value.limit_bytes}
      />
      <small>Across all your DMs on {instance.account.instance.name}.</small>
      <button className="text-button" onClick={() => setPurge(true)}>
        Purge old uploads
      </button>
      {purge && (
        <PurgeDMUploads instance={instance} onClose={() => setPurge(false)} />
      )}
    </section>
  );
}
export function DMStorageWarning({ instance }: { instance: InstanceClient }) {
  const monitor = dmUsage(instance),
    value = useSyncExternalStore(monitor.subscribe, monitor.getSnapshot);
  const [purge, setPurge] = useState(false);
  if (!value || value.used_bytes < value.limit_bytes * 0.8) return null;
  return (
    <aside className="dm-storage-warning" role="status">
      <span>
        {value.used_bytes >= value.limit_bytes
          ? "Your DM upload storage is full"
          : "You’re nearing your DM upload limit"}{" "}
        on {instance.account.instance.name}: {storageSize(value.used_bytes)} /{" "}
        {storageSize(value.limit_bytes)}.
      </span>
      <button onClick={() => setPurge(true)}>Purge old uploads</button>
      {purge && (
        <PurgeDMUploads instance={instance} onClose={() => setPurge(false)} />
      )}
    </aside>
  );
}
export function DMInfo({
  instance,
  conversation,
  title,
}: {
  instance: InstanceClient;
  conversation: string;
  title: string;
}) {
  const [purge, setPurge] = useState(false),
    [backup, setBackup] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [security, setSecurity] = useState("Connecting encryption…");
  useEffect(() => {
    let active = true;
    setSecurity("Connecting encryption…");
    const sync = () => {
      if (!instance.dmEncryption) {
        setSecurity("This server does not support encrypted DMs yet.");
        return;
      }
      void instance.dmEncryption
        .sync(conversation)
        .then(() => {
          if (active) {
            setSecurity("New messages and images are end-to-end encrypted.");
            void instance.syncHistory(conversation);
          }
        })
        .catch((e) => {
          if (active) setSecurity(friendlyError(e));
        });
    };
    sync();
    const off = instance.onWire((e) => {
      if (
        ["dm.keys_changed", "dm.devices_changed"].includes(e.type) &&
        e.conversation_id === conversation
      )
        sync();
    });
    return () => {
      active = false;
      off();
    };
  }, [instance, conversation]);
  const exportDM = async (format: "csv" | "html") => {
    setBusy(true);
    setError("");
    try {
      await exportConversation(instance, conversation, title, format);
      setBackup(false);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <aside className="dm-info">
        <p>
          DMs stored on <strong>{instance.account.instance.name}</strong> (
          {new URL(instance.origin).host}). {security} History can disappear
          during server maintenance or storage failure.
        </p>
        <div className="button-row">
          <button onClick={() => setBackup(true)}>Backup</button>
          <button onClick={() => setPurge(true)}>Purge old uploads</button>
        </div>
      </aside>
      <DMStorageWarning instance={instance} />
      {purge && (
        <PurgeDMUploads instance={instance} onClose={() => setPurge(false)} />
      )}
      {backup && (
        <Modal
          title="Back up this conversation"
          onClose={() => {
            if (!busy) setBackup(false);
          }}
        >
          <div className="form">
            <p>
              This exports a readable, decrypted copy of available server
              history and your locally cached messages. Keep the file private.
            </p>
            <p>
              CSV includes text only. HTML ZIP also includes available server
              images from the last 30 days and older images already cached on
              this device.
            </p>
            <ErrorNotice error={error} />
            <div className="button-row">
              <button disabled={busy} onClick={() => void exportDM("csv")}>
                {busy ? "Exporting…" : "Export CSV"}
              </button>
              <button disabled={busy} onClick={() => void exportDM("html")}>
                Export HTML ZIP
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
