import {
  b64,
  canonical,
  digest,
  open,
  origin,
  proofKeys,
  random,
  seal,
  serverScope,
  unb64,
  version,
  type Ciphertext,
} from "./crypto";
import { SyncService, type Session } from "./service";

export interface WebRequest {
  authorization_id: string;
  issuer: string;
  portal: string;
  request: {
    client_id: string;
    redirect_uri: string;
    code_challenge: string;
    code_challenge_method: "S256";
    proof_key: JsonWebKey;
    request_hash: string;
    device_name: string;
    state: string;
  };
  exchange_public_key: JsonWebKey;
}
export interface WrappedScope extends Ciphertext {
  public_key: JsonWebKey;
  account_id: string;
  request_hash: string;
}
export async function requestHash(value: Omit<WebRequest, "authorization_id">) {
  const proof = value.request.proof_key,
    exchange = value.exchange_public_key;
  return digest(
    JSON.stringify([
      version,
      value.issuer,
      value.portal,
      value.request.client_id,
      value.request.redirect_uri,
      value.request.code_challenge,
      value.request.code_challenge_method,
      value.request.state,
      value.request.device_name,
      [proof.kty, proof.crv, proof.x, proof.y],
      [exchange.kty, exchange.crv, exchange.x, exchange.y],
    ]),
  );
}
export async function exchangeKey(
  privateKey: CryptoKey,
  publicKey: JsonWebKey,
  context: string,
) {
  if (publicKey.kty !== "EC" || publicKey.crv !== "P-256" || publicKey.d)
    throw Error("Invalid web exchange key.");
  const publicCryptoKey = await crypto.subtle.importKey(
    "jwk",
    publicKey,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = await crypto.subtle.deriveBits(
    { name: "ECDH", public: publicCryptoKey },
    privateKey,
    256,
  );
  const material = await crypto.subtle.importKey("raw", shared, "HKDF", false, [
    "deriveKey",
  ]);
  new Uint8Array(shared).fill(0);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode(context),
      info: new TextEncoder().encode(version + "\0oauth-key-wrap"),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
export async function approveWeb(
  service: SyncService,
  session: Session,
  request: WebRequest,
  senderOrigin: string,
) {
  if (
    origin(senderOrigin) !== request.request.client_id ||
    request.issuer !== service.issuer ||
    request.portal !== service.portal ||
    (await requestHash(request)) !== request.request.request_hash ||
    request.request.redirect_uri !== senderOrigin + "/?haunt-sync-callback=1" ||
    request.request.code_challenge_method !== "S256"
  )
    throw Error(
      "The web authorization request does not match its browser origin.",
    );
  if (session.scope !== "full" || !session.rootMaterial)
    throw Error("Unlock the desktop backup before approving this server.");
  const name = await serverScope(senderOrigin);
  const raw = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode(
        version + "\0" + service.issuer + "\0" + session.account,
      ),
      info: new TextEncoder().encode("vault:" + name),
    },
    session.rootMaterial,
    256,
  );
  const pair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
  const cipher = await seal(
    await exchangeKey(
      pair.privateKey,
      request.exchange_public_key,
      request.request.request_hash,
    ),
    {
      key: b64(new Uint8Array(raw)),
      account_id: session.account,
      origin: senderOrigin,
      scope: name,
    },
    [
      version,
      service.issuer,
      session.account,
      senderOrigin,
      request.request.request_hash,
    ],
  );
  new Uint8Array(raw).fill(0);
  const wrapped: WrappedScope = {
    ...cipher,
    public_key: await crypto.subtle.exportKey("jwk", pair.publicKey),
    account_id: session.account,
    request_hash: request.request.request_hash,
  };
  const reply = await service.request<{ code: string; redirect_uri: string }>(
    "/v1/oauth/authorize/" + request.authorization_id + "/approve",
    "POST",
    {
      request_hash: request.request.request_hash,
      origin: senderOrigin,
      wrapped_scope_key: wrapped,
    },
    session.keys,
    session.token,
  );
  const redirect = new URL(reply.redirect_uri);
  if (
    redirect.origin !== senderOrigin ||
    redirect.pathname !== "/" ||
    redirect.searchParams.get("state") !== request.request.state ||
    redirect.searchParams.get("iss") !== service.issuer ||
    redirect.searchParams.get("code") !== reply.code
  )
    throw Error("The authorization response does not match the request.");
  return {
    authorization_id: request.authorization_id,
    code: reply.code,
    state: request.request.state,
    issuer: service.issuer,
    wrapped_scope_key: wrapped,
  };
}
const requestPrefix = "haunt-sync-pair-v1.";
const approvalPrefix = "haunt-sync-approval-v1.";
const encodePackage = (prefix: string, value: unknown) =>
  prefix + b64(new TextEncoder().encode(JSON.stringify(value)));
function decodePackage<T>(prefix: string, text: string): T {
  const value = text.trim();
  if (!value.startsWith(prefix) || value.length > 16384)
    throw Error("Invalid sync pairing code.");
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(
      unb64(value.slice(prefix.length)),
    ),
  );
}
export const pairingFingerprint = (request: WebRequest) =>
  request.request.request_hash
    .slice(0, 24)
    .match(/.{1,6}/g)!
    .join(" ");
