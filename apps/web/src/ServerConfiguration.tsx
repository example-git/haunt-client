import { useEffect, useState } from "react";
import { unwrap, type InstanceClient, type Schemas } from "@haunt/core";
import { Status, useAction } from "./Customization";

type RuntimeSettings = Schemas["ConfigRuntimeSettings"];
type Configuration = Schemas["HttpapiConfigurationResponse"];
const MiB = 1024 * 1024;
const limits: [Exclude<keyof RuntimeSettings["limits"],"dm">, string, number, number][] = [
  ["image_max_bytes", "Maximum image upload (MiB)", MiB, 1 / MiB],
  ["video_max_bytes", "Maximum video upload (MiB)", MiB, 1 / MiB],
  [
    "attachment_max_bytes",
    "Total attachment storage budget (MiB)",
    MiB,
    1 / MiB,
  ],
  ["attachment_retention_days", "Keep new attachments (days)", 1, 1],
  [
    "text_max_bytes",
    "Message and replay storage budget (MiB)",
    MiB,
    4096 / MiB,
  ],
  ["text_retention_days", "Keep messages (days)", 1, 1],
];
export function ServerConfiguration({
  instance,
}: {
  instance: InstanceClient;
}) {
  const [value, setValue] = useState<Configuration>();
  const [draft, setDraft] = useState<RuntimeSettings>();
  const action = useAction();
  const load = async () => {
    const next = await unwrap(
      instance.http.GET("/api/v1/instance/configuration"),
    );
    setValue(next);
    setDraft(next.settings);
  };
  useEffect(() => {
    void action.run(load, "");
  }, [instance]);
  return (
    <section className="form">
      <h3>Limits & access</h3>
      <p className="muted">
        Saved on this server and applied without a restart.
      </p>
      <Status action={action} />
      {value && draft && (
        <form
          className="form"
          onSubmit={(event) => {
            event.preventDefault();
            void action.run(async () => {
              const saved = await unwrap(
                instance.http.PUT("/api/v1/instance/configuration", {
                  body: { revision: value.revision, settings: draft },
                }),
              );
              setValue({ ...value, ...saved });
              setDraft(saved.settings);
              await instance.refreshAfterChange();
              await load();
            }, "Server configuration saved and applied.");
          }}
        >
          <fieldset disabled={action.busy} className="configuration-fields">
            {limits.map(([key, label, scale, min]) => (
              <label key={key}>
                {label}
                <input
                  type="number"
                  required
                  min={min}
                  max={scale === 1 ? 36500 : 2 ** 50 / MiB}
                  step={scale === 1 ? 1 : "any"}
                  value={
                    Number.isNaN(draft.limits[key])
                      ? ""
                      : draft.limits[key] / scale
                  }
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      limits: {
                        ...draft.limits,
                        [key]: Math.round(
                          e.currentTarget.valueAsNumber * scale,
                        ),
                      },
                    })
                  }
                />
              </label>
            ))}
            <p className="muted">
              Currently reserved:{" "}
              {(value.attachment_reserved_bytes / MiB).toLocaleString(
                undefined,
                { maximumFractionDigits: 2 },
              )}{" "}
              MiB. The budget must cover retained files, pending uploads, and
              each per-file limit. It applies across all storage providers.
            </p>
            <p className="muted">
              Lowering message retention or its budget removes older messages
              during maintenance. Attachment retention applies to new uploads;
              existing files keep their expiry. Uploads already admitted finish
              under their original limits. Profile pictures, banners and emojis
              are separate from chat attachments.
            </p>
            <label>
              People per voice channel
              <input
                type="number"
                required
                min={2}
                max={64}
                value={
                  Number.isNaN(draft.media_room_limit)
                    ? ""
                    : draft.media_room_limit
                }
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    media_room_limit: e.currentTarget.valueAsNumber,
                  })
                }
              />
            </label>
            <label>
              Server media connections
              <input
                type="number"
                required
                min={2}
                max={4096}
                value={
                  Number.isNaN(draft.media_max_peers)
                    ? ""
                    : draft.media_max_peers
                }
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    media_max_peers: e.currentTarget.valueAsNumber,
                  })
                }
              />
            </label>
            <p className="muted">
              Lower limits apply to new joins and media connections. Existing
              calls stay connected.
            </p>
            <label className="setting-toggle">
              Allow new accounts with an invitation
              <input
                type="checkbox"
                checked={draft.registration_enabled}
                onChange={(e) =>
                  setDraft({ ...draft, registration_enabled: e.target.checked })
                }
              />
            </label>
            <label>
              Temporary session lifetime (days)
              <input
                type="number"
                required
                min={1}
                max={365}
                value={
                  Number.isNaN(draft.session_days) ? "" : draft.session_days
                }
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    session_days: e.currentTarget.valueAsNumber,
                  })
                }
              />
            </label>
            <p className="muted">
              For new sessions when “Remember me” is off. Saved logins have no
              scheduled expiry. Existing sessions keep their current expiry.
            </p>
            <button type="submit" className="primary">
              Save configuration
            </button>
          </fieldset>
        </form>
      )}
      <button
        disabled={action.busy}
        onClick={() => void action.run(load, "Current configuration loaded.")}
      >
        Reload saved configuration
      </button>
    </section>
  );
}

