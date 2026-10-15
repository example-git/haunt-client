import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import {
  approveWeb,
  requestHash,
  exchangeKey,
  type WebRequest,
} from "../packages/browser/src/sync/oauth";
import {
  canonical,
  digest,
  dpop,
  newRoot,
  open,
  proofKeys,
  random,
  seal,
  serverScope,
  version,
} from "../packages/browser/src/sync/crypto";
import {
  SyncService,
  SyncError,
  loadSession,
  saveSession,
  forgetSession,
} from "../packages/browser/src/sync/service";

const issuer = process.env.HAUNT_SYNC_TEST_ISSUER,
  portal = process.env.HAUNT_SYNC_TEST_PORTAL!;
describe.skipIf(!issuer)("real sync Go API and browser OPAQUE", () => {
  it("restores encrypted content, confines OAuth, rejects replay, and recovers without exposing keys", async () => {
    const service = new SyncService(issuer!, portal),
      keys = await proofKeys();
    const email =
        "sync-" + random().slice(0, 10).toLowerCase() + "@example.test",
      password = "correct master password " + random();
    const sent = await service.emailStart(email, "registration", keys);
    const links: string[] = await (await fetch(issuer + "/test/mail")).json();
    const link = new URL(links.at(-1)!);
    const params = new URLSearchParams(link.hash.slice(1));
    expect(params.get("email_id")).toBe(sent.challenge_id);
    const ticket = await service.emailVerify(
      sent.challenge_id,
      params.get("email_token")!,
      keys,
    );
    const registered = await service.register(
      email,
      password,
      keys,
      ticket.email_ticket,
    );
    const first = await service.signIn(email, password, keys);
    await expect(
      service.signIn(email, "incorrect master password"),
    ).rejects.toThrow();
    await expect(service.signIn("unknown-account", password)).rejects.toThrow();
    expect(first.rootMaterial?.extractable).toBe(false);
    expect(first.keys.privateKey.extractable).toBe(false);
    const backup = {
      server: "https://community.example.test",
      login: "synthetic-community-secret",
      settings: { theme: "frosted" },
    };
    expect((await service.write(first, backup, 0)).revision).toBe(1);
    const second = await service.signIn(email, password);
    expect((await service.read(second)).value).toEqual(backup);
    await saveSession(second);
    const durable = await loadSession();
    expect(durable!.keys.privateKey.extractable).toBe(false);
    expect((await service.read(durable!)).value).toEqual(backup);
    await forgetSession();
    const races = await Promise.allSettled([
      service.write(first, { ...backup, writer: "first" }, 1),
      service.write(second, { ...backup, writer: "second" }, 1),
    ]);
    expect(races.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (races.find((r) => r.status === "rejected") as PromiseRejectedResult)
        .reason.status,
    ).toBe(409);
    const target = issuer + "/v1/vault/full",
      proof = await dpop(first.keys, "GET", target, first.token);
    const headers = { Authorization: "DPoP " + first.token, DPoP: proof };
    expect((await fetch(target, { headers })).status).toBe(200);
    expect((await fetch(target, { headers })).status).toBe(401);
    const stolen = await proofKeys();
    await expect(
      service.request("/v1/vault/full", "GET", undefined, stolen, first.token),
    ).rejects.toMatchObject({ status: 401 });
    await fetch(issuer + "/test/age", { method: "POST" });
    expect((await service.read(first)).revision).toBe(2);
    const stranger = await proofKeys();
    await service.register("other-account", password, stranger);
    const other = await service.signIn("other-account", password, stranger);
    expect((await service.read(other)).revision).toBe(0);
    const caller = "https://one-community.example.test",
      webKeys = await proofKeys(),
      verifier = random(),
      state = random();
    const pair = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"],
    );
    const request: WebRequest = {
      issuer: issuer!,
      portal,
      authorization_id: "",
      exchange_public_key: await crypto.subtle.exportKey("jwk", pair.publicKey),
      request: {
        client_id: caller,
        redirect_uri: caller + "/?haunt-sync-callback=1",
        code_challenge: await digest(verifier),
        code_challenge_method: "S256",
        proof_key: webKeys.publicKey,
        request_hash: "",
        device_name: "test web",
        state,
      },
    };
    request.request.request_hash = await requestHash(request);
    const auth = await service.request<{ authorization_id: string }>(
      "/v1/oauth/authorize",
      "POST",
      request.request,
      webKeys,
    );
    request.authorization_id = auth.authorization_id;
    await expect(
      approveWeb(service, first, request, "https://wrong.example.test"),
    ).rejects.toThrow();
    const grant = await approveWeb(service, first, request, caller);
    const exchange = {
      grant_type: "authorization_code",
      code: grant.code,
      code_verifier: verifier,
      client_id: caller,
      redirect_uri: request.request.redirect_uri,
    };
    await expect(
      service.request(
        "/v1/oauth/token",
        "POST",
        { ...exchange, code_verifier: random() },
        webKeys,
      ),
    ).rejects.toMatchObject({ status: 400 });
    const web = await service.request<any>(
      "/v1/oauth/token",
      "POST",
      exchange,
      webKeys,
    );
    expect(web.scope).toBe(await serverScope(caller));
    expect(web.origin).toBe(caller);
    await expect(
      service.request("/v1/oauth/token", "POST", exchange, webKeys),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.request(
        "/v1/vault/full",
        "GET",
        undefined,
        webKeys,
        web.access_token,
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.request(
        "/v1/vault/" + (await serverScope("https://other.example.test")),
        "GET",
        undefined,
        webKeys,
        web.access_token,
      ),
    ).rejects.toMatchObject({ status: 403 });
    const unwrap = await exchangeKey(
      pair.privateKey,
      grant.wrapped_scope_key.public_key,
      request.request.request_hash,
    );
    const wrapped = await open<any>(unwrap, grant.wrapped_scope_key, [
      version,
      issuer,
      first.account,
      caller,
      request.request.request_hash,
    ]);
    expect(wrapped.scope).toBe(web.scope);
    const scopedKey = await service.scopeKey(first, caller),
      ciphertext = await seal(scopedKey, backup, ["scope-test"]);
    await expect(
      open(
        await service.scopeKey(first, "https://other.example.test"),
        ciphertext,
        ["scope-test"],
      ),
    ).rejects.toThrow();
    await expect(
      open(first.backupKey, ciphertext, ["scope-test"]),
    ).rejects.toThrow();
    const recoveringKeys = await proofKeys();
    const recovery = await service.emailStart(
      email,
      "recovery",
      recoveringKeys,
    );
    const recoveryLinks: string[] = await (
      await fetch(issuer + "/test/mail")
    ).json();
    const recoveryParams = new URLSearchParams(
      new URL(recoveryLinks.at(-1)!).hash.slice(1),
    );
    const recoveryTicket = await service.emailVerify(
      recovery.challenge_id,
      recoveryParams.get("email_token")!,
      recoveringKeys,
    );
    const emailSession = await service.emailLogin(
      recoveryTicket.email_ticket,
      recoveringKeys,
    );
    expect(emailSession.scope).toBe("email");
    await expect(
      service.request(
        "/v1/vault/full",
        "GET",
        undefined,
        recoveringKeys,
        emailSession.access_token,
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.recover(
        emailSession,
        recoveringKeys,
        random(),
        "new master password " + random(),
      ),
    ).rejects.toThrow();
    const newPassword = "new master password " + random();
    const restored = await service.recover(
      emailSession,
      recoveringKeys,
      registered.recoveryKey,
      newPassword,
    );
    expect((await service.read(restored)).revision).toBe(2);
    const parallel = await Promise.all(
      Array.from({ length: 16 }, () => service.signIn(email, newPassword)),
    );
    expect(new Set(parallel.map((session) => session.device)).size).toBe(16);
    await Promise.all(parallel.map((session) => service.logout(session)));
    await expect(service.read(first)).rejects.toMatchObject({ status: 401 });
    await expect(service.signIn(email, password)).rejects.toThrow();
    expect((await (await fetch(issuer + "/test/plaintext")).json()).found).toBe(
      false,
    );
    await service.logout(restored);
    await expect(service.read(restored)).rejects.toMatchObject({ status: 401 });
  }, 120_000);
});
