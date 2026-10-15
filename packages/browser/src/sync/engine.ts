import { validateBackup, type ClientBackup } from "@haunt/core";
import { canonical, open, seal, version } from "./crypto";
import {
  loadSession,
  saveSession,
  SyncError,
  SyncService,
  SyncSessionReplaced,
  type Session,
} from "./service";

type Values = Record<string, unknown>;
interface Baseline {
  local: Values;
  remote: Values;
  revision: number;
}
export class SyncConflict extends Error {
  constructor(readonly fields: string[]) {
    super(
      "Both devices changed " +
        fields
          .map((f) => f.split(":")[0])
          .filter((v, i, all) => all.indexOf(v) === i)
          .join(", ") +
        ". Choose which copy to keep.",
    );
  }
}
export function flatten(backup: ClientBackup): Values {
  const out: Values = {};
  for (const account of backup.accounts)
    out["account:" + account.instance.instance_id] = account;
  for (const server of backup.servers)
    out["server:" + JSON.stringify([server.origin, server.username])] = server;
  for (const [key, value] of Object.entries(backup.preferences))
    out["preference:" + key] = value;
  for (const [key, value] of Object.entries(backup.notificationSounds ?? {}))
    out["sound:" + key] = value;
  if (backup.customSound) out.customSound = backup.customSound;
  if (backup.dmRecovery) out.dmRecovery = backup.dmRecovery;
  return out;
}
export function inflate(values: Values): ClientBackup {
  const backup: ClientBackup = {
    version: 1,
    createdAt: new Date().toISOString(),
    accounts: [],
    servers: [],
    preferences: {},
    notificationSounds: {},
  };
  for (const [key, value] of Object.entries(values)) {
    if (key.startsWith("account:"))
      backup.accounts.push(value as ClientBackup["accounts"][number]);
    else if (key.startsWith("server:"))
      backup.servers.push(value as ClientBackup["servers"][number]);
    else if (key.startsWith("preference:"))
      backup.preferences[key.slice(11)] = value as string;
    else if (key.startsWith("sound:"))
      backup.notificationSounds![key.slice(6)] = value as NonNullable<
        ClientBackup["notificationSounds"]
      >[string];
    else if (key === "customSound")
      backup.customSound = value as ClientBackup["customSound"];
    else if (key === "dmRecovery") backup.dmRecovery = value as string;
    else throw Error("Invalid backup entry.");
  }
  return validateBackup(backup);
}
const same = (a: unknown, b: unknown) =>
  a === undefined || b === undefined ? a === b : canonical(a) === canonical(b);
export function merge(
  base: Baseline,
  local: Values,
  remote: Values,
  choice?: "local" | "cloud",
): Values {
  const out: Values = {},
    conflicts: string[] = [];
  for (const key of new Set([
    ...Object.keys(base.local),
    ...Object.keys(base.remote),
    ...Object.keys(local),
    ...Object.keys(remote),
  ])) {
    const changedLocal = !same(local[key], base.local[key]),
      changedRemote = !same(remote[key], base.remote[key]);
    if (
      changedLocal &&
      changedRemote &&
      !same(local[key], remote[key]) &&
      !choice
    )
      conflicts.push(key);
    const value =
      changedLocal && (!changedRemote || choice !== "cloud")
        ? local[key]
        : remote[key];
    if (value !== undefined) out[key] = value;
  }
  if (conflicts.length) throw new SyncConflict(conflicts);
  return out;
}
export class SyncEngine {
  private running?: Promise<void>;
  warnings: string[] = [];
  constructor(
    readonly session: Session,
    readonly capture: () => Promise<ClientBackup>,
    readonly apply: (value: ClientBackup) => Promise<void | string[]>,
    readonly mirror?: (
      service: SyncService,
      session: Session,
      value: ClientBackup,
    ) => Promise<void | string[]>,
    readonly persist: (value: Session) => Promise<void> = (value) =>
      saveSession(value, false),
  ) {}
  sync(choice?: "local" | "cloud") {
    if (this.running) return this.running;
    const perform = () => this.run(choice);
    this.running = (
      globalThis.navigator?.locks
        ? navigator.locks.request(
            "haunt-sync:" +
              this.session.account +
              ":" +
              this.session.device +
              ":" +
              this.session.scope,
            { ifAvailable: true },
            (lock) => {
              if (!lock)
                throw Error(
                  "Sync is already running in another window. Try again shortly.",
                );
              return perform();
            },
          )
        : perform()
    ).finally(() => {
      this.running = undefined;
    });
    return this.running;
  }
  private async run(choice?: "local" | "cloud") {
    const session = this.session,
      service = new SyncService(session.issuer, session.portal);
    const active = await loadSession();
    if (
      !active ||
      active.device !== session.device ||
      active.token !== session.token ||
      active.account !== session.account ||
      active.issuer !== session.issuer
    )
      throw new SyncSessionReplaced();
    session.baseline =
      active.scope === session.scope
        ? active.baseline
        : active.serverBaselines?.[session.scope];
    session.serverBaselines = active.serverBaselines;
    const aad = [
      version,
      session.issuer,
      session.account,
      session.scope,
      "local-merge-history",
    ];
    const previous = session.baseline
      ? await open<Baseline>(session.backupKey, session.baseline, aad)
      : undefined;
    const local = flatten(validateBackup(await this.capture()));
    for (let attempt = 0; attempt < 3; attempt++) {
      const cloud = await service.read<ClientBackup>(session);
      if (previous && cloud.revision < previous.revision)
        throw Error(
          "The sync service returned an older backup. Restore was stopped.",
        );
      const remote = cloud.value ? flatten(validateBackup(cloud.value)) : {};
      const baseline = previous ?? {
        local,
        remote: {},
        revision: cloud.revision,
      };
      // On the first sign-in restore the cloud copy and retain local entries absent from it.
      const merged = previous
        ? merge(baseline, local, remote, choice)
        : { ...local, ...remote };
      let revision = cloud.revision;
      if (!same(merged, remote)) {
        try {
          revision = (
            await service.write(session, inflate(merged), cloud.revision)
          ).revision;
        } catch (error) {
          if (error instanceof SyncError && error.status === 409) continue;
          throw error;
        }
      }
      const value = inflate(merged);
      this.warnings = (await this.apply(value)) ?? [];
      const captured = flatten(await this.capture());
      // A freshly restored account has a new independent credential. Publish it
      // on the next pass so backup access does not depend on the old device.
      for (const key of Object.keys(merged))
        if (
          key.startsWith("account:") &&
          local[key] === undefined &&
          captured[key] !== undefined
        )
          captured[key] = merged[key];
      session.baseline = await seal(
        session.backupKey,
        { local: captured, remote: merged, revision },
        aad,
      );
      await this.persist(session);
      if (this.mirror)
        this.warnings.push(
          ...((await this.mirror(service, session, value)) ?? []),
        );
      return;
    }
    throw Error(
      "Another device keeps updating this backup. Try again shortly.",
    );
  }
}