export async function parsePairingRequest(text: string): Promise<WebRequest> {
  const request = decodePackage<WebRequest>(requestPrefix, text);
  if (
    !request ||
    origin(request.issuer) !== request.issuer ||
    request.portal !== request.issuer ||
    origin(request.request.client_id) !== request.request.client_id ||
    request.request.redirect_uri !==
      request.request.client_id + "/?haunt-sync-callback=1" ||
    request.request.code_challenge_method !== "S256" ||
    !/^[A-Za-z0-9_-]{43}$/.test(request.authorization_id) ||
    !/^[A-Za-z0-9_-]{43}$/.test(request.request.state) ||
    !/^[A-Za-z0-9_-]{43}$/.test(request.request.code_challenge) ||
    (await requestHash(request)) !== request.request.request_hash
  )
    throw Error("The pairing request was changed or is invalid.");
  for (const [key, algorithm] of [
    [request.request.proof_key, "ECDSA"],
    [request.exchange_public_key, "ECDH"],
  ] as const) {
    if (key.d || key.kty !== "EC" || key.crv !== "P-256")
      throw Error("Pairing codes must contain only public keys.");
    await crypto.subtle.importKey(
      "jwk",
      key,
      { name: algorithm, namedCurve: "P-256" },
      false,
      algorithm === "ECDSA" ? ["verify"] : [],
    );
  }
  return request;
}
export async function approvePairing(session: Session, text: string) {
  const request = await parsePairingRequest(text);
  if (request.issuer !== session.issuer)
    throw Error("Choose the same sync instance on both devices.");
  const reply = await approveWeb(
    new SyncService(session.issuer),
    session,
    request,
    request.request.client_id,
  );
  return encodePackage(approvalPrefix, reply);
}
export async function beginWebPairing(
  service: SyncService,
  browserOrigin = location.origin,
) {
  const clientOrigin = origin(browserOrigin);
  const keys = await proofKeys(),
    verifier = random(),
    state = random();
  const pair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
  const request: WebRequest = {
    authorization_id: "",
    issuer: service.issuer,
    portal: service.issuer,
    exchange_public_key: await crypto.subtle.exportKey("jwk", pair.publicKey),
    request: {
      client_id: clientOrigin,
      redirect_uri: clientOrigin + "/?haunt-sync-callback=1",
      code_challenge: await digest(verifier),
      code_challenge_method: "S256",
      proof_key: keys.publicKey,
      request_hash: "",
      device_name: "Browser · " + new URL(clientOrigin).host,
      state,
    },
  };
  request.request.request_hash = await requestHash(request);
  const start = await service.request<{
    authorization_id: string;
    scope: string;
  }>("/v1/oauth/authorize", "POST", request.request, keys);
  if (start.scope !== (await serverScope(clientOrigin)))
    throw Error("The service requested an incorrect web scope.");
  request.authorization_id = start.authorization_id;
  return {
    request,
    requestCode: encodePackage(requestPrefix, request),
    async complete(text: string): Promise<Session> {
      const consent = decodePackage<Awaited<ReturnType<typeof approveWeb>>>(
        approvalPrefix,
        text,
      );
      if (
        consent.authorization_id !== request.authorization_id ||
        consent.state !== state ||
        consent.issuer !== service.issuer ||
        !/^[A-Za-z0-9_-]{43}$/.test(consent.code) ||
        consent.wrapped_scope_key.request_hash !== request.request.request_hash
      )
        throw Error(
          "The approval does not match this browser's pairing request.",
        );
      const reply = await service.request<{
        access_token: string;
        token_type: string;
        device_id: string;
        account_id: string;
        scope: string;
        origin: string;
        wrapped_scope_key: WrappedScope;
      }>(
        "/v1/oauth/token",
        "POST",
        {
          grant_type: "authorization_code",
          code: consent.code,
          code_verifier: verifier,
          client_id: clientOrigin,
          redirect_uri: request.request.redirect_uri,
        },
        keys,
      );
      if (
        (await digest(canonical(reply.wrapped_scope_key))) !==
          (await digest(canonical(consent.wrapped_scope_key))) ||
        reply.token_type !== "DPoP" ||
        reply.account_id !== consent.wrapped_scope_key.account_id ||
        reply.origin !== clientOrigin ||
        reply.scope !== (await serverScope(clientOrigin))
      )
        throw Error("The service changed the approved key package.");
      const value = await open<{
        key: string;
        account_id: string;
        origin: string;
        scope: string;
      }>(
        await exchangeKey(
          pair.privateKey,
          consent.wrapped_scope_key.public_key,
          request.request.request_hash,
        ),
        consent.wrapped_scope_key,
        [
          version,
          service.issuer,
          reply.account_id,
          clientOrigin,
          request.request.request_hash,
        ],
      );
      if (
        value.account_id !== reply.account_id ||
        value.origin !== clientOrigin ||
        value.scope !== reply.scope ||
        unb64(value.key).length !== 32
      )
        throw Error("Invalid server key package.");
      return {
        issuer: service.issuer,
        portal: service.issuer,
        account: reply.account_id,
        username: "",
        token: reply.access_token,
        device: reply.device_id,
        scope: reply.scope,
        origin: clientOrigin,
        keys,
        backupKey: await crypto.subtle.importKey(
          "raw",
          unb64(value.key),
          "AES-GCM",
          false,
          ["encrypt", "decrypt"],
        ),
      };
    },
  };
}
