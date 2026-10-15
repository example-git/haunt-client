import { expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  installerTarget,
  verifyInstaller,
} from "../apps/web/src/DesktopDownload";
it("detects supported browser platforms without offering desktop binaries to phones", () => {
  expect(installerTarget("Mozilla Mac OS X")).toBe("darwin-arm64");
  expect(installerTarget("Windows NT 10.0 Win64")).toBe("win32-x64");
  expect(installerTarget("Linux x86_64")).toBe("linux-x64");
  expect(installerTarget("Linux aarch64")).toBe("linux-arm64");
  expect(installerTarget("iPhone Mac OS X")).toBeNull();
  expect(installerTarget("Linux Android")).toBeNull();
});
it("verifies a browser installer manifest and rejects tampering and wrong file types", async () => {
  const keys = generateKeyPairSync("ed25519");
  const key = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const data: any = {
    schema: 1,
    version: "0.1.0",
    repository: "example-git/haunt-client",
    targets: {
      "win32-x64": {
        installer: { file: "Haunt.exe", sha256: "a".repeat(64), size: 10 },
      },
    },
  };
  const envelope = () => {
    const bytes = Buffer.from(JSON.stringify(data));
    return {
      schema: 1,
      payload: bytes.toString("base64"),
      signature: sign(null, bytes, keys.privateKey).toString("base64"),
    };
  };
  expect((await verifyInstaller(envelope(), "win32-x64", key)).file).toBe(
    "Haunt.exe",
  );
  await expect(
    verifyInstaller(
      { ...envelope(), signature: Buffer.alloc(64).toString("base64") },
      "win32-x64",
      key,
    ),
  ).rejects.toThrow(/signature/);
  data.targets["win32-x64"].installer.file = "evil.cmd";
  await expect(verifyInstaller(envelope(), "win32-x64", key)).rejects.toThrow(
    /metadata/,
  );
  data.targets["win32-x64"].installer.file = "../Haunt.exe";
  await expect(verifyInstaller(envelope(), "win32-x64", key)).rejects.toThrow(
    /metadata/,
  );
});
