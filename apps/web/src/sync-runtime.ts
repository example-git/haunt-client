import { SyncEngine, SyncConflict } from "@haunt/browser/sync/engine";
import { multiServerClient } from "@haunt/browser/client-context";
import { open, seal, serverScope, version } from "@haunt/browser/sync/crypto";
import {
  finishRevocations,
  queueRevocation,
  loadSession,
  saveSession,
  SyncService,
  SyncSessionReplaced,
  SyncError,
  SyncSecretsChanged,
  SyncSecretsChangeUncertain,
  type Session,
} from "@haunt/browser/sync/service";
import { applySyncBackup, collectSyncBackup } from "./sync-backup";
import { syncTextArchive } from "@haunt/browser/sync/text-archive";
import { client, messageStore } from "./runtime";

interface Status {
  session?: Session;
  busy: boolean;
  error: string;
  conflict: boolean;
  lastSync?: string;
  notice?: string;
  recoveryKey?: string;
}
let state: Status = { busy: false, error: "", conflict: false },
  engine: SyncEngine | undefined,
  timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();
export const syncStatus = () => state;
export const subscribeSync = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
function update(patch: Partial<Status>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}
export async function syncNow(choice?: "local" | "cloud", force = false) {
  if (!engine || state.busy) return;
  force ||= !!state.session?.resyncRequired;
  update({ busy: true, error: "", conflict: false });
  try {
    const session = engine.session;
    if (session.scope !== "full") await engine.sync(choice, force);
    const scopes =
      session.scope === "full"
        ? undefined
        : new Set(
            [...client.instances.values()]
              .filter((i) => i.origin === session.origin)
              .map((i) => i.scope),
          );
    let archiveError: unknown;
    try {
      await syncTextArchive(session, messageStore, scopes, force);
    } catch (error) {
      if (
        error instanceof SyncSessionReplaced ||
        (error instanceof SyncError && error.status === 401)
      )
        throw error;
      archiveError = error;
    }
    if (session.scope === "full") await engine.sync(choice, force);
    if (archiveError) throw archiveError;
    if (state.session?.resyncRequired) {
      state.session.resyncRequired = false;
      await saveSession(state.session, false);
    }
    update({
      lastSync: new Date().toLocaleTimeString(),
      notice: [
        force ? "Full resync completed." : "",
        ...new Set(engine.warnings),
      ]
        .filter(Boolean)
        .join(" "),
    });
  } catch (error) {
    if (
      error instanceof SyncSessionReplaced ||
      (error instanceof SyncError && error.status === 401)
    ) {
      if (timer) clearInterval(timer);
      timer = undefined;
      engine = undefined;
      if (error instanceof SyncError && state.session)
        await queueRevocation(state.session);
      update({ session: undefined });
    }
    update({
      error:
        (force ? "Full resync did not finish. " : "Sync stopped working. ") +
        (error instanceof Error
          ? error.message
          : "Try again or sign in again."),
      conflict: error instanceof SyncConflict,
    });
    throw error;
  } finally {
    update({ busy: false });
  }
}
export async function enableSync(session: Session, force = false) {
  const fullClient = multiServerClient();
  if (
    !fullClient &&
    (session.scope === "full" || session.origin !== location.origin)
  )
    throw Error(
      "Web sync is restricted to this server. Install the desktop app for multiple servers.",
    );
  if (fullClient && session.scope !== "full")
    throw Error(
      "Use the standalone client sync sign-in for your complete backup.",
    );
  if (force) session.resyncRequired = true;
  await saveSession(session);
  const service = new SyncService(session.issuer, session.portal);
  const scoped = session.scope === "full" ? undefined : session.origin;
  engine = new SyncEngine(
    session,
    () => collectSyncBackup(scoped),
    (value) => applySyncBackup(value, scoped),
    fullClient
      ? async (_service, _session, backup, force) => {
          const warnings: string[] = [];
          const archiveErrors: string[] = [];
          const delegated = await service.request<{ origins: string[] }>(
            "/v1/vaults",
            "GET",
            undefined,
            session.keys,
            session.token,
          );
          for (const target of new Set([
            ...backup.accounts.map((a) => a.origin),
            ...backup.servers.map((s) => s.origin),
            ...delegated.origins,
          ])) {
            const name = await serverScope(target),
              backupKey = await service.scopeKey(session, target);
            const child: Session = {
              ...session,
              scope: name,
              origin: target,
              backupKey,
              baseline: session.serverBaselines?.[name],
            };
            const scopes = new Set(
              backup.accounts
                .filter((a) => a.origin === target)
                .map((a) =>
                  JSON.stringify([a.instance.instance_id, a.login.user.id]),
                ),
            );
            const childEngine = new SyncEngine(
              child,
              () => collectSyncBackup(target),
              (value) => applySyncBackup(value, target),
              undefined,
              async (value) => {
                session.serverBaselines ??= {};
                if (value.baseline)
                  session.serverBaselines[name] = value.baseline;
                await saveSession(session, false);
              },
            );
            await childEngine.sync(undefined, force);
            warnings.push(...childEngine.warnings);
            try {
              await syncTextArchive(child, messageStore, scopes, force);
            } catch (error) {
              if (
                error instanceof SyncSessionReplaced ||
                (error instanceof SyncError && error.status === 401)
              )
                throw error;
              archiveErrors.push(
                `Message archive for ${target} did not sync: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }
          if (archiveErrors.length) throw Error(archiveErrors.join(" "));
          return warnings;
        }
      : undefined,
  );
  update({ session });
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    void syncNow().catch(() => {});
  }, 60_000);
  await syncNow(undefined, force);
}
export async function resumeSync() {
  await finishRevocations();
  const session = await loadSession();
  if (session) await enableSync(session);
}
export async function disableSync() {
  const session = state.session;
  if (!session) return;
  if (state.busy)
    throw Error("Wait for the current sync to finish before signing out.");
  if (timer) clearInterval(timer);
  timer = undefined;
  engine = undefined;
  await queueRevocation(session);
  update({
    session: undefined,
    error: "",
    conflict: false,
    lastSync: undefined,
  });
  try {
    await finishRevocations();
  } catch {
    throw Error(
      "Sync is off on this device. Remote session revocation will retry when this client next starts; backup keys have been removed locally.",
    );
  }
}

export function showSyncRecoveryKey(recoveryKey: string) {
  update({ recoveryKey });
}
export function acknowledgeSyncRecoveryKey() {
  update({ recoveryKey: undefined });
}
export async function changeSyncSecrets(
  currentPassword: string,
  currentKeyword: string,
  newPassword: string,
  newKeyword: string,
) {
  const current = state.session;
  if (!current || current.scope !== "full")
    throw Error("Sign in to full-account sync first.");
  if (state.busy)
    throw Error("Wait for the current sync to finish before changing secrets.");
  await syncNow();
  if (timer) clearInterval(timer);
  timer = undefined;
  update({
    busy: true,
    error: "",
    notice: "Changing sync secrets and re-encrypting snapshots…",
  });
  let secretsChanged = false;
  try {
    const result = await new SyncService(current.issuer).changePassword(
      current,
      currentPassword,
      currentKeyword,
      newPassword,
      newKeyword,
    );
    secretsChanged = true;
    showSyncRecoveryKey(result.recoveryKey);
    const next = result.session;
    const historyAAD = (scope: string) => [
      version,
      current.issuer,
      current.account,
      scope,
      "local-merge-history",
    ];
    async function rewrapHistory(
      ciphertext: NonNullable<Session["baseline"]>,
      oldKey: CryptoKey,
      newKey: CryptoKey,
      scope: string,
    ) {
      const value = await open<{
        local: Record<string, unknown>;
        remote: Record<string, unknown>;
        revision: number;
      }>(oldKey, ciphertext, historyAAD(scope));
      if (!Number.isSafeInteger(value.revision))
        throw Error(
          "Invalid local merge history; secret change completed but resync needs attention.",
        );
      return seal(
        newKey,
        { ...value, revision: value.revision + 1 },
        historyAAD(scope),
      );
    }
    if (current.baseline)
      next.baseline = await rewrapHistory(
        current.baseline,
        current.backupKey,
        next.backupKey,
        "full",
      );
    const selected = new SyncService(current.issuer);
    const delegated = await selected.request<{ origins: string[] }>(
      "/v1/vaults",
      "GET",
      undefined,
      next.keys,
      next.token,
    );
    for (const target of delegated.origins) {
      const name = await serverScope(target),
        ciphertext = current.serverBaselines?.[name];
      if (!ciphertext) continue;
      next.serverBaselines ??= {};
      next.serverBaselines[name] = await rewrapHistory(
        ciphertext,
        await selected.scopeKey(current, target),
        await selected.scopeKey(next, target),
        name,
      );
    }
    update({ busy: false });
    try {
      await enableSync(result.session, true);
    } catch (error) {
      throw Error(
        "Your sync secrets changed, but the required full resync did not finish. Keep your local data and recovery key, then retry. " +
          (error instanceof Error ? error.message : ""),
      );
    }
    return result.recoveryKey;
  } catch (error) {
    if (
      error instanceof SyncSecretsChanged ||
      error instanceof SyncSecretsChangeUncertain
    ) {
      secretsChanged = true;
      showSyncRecoveryKey(error.recoveryKey);
    }
    if (secretsChanged && state.session?.device === current.device) {
      engine = undefined;
      await queueRevocation(current);
      update({ session: undefined });
    }
    update({
      busy: false,
      error:
        (secretsChanged && !(error instanceof SyncSecretsChangeUncertain)
          ? "Your sync secrets changed, but full resync did not finish. Your local data is unchanged. "
          : "") +
        (error instanceof Error
          ? error.message
          : "The secret change or full resync failed. Your local data is unchanged."),
      notice: "",
    });
    throw error;
  } finally {
    if (!timer && state.session)
      timer = setInterval(() => {
        void syncNow().catch(() => {});
      }, 60_000);
  }
}
