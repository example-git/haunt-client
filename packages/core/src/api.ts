import createClient from "openapi-fetch";
import type { paths } from "./generated/api.js";
import type { Instance, Runtime } from "./types.js";
import { localHTTPHost } from "./network.js";
export class APIError extends Error {
  constructor(
    public status: number,
    public code: string,
    public details?: { ban_type?: string; appeal_ticket?: string },
  ) {
    super(code);
    this.name = "APIError";
  }
}
export function serverOrigin(input: string): string {
  const url = new URL(input.includes("://") ? input : `https://${input}`);
  const local = localHTTPHost(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw Error(
      "Enter an HTTPS server address, without a path. HTTP is allowed for localhost and private-network IP addresses.",
    );
  return url.origin;
}
export function socketURL(origin: string, path: string) {
  if (
    !path.startsWith("/api/v1/") ||
    path.startsWith("//") ||
    path.includes("?") ||
    path.includes("#") ||
    path.includes("\\")
  )
    throw Error("Invalid server socket path");
  const url = new URL(path, origin);
  if (url.origin !== origin) throw Error("Cross-server socket rejected");
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}
export function api(
  origin: string,
  runtime: Pick<Runtime, "fetch">,
  token?: string,
) {
  const base = serverOrigin(origin);
  return createClient<paths>({
    baseUrl: base,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
    fetch: (input: Request) => {
      if (new URL(input.url).origin !== base)
        throw Error("Cross-server request rejected");
      // Callers can supply a shorter cancellation signal; every request is bounded.
      return runtime.fetch(
        new Request(input, {
          signal: AbortSignal.any([input.signal, AbortSignal.timeout(30_000)]),
        }),
      );
    },
  });
}
export async function unwrap<T>(
  promise: Promise<{
    data?: T;
    error?: { error: string; ban_type?: string; appeal_ticket?: string };
    response: Response;
  }>,
): Promise<T> {
  const { data, error, response } = await promise;
  if (!response.ok)
    throw new APIError(
      response.status,
      error?.error ?? `http_${response.status}`,
      error,
    );
  return data as T;
}
export async function discover(
  origin: string,
  runtime: Pick<Runtime, "fetch">,
): Promise<Instance> {
  const instance = await unwrap(api(origin, runtime).GET("/api/v1/instance"));
  if (instance.api_version !== "v1" || !instance.instance_id)
    throw Error("This server uses an unsupported API version.");
  return instance;
}
/** Bounded advisory dependency probe; never an authentication gate. */
export async function checkReadiness(
  origin: string,
  runtime: Pick<Runtime, "fetch">,
  signal?: AbortSignal,
) {
  const response = await runtime.fetch(
    new Request(serverOrigin(origin) + "/readyz", {
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.any([
        AbortSignal.timeout(5000),
        ...(signal ? [signal] : []),
      ]),
    }),
  );
  // A readiness failure is never an account/session failure, even behind a proxy.
  if (!response.ok) {
    await response.body?.cancel();
    throw new APIError(503, "server_not_ready");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new APIError(503, "server_not_ready");
  let body = "";
  try {
    const decoder = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      body += decoder.decode(value, { stream: true });
      if (body.length > 4096) throw new APIError(503, "server_not_ready");
    }
    if (JSON.parse(body).status !== "ok") throw Error("Unavailable");
  } catch {
    throw new APIError(503, "server_not_ready");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export function friendlyError(error: unknown): string {
  const codes: Record<string, string> = {
    server_not_ready:
      "Waiting for the server to be ready. Reconnecting automatically…",
    password_change_required: "Sign in and choose a new password to continue.",
    password_unchanged:
      "Choose a different password from your temporary password.",
    unauthorized: "Your session has ended. Sign in again.",
    invalid_credentials:
      "The username or password is incorrect for this server.",
    banned: "Access to this server is banned.",
    kicked:
      "This account was kicked. Use a new invitation and your existing password to return.",
    forbidden: "You do not have permission for this action.",
    invalid_invitation: "That invitation is invalid, expired, or already used.",
    invalid_request: "Check the fields and try again.",
    not_found: "This item is no longer available.",
    conflict: "This conflicts with an existing item.",
    session_limit_reached:
      "The server session limit has been reached. Revoke an old session first.",
    rate_limited: "Too many requests. Wait a moment and try again.",
    authentication_busy: "The server is busy. Try again shortly.",
    invalid_configuration:
      "Check the limits: each upload must fit the attachment budget, and all values must be within the displayed ranges.",
    attachment_budget_too_small:
      "The attachment budget is below the space currently reserved by files and uploads. Refresh the settings and choose a larger budget.",
    registration_closed:
      "This server has temporarily closed account registration.",
    invalid_storage_provider:
      "Check the provider address, folder, bucket, region and credentials.",
    storage_provider_in_use:
      "This provider is active or still holds files. Switch providers and wait for those files to expire before removing it.",
    storage_provider_unavailable:
      "The storage provider could not complete the operation. Check connectivity, credentials and read/write/delete permissions.",
    audio_plugin_hash_mismatch:
      "The package does not match the supplied SHA-256. Nothing was installed.",
    audio_plugin_repository_unavailable:
      "The repository package could not be downloaded. Check its URL, commit ID and the server’s access to private repositories.",
    invalid_audio_plugin:
      "Check the repository, full commit ID and checksum, or use a compatible plugin package under 50 MiB.",
    audio_plugin_busy:
      "Another plugin installation is in progress. Try again shortly.",
    dm_storage_full:
      "DM image storage is full for your account or this server. Purge older uploads or ask the administrator to increase the limit.",
    dm_message_storage_full:
      "This server's DM message storage is full. Ask its administrator to increase the limit or adjust DM retention.",
    dm_transfer_limit:
      "The daily DM image transfer allowance has been reached. It resets at midnight UTC.",
    dm_images_disabled: "This server has disabled DM image uploads.",
    dm_encryption_required:
      "This DM requires end-to-end encryption. Update your client and reconnect.",
    dm_epoch_changed: "DM devices changed while sending. Retry the message.",
    attachment_storage_full: "The server has no attachment space available.",
  };
  if (error instanceof APIError)
    return (
      codes[error.code] ??
      `The server could not complete this action (${error.code}).`
    );
  if (error instanceof TypeError)
    return "Cannot reach this server. Check the address, connection, and the host’s allowed client origins.";
  return error instanceof Error
    ? error.message
    : "Something went wrong. Try again.";
}
