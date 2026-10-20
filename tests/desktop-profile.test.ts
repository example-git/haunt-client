import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const {
  LEGACY_PROFILE_NAME,
  PROFILE_STATE,
  migrateDirectory,
  migrateCredentials,
  initializeProfile,
} = createRequire(import.meta.url)("../apps/desktop/profile.cjs");
const directories: string[] = [];
afterEach(() => {
  delete (global as any)[Symbol.for("haunt.profile")];
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});
function fixture() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "haunt-profile-test-"));
  directories.push(parent);
  const legacy = path.join(parent, LEGACY_PROFILE_NAME);
  const current = path.join(parent, "haunt");
  fs.mkdirSync(legacy);
  return { parent, legacy, current };
}
const storage = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => "gnome_libsecret",
  encryptString: (value: string) => Buffer.from(`new:${value}`),
  decryptString: (value: Buffer) => {
    if (!value.toString().startsWith("new:")) throw Error("Wrong key");
    return value.toString().slice(4);
  },
};
describe("desktop profile migration", () => {
  it("moves the complete profile once and preserves nested browser/updater data", () => {
    const { legacy, current } = fixture();
    for (const name of [
      "Partitions/chatxo/IndexedDB/data",
      "client-updates/state.json",
      "known-servers.json",
    ]) {
      fs.mkdirSync(path.dirname(path.join(legacy, name)), { recursive: true });
      fs.writeFileSync(path.join(legacy, name), name);
    }
    expect(migrateDirectory(current, LEGACY_PROFILE_NAME)).toBe(true);
    expect(fs.existsSync(legacy)).toBe(false);
    expect(
      fs.readFileSync(
        path.join(current, "Partitions/chatxo/IndexedDB/data"),
        "utf8",
      ),
    ).toBe("Partitions/chatxo/IndexedDB/data");
    expect(
      fs.readFileSync(path.join(current, "client-updates/state.json"), "utf8"),
    ).toBe("client-updates/state.json");
    expect(migrateDirectory(current, LEGACY_PROFILE_NAME)).toBe(false);
  });
  it("accepts an empty destination but never overwrites two populated profiles", () => {
    const { legacy, current } = fixture();
    fs.writeFileSync(path.join(legacy, "account"), "old");
    fs.mkdirSync(current);
    fs.writeFileSync(path.join(current, "account"), "new");
    expect(() => migrateDirectory(current, LEGACY_PROFILE_NAME)).toThrow(
      "Two Haunt profiles",
    );
    expect(fs.readFileSync(path.join(legacy, "account"), "utf8")).toBe("old");
    expect(fs.readFileSync(path.join(current, "account"), "utf8")).toBe("new");
    fs.unlinkSync(path.join(current, "account"));
    expect(migrateDirectory(current, LEGACY_PROFILE_NAME)).toBe(true);
  });
  it("converts saved sessions, preserves exact contents, and never needs the old key again", async () => {
    const { legacy, current } = fixture();
    const plaintext = JSON.stringify([{ token: "unique-old-session" }]);
    fs.writeFileSync(path.join(legacy, "sessions.encrypted"), "old-ciphertext");
    migrateDirectory(current, LEGACY_PROFILE_NAME);
    const unlock = vi.fn(async () => plaintext);
    await migrateCredentials(current, storage, unlock, LEGACY_PROFILE_NAME);
    const contents = fs.readFileSync(path.join(current, "sessions.encrypted"));
    expect(storage.decryptString(contents)).toBe(plaintext);
    expect(unlock).toHaveBeenCalledExactlyOnceWith(
      Buffer.from("old-ciphertext"),
      LEGACY_PROFILE_NAME,
    );
    expect(
      JSON.parse(fs.readFileSync(path.join(current, PROFILE_STATE), "utf8")),
    ).toEqual({ version: 1, name: "Haunt" });
    await migrateCredentials(current, storage, unlock, LEGACY_PROFILE_NAME);
    expect(unlock).toHaveBeenCalledTimes(1);
  });
  it("retains ciphertext and pending state on a locked keyring, then resumes", async () => {
    const { legacy, current } = fixture();
    fs.writeFileSync(path.join(legacy, "sessions.encrypted"), "old-ciphertext");
    migrateDirectory(current, LEGACY_PROFILE_NAME);
    await expect(
      migrateCredentials(
        current,
        storage,
        async () => {
          throw Error("Locked");
        },
        LEGACY_PROFILE_NAME,
      ),
    ).rejects.toThrow("Locked");
    expect(
      fs.readFileSync(path.join(current, "sessions.encrypted"), "utf8"),
    ).toBe("old-ciphertext");
    expect(
      JSON.parse(fs.readFileSync(path.join(current, PROFILE_STATE), "utf8"))
        .legacyName,
    ).toBe(LEGACY_PROFILE_NAME);
    await migrateCredentials(
      current,
      storage,
      async () => "[]",
      LEGACY_PROFILE_NAME,
    );
    expect(
      storage.decryptString(
        fs.readFileSync(path.join(current, "sessions.encrypted")),
      ),
    ).toBe("[]");
  });
  it("never replaces sessions with insecure storage, malformed data, or failed encryption", async () => {
    const { legacy } = fixture();
    const filename = path.join(legacy, "sessions.encrypted");
    fs.writeFileSync(filename, "old-ciphertext");
    await expect(
      migrateCredentials(
        legacy,
        { ...storage, getSelectedStorageBackend: () => "basic_text" },
        async () => "[]",
        LEGACY_PROFILE_NAME,
        "linux",
      ),
    ).rejects.toThrow("Unlock");
    await expect(
      migrateCredentials(
        legacy,
        storage,
        async () => "{}",
        LEGACY_PROFILE_NAME,
      ),
    ).rejects.toThrow("invalid");
    await expect(
      migrateCredentials(
        legacy,
        {
          ...storage,
          encryptString: () => {
            throw Error("Locked");
          },
        },
        async () => "[]",
        LEGACY_PROFILE_NAME,
      ),
    ).rejects.toThrow("Locked");
    expect(fs.readFileSync(filename, "utf8")).toBe("old-ciphertext");
    expect(fs.existsSync(path.join(legacy, PROFILE_STATE))).toBe(false);
  });
  it("recovers after encrypted sessions were replaced but the completion marker was not", async () => {
    const { legacy, current } = fixture();
    fs.writeFileSync(
      path.join(legacy, "sessions.encrypted"),
      storage.encryptString("[]"),
    );
    migrateDirectory(current, LEGACY_PROFILE_NAME);
    const unlock = vi.fn();
    await migrateCredentials(current, storage, unlock, LEGACY_PROFILE_NAME);
    expect(unlock).not.toHaveBeenCalled();
    expect(
      JSON.parse(fs.readFileSync(path.join(current, PROFILE_STATE), "utf8"))
        .name,
    ).toBe("Haunt");
  });
  it("initializes the actual default path and application identity before returning", () => {
    const { parent, legacy, current } = fixture();
    const values: Record<string, string> = {
      appData: parent,
      userData: legacy,
    };
    const app = {
      isPackaged: true,
      setName: vi.fn(),
      commandLine: { hasSwitch: () => false },
      getPath: (name: string) => values[name],
      setPath: (name: string, value: string) => {
        values[name] = value;
      },
      requestSingleInstanceLock: vi.fn(() => true),
      releaseSingleInstanceLock: vi.fn(),
    };
    initializeProfile(app);
    expect(app.setName).toHaveBeenCalledWith("Haunt");
    expect(values.userData).toBe(current);
    expect(values.sessionData).toBe(current);
    expect(fs.existsSync(legacy)).toBe(false);
    expect(app.releaseSingleInstanceLock).toHaveBeenCalledOnce();
  });
  it("does not move a running client's data or ignore its lock", () => {
    const { parent, legacy } = fixture();
    const app = {
      isPackaged: true,
      setName() {},
      commandLine: { hasSwitch: () => false },
      getPath: () => parent,
      setPath() {},
      requestSingleInstanceLock: () => false,
    };
    expect(() => initializeProfile(app)).toThrow("Close the running Haunt");
    expect(fs.existsSync(legacy)).toBe(true);
  });
  it("keeps custom profile overrides in place while branding the app Haunt", () => {
    const { parent, legacy } = fixture();
    const custom = path.join(parent, "portable");
    const values: Record<string, string> = {
      appData: parent,
      userData: custom,
    };
    const app = {
      isPackaged: true,
      setName: vi.fn(),
      commandLine: { hasSwitch: () => true },
      getPath: (name: string) => values[name],
      setPath: (name: string, value: string) => {
        values[name] = value;
      },
    };
    initializeProfile(app);
    expect(values.userData).toBe(custom);
    expect(fs.existsSync(legacy)).toBe(true);
    expect(app.setName).toHaveBeenCalledWith("Haunt");
  });
});
