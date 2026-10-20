import { useEffect, useState, useSyncExternalStore } from "react";
import {
  friendlyError,
  parseServerExtensions,
  type InstanceClient,
  type ServerExtension,
} from "@haunt/core";

const noSubscription = () => () => {};
const offline = () => "offline";
export function useServerExtensions(instance?: InstanceClient) {
  const status = useSyncExternalStore(
    instance?.subscribe ?? noSubscription,
    instance ? () => instance.snapshot.status : offline,
  );
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    scope?: string;
    extensions: ServerExtension[];
    loading: boolean;
    error?: string;
  }>({ extensions: [], loading: false });
  const supported =
    instance?.account.instance.capabilities?.includes("server.extensions.v1") ??
    false;
  useEffect(() => {
    setResult({
      scope: instance?.scope,
      extensions: [],
      loading: supported && status === "online",
    });
    if (!instance || !supported || status !== "online") return;
    const abort = new AbortController();
    void instance
      .menuRequest("/api/v1/server-extensions", "GET", undefined, abort.signal)
      .then((value) => {
        const extensions = parseServerExtensions(value);
        if (!abort.signal.aborted)
          setResult({ scope: instance.scope, extensions, loading: false });
      })
      .catch((error) => {
        if (!abort.signal.aborted)
          setResult({
            scope: instance.scope,
            extensions: [],
            loading: false,
            error: friendlyError(error),
          });
      });
    return () => abort.abort();
  }, [instance, supported, status, revision]);
  return {
    ...(result.scope === instance?.scope
      ? result
      : { extensions: [], loading: supported }),
    supported,
    refresh: () => setRevision((value) => value + 1),
  };
}