type Storage = Schemas["HttpapiStorageProvidersResponse"];
type Credentials = Schemas["BlobstoreCredentials"];
const emptyCredentials = (): Credentials => ({
  access_key: "",
  secret_key: "",
  session_token: "",
});
function CredentialFields({
  value,
  onChange,
}: {
  value: Credentials;
  onChange: (v: Credentials) => void;
}) {
  return (
    <>
      <label>
        Access key
        <input
          required
          autoComplete="off"
          maxLength={256}
          value={value.access_key}
          onChange={(e) => onChange({ ...value, access_key: e.target.value })}
        />
      </label>
      <label>
        Secret key
        <input
          required
          type="password"
          autoComplete="new-password"
          maxLength={4096}
          value={value.secret_key}
          onChange={(e) => onChange({ ...value, secret_key: e.target.value })}
        />
      </label>
      <label>
        Session token (optional)
        <input
          type="password"
          autoComplete="off"
          maxLength={8192}
          value={value.session_token}
          onChange={(e) =>
            onChange({ ...value, session_token: e.target.value })
          }
        />
      </label>
    </>
  );
}
export function StorageSettings({ instance }: { instance: InstanceClient }) {
  const [storage, setStorage] = useState<Storage>();
  const [adding, setAdding] = useState(false),
    [rotating, setRotating] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"local" | "s3">("s3");
  const [path, setPath] = useState(""),
    [endpoint, setEndpoint] = useState(""),
    [region, setRegion] = useState("us-east-1"),
    [bucket, setBucket] = useState(""),
    [prefix, setPrefix] = useState("");
  const [pathStyle, setPathStyle] = useState(false),
    [credentials, setCredentials] = useState(emptyCredentials);
  const action = useAction();
  const load = async () =>
    setStorage(await unwrap(instance.http.GET("/api/v1/admin/storage")));
  useEffect(() => {
    void action.run(load, "");
  }, [instance]);
  const activate = (id: string) =>
    void action.run(async () => {
      await unwrap(
        instance.http.PUT("/api/v1/admin/storage/active", {
          body: { provider_id: id },
        }),
      );
      await load();
    }, "Storage selected for new uploads.");
  return (
    <section className="form">
      <h3>Attachment storage</h3>
      <p className="muted">
        Use Amazon S3, an S3-compatible service on a VPS or your network, or a
        folder mounted on this server. Existing files stay at their recorded
        location when you switch providers.
      </p>
      <Status action={action} />
      {storage && (
        <div className="storage-provider-list">
          <article className="storage-provider">
            <strong>
              Built-in local storage{" "}
              {storage.default_active && (
                <span className="success">· Active</span>
              )}
            </strong>
            <p className="muted">
              {storage.default_attachments} files ·{" "}
              {(storage.default_bytes / MiB).toLocaleString(undefined, {
                maximumFractionDigits: 2,
              })}{" "}
              MiB
            </p>
            {!storage.default_active && (
              <button disabled={action.busy} onClick={() => activate("")}>
                Use for new uploads
              </button>
            )}
          </article>
          {(storage.providers ?? []).map((provider) => (
            <article className="storage-provider" key={provider.id}>
              <strong>
                {provider.name}{" "}
                {provider.active && <span className="success">· Active</span>}
              </strong>
              <p className="muted">
                {provider.configuration.kind === "local"
                  ? provider.configuration.path
                  : `${provider.configuration.endpoint || "Amazon S3"} · ${provider.configuration.bucket}`}
                <br />
                {provider.attachments} files ·{" "}
                {(provider.bytes / MiB).toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}{" "}
                MiB
              </p>
              <div className="button-row">
                {!provider.active && (
                  <button
                    disabled={action.busy}
                    onClick={() => activate(provider.id)}
                  >
                    Use for new uploads
                  </button>
                )}
                <button
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      await unwrap(
                        instance.http.POST("/api/v1/admin/storage/{id}/check", {
                          params: { path: { id: provider.id } },
                        }),
                      );
                    }, "Connection verified: write, read and delete succeeded.")
                  }
                >
                  Test connection
                </button>
                {provider.configuration.kind === "s3" && (
                  <button
                    disabled={action.busy}
                    onClick={() => {
                      setAdding(false);
                      setCredentials(emptyCredentials());
                      setRotating(provider.id);
                    }}
                  >
                    Replace credentials
                  </button>
                )}
                <button
                  disabled={
                    action.busy || provider.active || provider.attachments > 0
                  }
                  title="Only inactive providers without retained files can be removed"
                  onClick={() =>
                    void action.run(async () => {
                      await unwrap(
                        instance.http.DELETE("/api/v1/admin/storage/{id}", {
                          params: { path: { id: provider.id } },
                        }),
                      );
                      await load();
                    }, "Storage provider removed.")
                  }
                >
                  Remove
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      {rotating && (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              await unwrap(
                instance.http.PUT("/api/v1/admin/storage/{id}/credentials", {
                  params: { path: { id: rotating } },
                  body: credentials,
                }),
              );
              setRotating("");
              setCredentials(emptyCredentials());
            }, "Credentials verified and replaced.");
          }}
        >
          <fieldset className="configuration-fields" disabled={action.busy}>
            <h4>Replace storage credentials</h4>
            <CredentialFields value={credentials} onChange={setCredentials} />
            <button type="submit">Verify & save credentials</button>
            <button
              type="button"
              onClick={() => {
                setRotating("");
                setCredentials(emptyCredentials());
              }}
            >
              Cancel
            </button>
          </fieldset>
        </form>
      )}
      {!adding ? (
        <button
          disabled={action.busy || (storage?.providers?.length ?? 0) >= 16}
          onClick={() => {
            setRotating("");
            setCredentials(emptyCredentials());
            setAdding(true);
          }}
        >
          Register storage provider
        </button>
      ) : (
        <form
          className="form"
          onSubmit={(event) => {
            event.preventDefault();
            void action.run(async () => {
              await unwrap(
                instance.http.POST("/api/v1/admin/storage", {
                  body: {
                    name,
                    configuration:
                      kind === "local"
                        ? { kind, path, path_style: false }
                        : {
                            kind,
                            endpoint,
                            region,
                            bucket,
                            prefix,
                            path_style: pathStyle,
                          },
                    credentials:
                      kind === "local" ? emptyCredentials() : credentials,
                  },
                }),
              );
              setAdding(false);
              setCredentials(emptyCredentials());
              setName("");
              await load();
            }, "Storage verified and registered. Select it to use for new uploads.");
          }}
        >
          <fieldset className="configuration-fields" disabled={action.busy}>
            <label>
              Name
              <input
                required
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Storage type
              <select
                aria-label="Storage type"
                value={kind}
                onChange={(e) => setKind(e.target.value as "local" | "s3")}
              >
                <option value="s3">Amazon S3 / S3-compatible</option>
                <option value="local">
                  Server folder / mounted network share
                </option>
              </select>
            </label>
            {kind === "local" ? (
              <>
                <label>
                  Absolute server path
                  <input
                    required
                    maxLength={1024}
                    value={path}
                    onChange={(e) => setPath(e.target.value)}
                  />
                </label>
                <p className="muted">
                  Mount your NFS/SMB share on the server first and give the
                  Haunt service user access. Haunt creates its own subdirectory
                  here.
                </p>
              </>
            ) : (
              <>
                <label>
                  Endpoint (leave empty for Amazon S3)
                  <input
                    type="url"
                    maxLength={1024}
                    value={endpoint}
                    onChange={(e) => setEndpoint(e.target.value)}
                  />
                </label>
                <label>
                  Region
                  <input
                    required
                    maxLength={80}
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                  />
                </label>
                <label>
                  Bucket
                  <input
                    required
                    maxLength={255}
                    value={bucket}
                    onChange={(e) => setBucket(e.target.value)}
                  />
                </label>
                <label>
                  Key prefix (optional)
                  <input
                    maxLength={512}
                    value={prefix}
                    onChange={(e) => setPrefix(e.target.value)}
                  />
                </label>
                <label className="setting-toggle">
                  Path-style requests (MinIO and some compatible hosts)
                  <input
                    type="checkbox"
                    checked={pathStyle}
                    onChange={(e) => setPathStyle(e.target.checked)}
                  />
                </label>
                <CredentialFields
                  value={credentials}
                  onChange={setCredentials}
                />
                <p className="muted">
                  Use a private bucket. Haunt proxies authorized downloads and
                  needs read, write, delete and multipart-upload access. Use
                  HTTPS outside a trusted network.
                </p>
              </>
            )}
            <button type="submit" className="primary">
              Test & register
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setCredentials(emptyCredentials());
              }}
            >
              Cancel
            </button>
          </fieldset>
        </form>
      )}
      <p className="muted">
        Providers store chat attachments. Account pictures, server artwork,
        emojis and message metadata remain in the database. Credentials are
        encrypted using the server’s storage-provider.key; include this file in
        server backups.
      </p>
      <button
        disabled={action.busy}
        onClick={() => void action.run(load, "Storage list refreshed.")}
      >
        Refresh storage list
      </button>
    </section>
  );
}
