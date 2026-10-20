const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

// Retained only to locate and unlock profiles created before the Haunt rename.
const LEGACY_PROFILE_NAME = "chat.xo.vg";
const LEGACY_DEVELOPMENT_PROFILE_NAME = "chatxo-client";
const PROFILE_STATE = "haunt-profile.json";
const HELPER_SWITCH = "haunt-migrate-profile-key";
const initialized = Symbol.for("haunt.profile");

function exists(filename) {
  try {
    fs.lstatSync(filename);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function writeState(directory, value) {
  const filename = path.join(directory, PROFILE_STATE);
  fs.writeFileSync(filename + ".tmp", JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(filename + ".tmp", filename);
}

function migrateDirectory(directory, legacyName) {
  const legacy = path.join(path.dirname(directory), legacyName);
  if (!exists(legacy)) return false;
  if (!fs.statSync(legacy).isDirectory())
    throw Error(`The previous Haunt profile is not a directory: ${legacy}`);
  if (exists(directory)) {
    if (fs.readdirSync(directory).length)
      throw Error(
        `Two Haunt profiles exist. Keep both directories and resolve the conflict before restarting: ${legacy} and ${directory}`,
      );
    fs.rmdirSync(directory);
  }
  // The pending marker moves with the whole profile, so an interrupted key
  // conversion can resume without losing IndexedDB, settings or saved sessions.
  writeState(legacy, { version: 1, legacyName });
  fs.renameSync(legacy, directory);
  return true;
}

function secureStorage(safeStorage, platform = process.platform) {
  return (
    safeStorage.isEncryptionAvailable() &&
    (platform !== "linux" ||
      !["basic_text", "unknown"].includes(
        safeStorage.getSelectedStorageBackend(),
      ))
  );
}

// A separate, windowless process uses the previous keychain identity once.
// Plaintext travels only over the private child-process IPC pipe, never a file,
// command-line argument, environment variable or application log.
function unlockPrevious(app, encrypted, legacyName) {
  return new Promise((resolve, reject) => {
    const helperProfile = fs.mkdtempSync(
      path.join(app.getPath("temp"), "haunt-key-migration-"),
    );
    const args = app.isPackaged ? [] : [app.getAppPath()];
    args.push(
      `--${HELPER_SWITCH}=${legacyName}`,
      `--user-data-dir=${helperProfile}`,
    );
    for (const name of ["no-sandbox", "password-store"])
      if (app.commandLine.hasSwitch(name)) {
        const value = app.commandLine.getSwitchValue(name);
        args.push(`--${name}${value ? `=${value}` : ""}`);
      }
    const child = spawn(process.execPath, args, {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: { ...process.env, HAUNT_DESKTOP_TEST: "0" },
    });
    let result, failure;
    child.on("message", (message) => {
      if (message?.ready)
        child.send({ encrypted: encrypted.toString("base64") });
      else if (typeof message?.plaintext === "string")
        result = message.plaintext;
      else
        failure = Error(
          "The previous desktop keyring could not unlock saved sessions.",
        );
    });
    child.once("error", (error) => {
      failure = error;
    });
    child.once("close", (code) => {
      try {
        fs.rmSync(helperProfile, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 100,
        });
      } catch (error) {
        failure ??= error;
      }
      if (code === 0 && result !== undefined && !failure) resolve(result);
      else
        reject(
          failure ||
            Error("The saved-session migration process did not complete."),
        );
    });
  });
}

function runKeyMigrationHelper(app, safeStorage) {
  if (!app.commandLine.hasSwitch(HELPER_SWITCH)) return false;
  const legacyName = app.commandLine.getSwitchValue(HELPER_SWITCH);
  if (
    !process.send ||
    ![LEGACY_PROFILE_NAME, LEGACY_DEVELOPMENT_PROFILE_NAME].includes(legacyName)
  ) {
    app.exit(1);
    return true;
  }
  app.setName(legacyName);
  app.dock?.hide();
  process.once("disconnect", () => app.exit(1));
  app.whenReady().then(() => {
    process.once("message", (message) => {
      try {
        if (
          typeof message?.encrypted !== "string" ||
          message.encrypted.length > 2_000_000
        )
          throw Error("Invalid migration input");
        const plaintext = safeStorage.decryptString(
          Buffer.from(message.encrypted, "base64"),
        );
        process.send({ plaintext }, () => app.exit(0));
      } catch {
        process.send({ failed: true }, () => app.exit(1));
      }
    });
    process.send({ ready: true });
  });
  return true;
}

async function migrateCredentials(
  directory,
  safeStorage,
  unlock,
  legacyName,
  platform = process.platform,
) {
  const stateFile = path.join(directory, PROFILE_STATE);
  let state;
  if (exists(stateFile)) {
    state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    if (
      state.version !== 1 ||
      (state.name !== "Haunt" && state.legacyName !== legacyName)
    )
      throw Error("Unrecognized Haunt profile migration state.");
    if (state.name === "Haunt") return;
  }
  const filename = path.join(directory, "sessions.encrypted");
  if (exists(filename)) {
    if (!secureStorage(safeStorage, platform))
      throw Error(
        "Unlock your desktop keyring to migrate saved Haunt sessions. Your existing data has been retained.",
      );
    const encrypted = fs.readFileSync(filename);
    let plaintext;
    try {
      plaintext = safeStorage.decryptString(encrypted);
    } catch {
      plaintext = await unlock(encrypted, legacyName);
    }
    // Validate before replacing the only active credentials file. The original
    // encrypted file remains untouched on a failed unlock or encryption attempt.
    if (!Array.isArray(JSON.parse(plaintext)))
      throw Error(
        "Saved Haunt sessions are invalid. The existing file has been retained.",
      );
    const migrated = safeStorage.encryptString(plaintext);
    if (safeStorage.decryptString(migrated) !== plaintext)
      throw Error("Could not verify the migrated Haunt sessions.");
    fs.writeFileSync(filename + ".tmp", migrated, { mode: 0o600 });
    fs.renameSync(filename + ".tmp", filename);
  }
  writeState(directory, { version: 1, name: "Haunt" });
}

function initializeProfile(app) {
  if (global[initialized]) return global[initialized];
  app.setName("Haunt");
  const profileName = app.isPackaged ? "haunt" : "haunt-development";
  const legacyName = app.isPackaged
    ? LEGACY_PROFILE_NAME
    : LEGACY_DEVELOPMENT_PROFILE_NAME;
  const override = app.commandLine.hasSwitch("user-data-dir");
  const testProfile =
    !app.isPackaged && process.env.HAUNT_DESKTOP_TEST === "1"
      ? process.env.HAUNT_DESKTOP_TEST_PROFILE
      : undefined;
  const directory = path.resolve(
    testProfile ||
      (override
        ? app.getPath("userData")
        : path.join(app.getPath("appData"), profileName)),
  );
  if (!testProfile && (!override || path.basename(directory) === profileName)) {
    const legacy = path.join(path.dirname(directory), legacyName);
    if (exists(legacy)) {
      // Refuse to move a profile still owned by a running previous client.
      app.setPath("userData", legacy);
      if (!app.requestSingleInstanceLock())
        throw Error(
          "Close the running Haunt client, then reopen it to migrate its data.",
        );
      app.releaseSingleInstanceLock();
      migrateDirectory(directory, legacyName);
    }
  }
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  app.setPath("userData", directory);
  app.setPath("sessionData", directory);
  let migration;
  const profile = {
    migrateCredentials(safeStorage) {
      migration ??= migrateCredentials(
        directory,
        safeStorage,
        (encrypted, name) => unlockPrevious(app, encrypted, name),
        legacyName,
      );
      return migration;
    },
  };
  global[initialized] = profile;
  return profile;
}

module.exports = {
  LEGACY_PROFILE_NAME,
  LEGACY_DEVELOPMENT_PROFILE_NAME,
  PROFILE_STATE,
  migrateDirectory,
  migrateCredentials,
  initializeProfile,
  runKeyMigrationHelper,
};
