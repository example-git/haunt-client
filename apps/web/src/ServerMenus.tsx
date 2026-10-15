import { useEffect, useState, useSyncExternalStore } from "react";
import {
  friendlyError,
  validateMenu,
  readMenuValue,
  menuFormBody,
  type InstanceClient,
  type MenuManifest,
  type MenuPage,
  type SettingValue,
} from "@haunt/core";
import { Status, useAction } from "./Customization";
import { MenuAction } from "./ContextMenu";

export function useServerMenu(instance: InstanceClient, channel?: string) {
  const { permissions } = useSyncExternalStore(
    instance.subscribe,
    instance.getSnapshot,
  );
  const supported =
    instance.account.instance.capabilities?.includes("menus.declarative.v1") ??
    false;
  const [result, setResult] = useState<{ menu?: MenuManifest; error?: string }>(
    {},
  );
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setResult({});
    if (!supported) return;
    const controller = new AbortController();
    void instance
      .menuRequest(
        channel ? `/api/v1/channels/${channel}/menu` : "/api/v1/menus/server",
        "GET",
        undefined,
        controller.signal,
      )
      .then((raw) => {
        if (!controller.signal.aborted) setResult({ menu: validateMenu(raw) });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setResult({ error: friendlyError(error) });
      });
    return () => controller.abort();
  }, [instance, channel, permissions, supported, retry]);
  return { ...result, supported, retry: () => setRetry((n) => n + 1) };
}
export function MenuLoadStatus({
  state,
}: {
  state: ReturnType<typeof useServerMenu>;
}) {
  if (!state.supported || state.menu) return null;
  return (
    <div className="server-menu-status" role={state.error ? "alert" : "status"}>
      <span>{state.error ?? "Loading server options…"}</span>
      {state.error && <button onClick={state.retry}>Retry</button>}
    </div>
  );
}
export function ServerMenuEntries({
  instance,
  channel,
  onSelect,
  fallback,
}: {
  instance: InstanceClient;
  channel?: string;
  onSelect: (id: string) => void;
  fallback?: React.ReactNode;
}) {
  const state = useServerMenu(instance, channel);
  if (!state.supported) return <>{fallback}</>;
  return (
    <>
      <MenuLoadStatus state={state} />
      {state.menu?.pages
        .filter((p) => p.context_label)
        .map((p) => (
          <MenuAction
            key={p.id}
            danger={p.action?.dangerous}
            onClick={() => onSelect(p.id)}
          >
            {p.context_label}
          </MenuAction>
        ))}
    </>
  );
}
export function ServerMenuPage({
  instance,
  page,
  onDone,
}: {
  instance: InstanceClient;
  page: MenuPage;
  onDone?: () => void;
}) {
  return page.form ? (
    <ServerForm key={page.id} instance={instance} page={page} />
  ) : page.action ? (
    <ServerCommand
      key={page.id}
      instance={instance}
      page={page}
      onDone={onDone}
    />
  ) : null;
}
function ServerForm({
  instance,
  page,
}: {
  instance: InstanceClient;
  page: MenuPage;
}) {
  const form = page.form!;
  const [loaded, setLoaded] = useState<unknown>();
  const [values, setValues] = useState<Record<string, SettingValue>>({});
  const action = useAction();
  const load = async (signal?: AbortSignal) => {
    const data = await instance.menuRequest(
      form.load_path,
      "GET",
      undefined,
      signal,
    );
    if (signal?.aborted) return;
    const next: Record<string, SettingValue> = {};
    for (const field of form.fields) {
      const value = readMenuValue(data, field.path);
      next[field.path] =
        field.type === "number"
          ? typeof value === "number"
            ? value / (field.scale ?? 1)
            : ""
          : field.type === "toggle"
            ? value === true
            : typeof value === "string"
              ? value
              : "";
    }
    setLoaded(data);
    setValues(next);
  };
  useEffect(() => {
    const abort = new AbortController();
    void action.run(() => load(abort.signal), "");
    return () => abort.abort();
  }, [instance, page]);
  return (
    <section className="form">
      <h3>{page.label}</h3>
      {form.description && <p className="muted">{form.description}</p>}
      <Status action={action} />
      {loaded === undefined ? (
        <button
          disabled={action.busy}
          onClick={() => void action.run(() => load(), "")}
        >
          {action.busy ? "Loading…" : "Retry"}
        </button>
      ) : (
        <form
          className="form"
          onSubmit={(event) => {
            event.preventDefault();
            void action.run(async () => {
              await instance.menuRequest(
                form.save_path,
                form.method,
                menuFormBody(form, loaded, values),
              );
              await instance.refreshAfterChange();
              await load();
            }, form.success_message ?? "Changes saved.");
          }}
        >
          <fieldset disabled={action.busy} className="configuration-fields">
            {form.fields.map((field) => {
              const value = values[field.path];
              const set = (v: SettingValue) =>
                setValues((old) => ({ ...old, [field.path]: v }));
              const props = {
                "aria-label": field.label,
                required: !!field.required,
                maxLength: field.max_length ?? 10000,
              };
              return (
                <label
                  key={field.path}
                  className={
                    field.type === "toggle" ? "setting-toggle" : undefined
                  }
                >
                  <span>{field.label}</span>
                  {field.type === "toggle" ? (
                    <input
                      aria-label={field.label}
                      type="checkbox"
                      checked={value === true}
                      onChange={(e) => set(e.target.checked)}
                    />
                  ) : field.type === "select" ? (
                    <select
                      {...props}
                      value={String(value ?? "")}
                      onChange={(e) => set(e.target.value)}
                    >
                      {field.options?.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : field.type === "textarea" ? (
                    <textarea
                      {...props}
                      value={String(value ?? "")}
                      rows={3}
                      onChange={(e) => set(e.target.value)}
                    />
                  ) : (
                    <input
                      {...props}
                      type={field.type}
                      min={field.min ?? undefined}
                      max={field.max ?? undefined}
                      step={field.step ?? "any"}
                      value={
                        typeof value === "number" && !Number.isFinite(value)
                          ? ""
                          : String(value ?? "")
                      }
                      onChange={(e) =>
                        set(
                          field.type === "number"
                            ? e.target.valueAsNumber
                            : e.target.value,
                        )
                      }
                    />
                  )}
                  {field.help && <small className="muted">{field.help}</small>}
                </label>
              );
            })}
          </fieldset>
          <button className="primary" disabled={action.busy}>
            {form.submit_label}
          </button>
        </form>
      )}
    </section>
  );
}
function ServerCommand({
  instance,
  page,
  onDone,
}: {
  instance: InstanceClient;
  page: MenuPage;
  onDone?: () => void;
}) {
  const command = page.action!,
    action = useAction();
  const [confirmation, setConfirmation] = useState("");
  return (
    <section className="form">
      <h3>{page.label}</h3>
      <p>{command.confirmation}</p>
      {command.confirmation_value && (
        <>
          <p>
            <strong>{command.confirmation_value}</strong>
          </p>
          <input
            aria-label={command.confirmation_label ?? "Confirmation"}
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
          />
        </>
      )}
      <Status action={action} />
      <button
        className={command.dangerous ? "danger" : "primary"}
        disabled={
          action.busy ||
          (!!command.confirmation_value &&
            confirmation !== command.confirmation_value)
        }
        onClick={() =>
          void action.run(async () => {
            await instance.menuRequest(command.path, command.method);
            await instance.refreshAfterChange();
            onDone?.();
          }, command.success_message ?? "Action completed.")
        }
      >
        {command.submit_label ?? page.label}
      </button>
    </section>
  );
}
