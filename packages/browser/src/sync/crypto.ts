import * as opaque from "@serenity-kit/opaque";
import { serverOrigin } from "@haunt/core";

export const version = "haunt-sync-v1";
const encode = new TextEncoder();
export function b64(bytes: Uint8Array<ArrayBuffer>): string {
  let value = "";
  for (let i = 0; i < bytes.length; i += 8192)
    value += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw Error("Invalid sync encoding.");
  return Uint8Array.from(
    atob(value.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0),
  );
}
export function origin(value: string): string {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.origin !== value ||
    url.username ||
    url.password
  )
    throw Error("Use an HTTPS origin without a path.");
  return url.origin;
}
export const random = () => b64(crypto.getRandomValues(new Uint8Array(32)));
export const digest = async (value: string) =>
  b64(
    new Uint8Array(await crypto.subtle.digest("SHA-256", encode.encode(value))),
  );
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
      .join(",") +
    "}"
  );
}
export const serverScope = async (value: string) => {
  if (serverOrigin(value) !== value) throw Error("Invalid community origin.");
  return "server:" + (await digest(value));
};
export interface Ciphertext {
  version: 1;
  nonce: string;
  data: string;
}
export interface RootSecrets {
  version: 1;
  root: string;
  recoverySigner: JsonWebKey;
}
export interface ProofKeys {
  privateKey: CryptoKey;
  publicKey: JsonWebKey;
  thumbprint: string;
}
export async function proofKeys(): Promise<ProofKeys> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return {
    privateKey: pair.privateKey,
    publicKey: jwk,
    thumbprint: await digest(
      JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }),
    ),
  };
}
export async function sign(
  privateKey: CryptoKey,
  publicKey: JsonWebKey | undefined,
  type: string,
  payload: unknown,
) {
  const header = b64(
    encode.encode(
      JSON.stringify({
        alg: "ES256",
        typ: type,
        ...(publicKey ? { jwk: publicKey } : {}),
      }),
    ),
  );
  const body = b64(encode.encode(JSON.stringify(payload)));
  const message = header + "." + body;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    encode.encode(message),
  );
  return message + "." + b64(new Uint8Array(signature));
}
export async function dpop(
  keys: ProofKeys,
  method: string,
  url: string,
  token?: string,
) {
  const target = new URL(url);
  target.search = "";
  target.hash = "";
  return sign(keys.privateKey, keys.publicKey, "dpop+jwt", {
    jti: random(),
    htm: method,
    htu: target.href,
    iat: Math.floor(Date.now() / 1000),
    ...(token ? { ath: await digest(token) } : {}),
  });
}
export async function derive(
  secret: string,
  purpose: string,
  issuer: string,
  account: string,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    unb64(secret),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encode.encode(version + "\0" + issuer + "\0" + account),
      info: encode.encode(purpose),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
export async function seal(
  key: CryptoKey,
  value: unknown,
  associated: unknown,
): Promise<Ciphertext> {
  const plain = encode.encode(JSON.stringify(value));
  if (plain.length > 20 * 1024 * 1024)
    throw Error("Sync backup exceeds 20 MiB.");
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const result = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData: encode.encode(JSON.stringify(associated)),
    },
    key,
    plain,
  );
  plain.fill(0);
  return { version: 1, nonce: b64(nonce), data: b64(new Uint8Array(result)) };
}
export async function open<T>(
  key: CryptoKey,
  value: Ciphertext,
  associated: unknown,
): Promise<T> {
  if (
    value.version !== 1 ||
    value.data.length > 30 * 1024 * 1024 ||
    unb64(value.nonce).length !== 12
  )
    throw Error("Invalid encrypted sync data.");
  const plain = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: unb64(value.nonce),
      additionalData: encode.encode(JSON.stringify(associated)),
    },
    key,
    unb64(value.data),
  );
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plain));
  } finally {
    new Uint8Array(plain).fill(0);
  }
}
export const rootAAD = (issuer: string, account: string, kind: string) => [
  version,
  issuer,
  account,
  kind,
];
export const vaultAAD = (
  issuer: string,
  account: string,
  scope: string,
  revision: number,
) => [version, issuer, account, scope, revision];
export async function newRoot(): Promise<{
  secrets: RootSecrets;
  publicKey: JsonWebKey;
}> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  return {
    secrets: {
      version: 1,
      root: random(),
      recoverySigner: await crypto.subtle.exportKey("jwk", pair.privateKey),
    },
    publicKey: await crypto.subtle.exportKey("jwk", pair.publicKey),
  };
}
export function validateRoot(value: RootSecrets): RootSecrets {
  if (
    value.version !== 1 ||
    unb64(value.root).length !== 32 ||
    value.recoverySigner.kty !== "EC" ||
    value.recoverySigner.crv !== "P-256" ||
    !value.recoverySigner.d
  )
    throw Error("Invalid sync recovery data.");
  return value;
}
export async function binding(
  sessionKey: string,
  issuer: string,
  challenge: string,
  thumbprint: string,
) {
  const key = await crypto.subtle.importKey(
    "raw",
    unb64(sessionKey),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  return b64(
    new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        key,
        encode.encode(
          version + "\0" + issuer + "\0" + challenge + "\0" + thumbprint,
        ),
      ),
    ),
  );
}
export const keyStretching = {
  "argon2id-custom": { iterations: 3, memory: 65536, parallelism: 4 },
} as const;
export async function registration(password: string) {
  if ([...password].length < 12 || encode.encode(password).length > 1024)
    throw Error(
      "Use a master password of at least 12 characters, up to 1024 bytes.",
    );
  await opaque.ready;
  return opaque.client.startRegistration({ password });
}
export function finishRegistration(
  start: ReturnType<typeof opaque.client.startRegistration>,
  password: string,
  response: string,
  issuer: string,
  account: string,
) {
  return opaque.client.finishRegistration({
    ...start,
    password,
    registrationResponse: response,
    identifiers: { client: account, server: version + " " + issuer },
    keyStretching,
  });
}
export async function login(password: string) {
  await opaque.ready;
  return opaque.client.startLogin({ password });
}
export function finishLogin(
  start: ReturnType<typeof opaque.client.startLogin>,
  password: string,
  response: string,
  issuer: string,
  account: string,
) {
  const result = opaque.client.finishLogin({
    ...start,
    password,
    loginResponse: response,
    identifiers: { client: account, server: version + " " + issuer },
    keyStretching,
  });
  if (!result)
    throw Error(
      "The master password is incorrect or the sync service could not authenticate.",
    );
  return result;
}
