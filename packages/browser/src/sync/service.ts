import { openDB } from "idb";
import {
  b64,
  binding,
  derive,
  digest,
  dpop,
  finishLogin,
  finishRegistration,
  keyStretching,
  login,
  newRoot,
  open,
  origin,
  proofKeys,
  random,
  registration,
  rootAAD,
  seal,
  serverScope,
  sign,
  unb64,
  validateRoot,
  vaultAAD,
  version,
  type Ciphertext,
  type ProofKeys,
  type RootSecrets,
} from "./crypto";

export class SyncError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code.replace(/_/g, " "));
  }
}
export interface Session {
  issuer: string;
  portal: string;
  account: string;
  username: string;
  token: string;
  device: string;
  scope: string;
  keys: ProofKeys;
  backupKey: CryptoKey;
  rootMaterial?: CryptoKey;
  recoverySigner?: CryptoKey;
  origin?: string;
  baseline?: Ciphertext;
  serverBaselines?: Record<string, Ciphertext>;
}
interface AuthReply {
  account_id: string;
  username: string;
  access_token: string;
  token_type: string;
  device_id: string;
  scope: string;
  wrapped_key: Ciphertext;
  recovery_wrapped_key?: Ciphertext;
}
interface Challenge {
  account_id: string;
  challenge_id: string;
  response: string;
}
export class SyncService {
  readonly issuer: string;
  readonly portal: string;
  constructor(
    issuer: string,
    portal: string,
    readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {
    this.issuer = origin(issuer);
    this.portal = origin(portal);
    if (issuer === portal)
      throw Error(
        "Use a separately trusted sign-in page, not the backup data service.",
      );
  }
  async request<T>(
    path: string,
    method = "GET",
    body?: unknown,
    keys?: ProofKeys,
    token?: string,
  ): Promise<T> {
    const url = this.issuer + path;
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (keys) headers.DPoP = await dpop(keys, method, url, token);
    if (token) headers.Authorization = "DPoP " + token;
    const response = await this.fetcher(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 204) return undefined as T;
    const result = await response.json();
    if (!response.ok)
      throw new SyncError(
        response.status,
        result.error ?? "sync_request_failed",
      );
    return result;
  }
  async register(
    username: string,
    password: string,
    keys: ProofKeys,
    emailTicket?: string,
  ) {
    const start = await registration(password);
    const challenge = await this.request<Challenge>(
      "/v1/auth/register/start",
      "POST",
      { username, request: start.registrationRequest },
    );
    const finish = finishRegistration(
      start,
      password,
      challenge.response,
      this.issuer,
      challenge.account_id,
    );
    const { secrets, publicKey } = await newRoot();
    const recoveryKey = random();
    const wrapped = await seal(
      await derive(
        finish.exportKey,
        "master-wrap",
        this.issuer,
        challenge.account_id,
      ),
      secrets,
      rootAAD(this.issuer, challenge.account_id, "master-wrap"),
    );
    const recoveryWrapped = await seal(
      await derive(
        recoveryKey,
        "recovery-wrap",
        this.issuer,
        challenge.account_id,
      ),
      secrets,
      rootAAD(this.issuer, challenge.account_id, "recovery-wrap"),
    );
    await this.request(
      "/v1/auth/register/finish",
      "POST",
      {
        challenge_id: challenge.challenge_id,
        record: finish.registrationRecord,
        wrapped_key: wrapped,
        recovery_public_key: publicKey,
        recovery_wrapped_key: recoveryWrapped,
        ...(emailTicket ? { email_ticket: emailTicket } : {}),
      },
      emailTicket ? keys : undefined,
    );
    return { recoveryKey };
  }
  private async session(
    reply: AuthReply,
    keys: ProofKeys,
    secrets: RootSecrets,
  ): Promise<Session> {
    if (
      reply.token_type !== "DPoP" ||
      reply.scope !== "full" ||
      !/^[A-Za-z0-9_-]{43}$/.test(reply.access_token)
    )
      throw Error("Invalid sync session.");
    validateRoot(secrets);
    const material = await crypto.subtle.importKey(
      "raw",
      unb64(secrets.root),
      "HKDF",
      false,
      ["deriveKey", "deriveBits"],
    );
    return {
      issuer: this.issuer,
      portal: this.portal,
      account: reply.account_id,
      username: reply.username,
      token: reply.access_token,
      device: reply.device_id,
      scope: "full",
      keys,
      rootMaterial: material,
      backupKey: await derive(
        secrets.root,
        "vault:full",
        this.issuer,
        reply.account_id,
      ),
      recoverySigner: await crypto.subtle.importKey(
        "jwk",
        secrets.recoverySigner,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["sign"],
      ),
    };
  }
  async signIn(
    username: string,
    password: string,
    providedKeys?: ProofKeys,
  ): Promise<Session> {
    const keys = providedKeys ?? (await proofKeys());
    const start = await login(password);
    const challenge = await this.request<Challenge>(
      "/v1/auth/login/start",
      "POST",
      { username, request: start.startLoginRequest, proof_key: keys.publicKey },
    );
    const finish = finishLogin(
      start,
      password,
      challenge.response,
      this.issuer,
      challenge.account_id,
    );
    const reply = await this.request<AuthReply>(
      "/v1/auth/login/finish",
      "POST",
      {
        challenge_id: challenge.challenge_id,
        message: finish.finishLoginRequest,
        binding: await binding(
          finish.sessionKey,
          this.issuer,
          challenge.challenge_id,
          keys.thumbprint,
        ),
        device_name: "Haunt",
      },
      keys,
    );
    try {
      const secrets = await open<RootSecrets>(
        await derive(
          finish.exportKey,
          "master-wrap",
          this.issuer,
          reply.account_id,
        ),
        reply.wrapped_key,
        rootAAD(this.issuer, reply.account_id, "master-wrap"),
      );
      return await this.session(reply, keys, secrets);
    } catch (error) {
      await this.request(
        "/v1/devices/current",
        "DELETE",
        undefined,
        keys,
        reply.access_token,
      ).catch(() => {});
      throw error;
    }
  }
  async emailStart(
    email: string,
    purpose: "registration" | "authentication" | "recovery" | "link",
    keys: ProofKeys,
  ) {
    return this.request<{ challenge_id: string }>(
      "/v1/email/start",
      "POST",
      { email, purpose, proof_key: keys.publicKey },
      keys,
    );
  }
  async emailVerify(challenge: string, token: string, keys: ProofKeys) {
    return this.request<{ email_ticket: string }>(
      "/v1/email/verify",
      "POST",
      { challenge_id: challenge, token },
      keys,
    );
  }
  async emailLogin(ticket: string, keys: ProofKeys) {
    return this.request<AuthReply>(
      "/v1/email/login",
      "POST",
      { email_ticket: ticket, device_name: "Haunt · email recovery" },
      keys,
    );
  }
  async recover(
    reply: AuthReply,
    keys: ProofKeys,
    recoveryKey: string,
    newPassword: string,
  ) {
    if (reply.scope !== "email" || !reply.recovery_wrapped_key)
      throw Error(
        "This account requires its master password or a trusted device.",
      );
    const secrets = validateRoot(
      await open<RootSecrets>(
        await derive(
          recoveryKey,
          "recovery-wrap",
          this.issuer,
          reply.account_id,
        ),
        reply.recovery_wrapped_key,
        rootAAD(this.issuer, reply.account_id, "recovery-wrap"),
      ),
    );
    const start = await registration(newPassword);
    const challenge = await this.request<Challenge>(
      "/v1/recovery/start",
      "POST",
      { request: start.registrationRequest },
      keys,
      reply.access_token,
    );
    const finish = finishRegistration(
      start,
      newPassword,
      challenge.response,
      this.issuer,
      reply.account_id,
    );
    const wrapped = await seal(
      await derive(
        finish.exportKey,
        "master-wrap",
        this.issuer,
        reply.account_id,
      ),
      secrets,
      rootAAD(this.issuer, reply.account_id, "master-wrap"),
    );
    const recoverySigner = await crypto.subtle.importKey(
      "jwk",
      secrets.recoverySigner,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
    const proof = await sign(
      recoverySigner,
      undefined,
      "haunt-sync-recovery+jwt",
      {
        issuer: this.issuer,
        account_id: reply.account_id,
        challenge_id: challenge.challenge_id,
        device_thumbprint: keys.thumbprint,
        record_hash: await digest(finish.registrationRecord),
        wrapped_key_hash: await digest(
          "1\0" + wrapped.nonce + "\0" + wrapped.data,
        ),
      },
    );
    await this.request(
      "/v1/recovery/finish",
      "POST",
      {
        challenge_id: challenge.challenge_id,
        record: finish.registrationRecord,
        wrapped_key: wrapped,
        recovery_proof: proof,
      },
      keys,
      reply.access_token,
    );
    return this.signIn(reply.username, newPassword, keys);
  }
  async scopeKey(session: Session, target: string) {
    const name = await serverScope(target);
    if (session.scope === name && session.origin === target)
      return session.backupKey;
    if (session.scope !== "full" || !session.rootMaterial)
      throw Error("This web session cannot access another server.");
    return crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new TextEncoder().encode(
          version + "\0" + this.issuer + "\0" + session.account,
        ),
        info: new TextEncoder().encode("vault:" + name),
      },
      session.rootMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }
  async read<T>(
    session: Session,
    name = session.scope,
    key = session.backupKey,
  ): Promise<{ revision: number; value?: T }> {
    const reply = await this.request<{
      revision: number;
      ciphertext: Ciphertext | null;
    }>(
      "/v1/vault/" + encodeURIComponent(name),
      "GET",
      undefined,
      session.keys,
      session.token,
    );
    if (
      !Number.isSafeInteger(reply.revision) ||
      reply.revision < 0 ||
      (reply.revision === 0) !== (reply.ciphertext === null)
    )
      throw Error("Invalid sync revision.");
    return {
      revision: reply.revision,
      ...(reply.ciphertext
        ? {
            value: await open<T>(
              key,
              reply.ciphertext,
              vaultAAD(this.issuer, session.account, name, reply.revision),
            ),
          }
        : {}),
    };
  }
  async write(
    session: Session,
    value: unknown,
    expected: number,
    name = session.scope,
    key = session.backupKey,
  ) {
    if (!Number.isSafeInteger(expected) || expected < 0)
      throw Error("Invalid sync revision.");
    const encrypted = await seal(
      key,
      value,
      vaultAAD(this.issuer, session.account, name, expected + 1),
    );
    return this.request<{ revision: number }>(
      "/v1/vault/" + encodeURIComponent(name),
      "PUT",
      { expected_revision: expected, ciphertext: encrypted },
      session.keys,
      session.token,
    );
  }
  async logout(session: Session) {
    await this.request(
      "/v1/devices/current",
      "DELETE",
      undefined,
      session.keys,
      session.token,
    );
  }
}

const db = () =>
  openDB("haunt-sync-device-v1", 1, {
    upgrade(value) {
      value.createObjectStore("sessions");
    },
  });
export async function loadSession(): Promise<Session | undefined> {
  return (await db()).get("sessions", "active");
}
export class SyncSessionReplaced extends Error {
  constructor() {
    super(
      "The sync session changed in another window. This window stopped syncing.",
    );
  }
}
export async function saveSession(session: Session, replace = true) {
  const tx = (await db()).transaction("sessions", "readwrite");
  const current: Session | undefined = await tx.store.get("active");
  if (
    !replace &&
    (!current ||
      current.device !== session.device ||
      current.token !== session.token ||
      current.account !== session.account ||
      current.issuer !== session.issuer)
  ) {
    await tx.done;
    throw new SyncSessionReplaced();
  }
  await tx.store.put(session, "active");
  await tx.done;
}
export async function forgetSession() {
  await (await db()).delete("sessions", "active");
}
interface Revocation {
  issuer: string;
  portal: string;
  token: string;
  keys: ProofKeys;
  device: string;
}
export async function queueRevocation(session: Session) {
  const store = await db();
  const tx = store.transaction("sessions", "readwrite");
  const pending: Revocation[] = (await tx.store.get("revocations")) ?? [];
  pending.push({
    issuer: session.issuer,
    portal: session.portal,
    token: session.token,
    keys: session.keys,
    device: session.device,
  });
  await tx.store.put(pending, "revocations");
  const current: Session | undefined = await tx.store.get("active");
  if (current?.device === session.device && current.token === session.token)
    await tx.store.delete("active");
  await tx.done;
}
export async function finishRevocations() {
  const store = await db(),
    pending: Revocation[] = (await store.get("sessions", "revocations")) ?? [];
  for (const value of pending) {
    try {
      await new SyncService(value.issuer, value.portal).request(
        "/v1/devices/current",
        "DELETE",
        undefined,
        value.keys,
        value.token,
      );
    } catch (e) {
      if (!(
        e instanceof SyncError &&
        e.status === 401 &&
        e.code === "session_revoked"
      ))
        throw e;
    }
    const tx = store.transaction("sessions", "readwrite");
    const latest: Revocation[] = (await tx.store.get("revocations")) ?? [];
    await tx.store.put(
      latest.filter((item) => item.device !== value.device),
      "revocations",
    );
    await tx.done;
  }
}
