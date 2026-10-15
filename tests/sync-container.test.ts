import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { SyncService } from "../packages/browser/src/sync/service";
import { proofKeys, random } from "../packages/browser/src/sync/crypto";
const issuer = process.env.HAUNT_SYNC_CONTAINER_ISSUER;
describe.skipIf(!issuer)("production sync container", () => {
  it("preserves OPAQUE identity, persistent sessions and encrypted data across restart", async () => {
    const control = JSON.parse(
      await readFile(process.env.HAUNT_SYNC_CONTAINER_CONTROL!, "utf8"),
    );
    if (
      !/^haunt-sync-check-[a-f0-9]{12}$/.test(control.name) ||
      control.issuer !== issuer
    )
      throw Error("Refusing to manage an unrelated container");
    const service = new SyncService(
        issuer!,
        "https://trusted-publisher.example.test",
      ),
      keys = await proofKeys(),
      username = "container-check",
      password = "synthetic container master " + random();
    await service.register(username, password, keys);
    const session = await service.signIn(username, password, keys);
    const backup = {
      settings: { theme: "frosted" },
      credential: "synthetic-community-secret",
    };
    await service.write(session, backup, 0);
    execFileSync(
      "docker",
      [
        "--host=unix:///var/run/docker.sock",
        "restart",
        "-t",
        "60",
        control.name,
      ],
      { stdio: "pipe" },
    );
    for (let i = 0; i < 80; i++) {
      try {
        const response = await fetch(issuer + "/healthz");
        if (response.ok) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect((await service.read(session)).value).toEqual(backup);
    const fresh = await service.signIn(username, password);
    expect((await service.read(fresh)).value).toEqual(backup);
    await service.logout(session);
    await service.logout(fresh);
  }, 90_000);
});
