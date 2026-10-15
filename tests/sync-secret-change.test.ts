import { describe, expect, it } from "vitest";
import {
  SyncSecretsChangeUncertain,
  SyncService,
  type Session,
} from "../packages/browser/src/sync/service";
import {
  binding,
  derive,
  finishLogin,
  finishRegistration,
  login,
  newRoot,
  proofKeys,
  random,
  registration,
  rootAAD,
  seal,
  unb64,
} from "../packages/browser/src/sync/crypto";

const issuer = process.env.HAUNT_SYNC_TEST_ISSUER;
describe.skipIf(!issuer)(
  "real secret-change failure and legacy upgrade",
  () => {
    it("reports a lost commit acknowledgement without pretending old secrets still work", async () => {
      const service = new SyncService(issuer!),
        password = "synthetic old password " + random(),
        keyword = "synthetic old private keyword " + random();
      await service.register(
        "uncertain-change",
        password,
        await proofKeys(),
        undefined,
        keyword,
      );
      const old = await service.signIn(
        "uncertain-change",
        password,
        undefined,
        keyword,
      );
      await service.write(old, { credential: "synthetic-community-secret" }, 0);
      const dropped = new SyncService(
        issuer!,
        issuer!,
        async (url, options) => {
          const response = await fetch(url, options);
          if (String(url).endsWith("/v1/recovery/finish") && response.ok)
            throw TypeError("synthetic lost acknowledgement");
          return response;
        },
      );
      const nextPassword = "synthetic new password " + random(),
        nextKeyword = "synthetic new private keyword " + random();
      await expect(
        dropped.changePassword(
          old,
          password,
          keyword,
          nextPassword,
          nextKeyword,
        ),
      ).rejects.toBeInstanceOf(SyncSecretsChangeUncertain);
      await expect(service.read(old)).rejects.toMatchObject({ status: 401 });
      const fresh = await service.signIn(
        "uncertain-change",
        nextPassword,
        undefined,
        nextKeyword,
      );
      expect((await service.read(fresh)).value).toEqual({
        credential: "synthetic-community-secret",
      });
      await service.logout(fresh);
    });
    it("upgrades an actual password-only encrypted account from its cached desktop session", async () => {
      const service = new SyncService(issuer!),
        password = "synthetic legacy password " + random(),
        keys = await proofKeys();
      const start = await registration(password);
      const challenge = await service.request<{
        response: string;
        account_id: string;
        challenge_id: string;
      }>("/v1/auth/register/start", "POST", {
        username: "legacy-change",
        request: start.registrationRequest,
      });
      const finished = finishRegistration(
          start,
          password,
          challenge.response,
          issuer!,
          challenge.account_id,
        ),
        root = await newRoot();
      await service.request("/v1/auth/register/finish", "POST", {
        challenge_id: challenge.challenge_id,
        record: finished.registrationRecord,
        wrapped_key: await seal(
          await derive(
            finished.exportKey,
            "master-wrap",
            issuer!,
            challenge.account_id,
          ),
          root.secrets,
          rootAAD(issuer!, challenge.account_id, "master-wrap"),
        ),
        recovery_public_key: root.publicKey,
      });
      const auth = await login(password);
      const reply = await service.request<{
        response: string;
        account_id: string;
        challenge_id: string;
      }>("/v1/auth/login/start", "POST", {
        username: "legacy-change",
        request: auth.startLoginRequest,
        proof_key: keys.publicKey,
      });
      const proof = finishLogin(
        auth,
        password,
        reply.response,
        issuer!,
        reply.account_id,
      );
      const token = await service.request<{
        access_token: string;
        device_id: string;
      }>(
        "/v1/auth/login/finish",
        "POST",
        {
          challenge_id: reply.challenge_id,
          message: proof.finishLoginRequest,
          binding: await binding(
            proof.sessionKey,
            issuer!,
            reply.challenge_id,
            keys.thumbprint,
          ),
          device_name: "Legacy cached desktop",
        },
        keys,
      );
      const cached: Session = {
        issuer: issuer!,
        portal: issuer!,
        account: reply.account_id,
        username: "legacy-change",
        token: token.access_token,
        device: token.device_id,
        scope: "full",
        keys,
        backupKey: await derive(
          root.secrets.root,
          "vault:full",
          issuer!,
          reply.account_id,
        ),
        rootMaterial: await crypto.subtle.importKey(
          "raw",
          unb64(root.secrets.root),
          "HKDF",
          false,
          ["deriveKey", "deriveBits"],
        ),
      };
      await service.write(
        cached,
        { credential: "synthetic-community-secret" },
        0,
      );
      const nextPassword = "synthetic upgraded password " + random(),
        keyword = "synthetic upgraded private keyword " + random();
      const changed = await service.changePassword(
        cached,
        password,
        "",
        nextPassword,
        keyword,
      );
      expect(changed.session.derivation).toBe("secret-pair-v1");
      expect((await service.read(changed.session)).value).toEqual({
        credential: "synthetic-community-secret",
      });
      expect(changed.session.resyncRequired).toBe(true);
      await expect(service.read(cached)).rejects.toMatchObject({ status: 401 });
      await service.logout(changed.session);
    });
  },
);
