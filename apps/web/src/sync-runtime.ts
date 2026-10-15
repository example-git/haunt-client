import { SyncEngine, SyncConflict } from "@haunt/browser/sync/engine";
import { desktopClient } from "@haunt/browser/client-context";
import { serverScope } from "@haunt/browser/sync/crypto";
import {
  finishRevocations,
  queueRevocation,
  loadSession,
  saveSession,
  SyncService,
  SyncSessionReplaced,
  type Session,
} from "@haunt/browser/sync/service";
import { applySyncBackup, collectSyncBackup } from "./sync-backup";

interface Status {
  session?: Session;
  busy: boolean;
  error: string;
  conflict: boolean;
  lastSync?: string;
  notice?: string;
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
export async function syncNow(choice?: "local" | "cloud") {
  if (!engine || state.busy) return;
  update({ busy: true, error: "", conflict: false });
  try {
    await engine.sync(choice);
    update({
      lastSync: new Date().toLocaleTimeString(),
      notice: [...new Set(engine.warnings)].join(" "),
    });
  } catch (error) {
    if (error instanceof SyncSessionReplaced) {
      if (timer) clearInterval(timer);
      timer = undefined;
      engine = undefined;
      update({ session: undefined });
    }
    update({
      error: error instanceof Error ? error.message : "Sync failed.",
      conflict: error instanceof SyncConflict,
    });
    throw error;
  } finally {
    update({ busy: false });
  }
}
export async function enableSync(session: Session) {
  const desktop = desktopClient();
  if (
    !desktop &&
    (session.scope === "full" || session.origin !== location.origin)
  )
    throw Error(
      "Web sync is restricted to this server. Install the desktop app for multiple servers.",
    );
  if (desktop && session.scope !== "full")
    throw Error("Use the desktop sync sign-in for your complete backup.");
  await saveSession(session);
  const service = new SyncService(session.issuer, session.portal);
  const scoped = session.scope === "full" ? undefined : session.origin;
  engine = new SyncEngine(
    session,
    () => collectSyncBackup(scoped),
    (value) => applySyncBackup(value, scoped),
    desktop
      ? async (_service, _session, backup) => {
          const warnings: string[] = [];
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
            await childEngine.sync();
            warnings.push(...childEngine.warnings);
          }
          return warnings;
        }
      : undefined,
  );
  update({ session });
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    void syncNow().catch(() => {});
  }, 60_000);
  await syncNow();
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
