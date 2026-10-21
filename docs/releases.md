# Desktop releases and updates

## Automatic client versions

Every push to `main` runs **Client version**. It adds one version commit after
the pushed changes, synchronizing `package.json`, the root/workspace entries in
`package-lock.json`, `electron-app/package.json` and `packages/core/package.json`.
The bot uses GitHub's `GITHUB_TOKEN`, whose pushes [do not trigger another push
workflow](https://docs.github.com/en/actions/concepts/security/github_token).
Retrying a completed run does not bump again. Overlapping runs retry ordinary
fast-forward pushes; they never force-push over someone else's work.

Choose the bump in any pushed commit with a trailer:

```text
Version-Bump: minor
```

`patch`, `minor` and `major` are supported. The largest explicit trailer wins
across the push. Without a trailer, conventional commit messages also specify
intent: `fix:`/`perf:` choose patch, `feat:` chooses minor, and `!` or a
`BREAKING CHANGE:` footer chooses major. The highest specified level wins.

When nothing specifies a level, the net diff for the entire push determines it:

| Bump | Changed source size (added + removed lines) |
| --- | --- |
| Patch | Below 250 lines **and** 8 files |
| Minor | At least 250 lines **or** 8 files |
| Major | At least 2,000 lines **or** 40 files |

These are size estimates, not compatibility analysis; explicit choices take
precedence. Thresholds and exclusions live in `version-policy.json`. Generated
API code, tests, lockfiles, documentation, vendored code, static assets and binary
files do not inflate the estimate. A documentation-only push still gets a patch.
Pure renames contribute no changed lines. An explicitly increased `package.json`
version is honored and synchronized instead of being bumped a second time.

Preview a range without modifying files:

```sh
npm run version:preview -- HEAD~1 HEAD
```

After pushing, wait for **Client version** to finish and run `git pull --ff-only`
before making another local commit, tagging a release, or updating the server's
client submodule reference. In a server checkout, pull inside `client/`, then
commit that updated submodule reference in the server repository. If a job fails,
rerun it; the manual workflow also accepts the original push's full before/after
SHAs for recovery. Automatic versioning does not publish installers: release
tags and manual release builds retain their existing behavior.

## Release setup

GitHub builds Windows x64, Linux x64/arm64 and macOS arm64 from `client-vX.Y.Z`
tags. The tag must match `package.json`. A release is published only after all
four platform jobs succeed. Installer and ASAR hashes are signed together in
`haunt-updates.json` using Ed25519.

The public verification key is pinned in `static/updates.json`. Keep its private
counterpart offline and in the repository secret `HAUNT_UPDATE_PRIVATE_KEY`.
`HAUNT_UPDATE_PUBLIC_KEY` is an optional repository variable overriding the build
key. The manifest job rejects mismatched keys. To initialize a separate fork's key:

```sh
node scripts/release-client.mjs keygen /protected/location/release-keys
```

Changing the pinned key requires a new baseline installation. Keep an independent
backup of the release private key; losing it prevents updating existing clients.
Application signing/notarization and update-manifest signing are separate operations.
The macOS baseline is not signed or notarized by this workflow.

## Update distribution

Connected servers advertise their update source in instance discovery:

- `HAUNT_CLIENT_UPDATE_MANIFEST_URL=https://downloads.example.test/haunt-updates.json`
  selects an external HTTPS manifest. Its artifacts live beside it under
  `client-vX.Y.Z/`. Account credentials are never sent to that external host.
- Without that URL, `HAUNT_CLIENT_UPDATE_LOCAL=true` enables authenticated downloads
  from the server's `client-updates/` data directory. Clients report their installed
  version and platform when checking. They verify the signed manifest and download
  only their own platform's archive or installer.
- `HAUNT_CLIENT_UPDATE_INSTALLERS=true` also lets the web client offer the locally
  available installer for the detected platform. Both flags are required. The web
  client verifies the manifest and downloaded installer before saving the file.
- With neither source enabled, the service does not offer updates.

The external URL takes precedence over local distribution. Local downloads require
an active account session and use the same service API; no public download directory
or GitHub token in the app is needed. Desktop update sources require HTTPS.
Multiple servers may offer updates; authentic versions are compared locally and
an unavailable server does not override a valid offer from another server.

The optional GitHub mirror step uses `HAUNT_UPDATE_HOST` and
`HAUNT_UPDATE_KNOWN_HOSTS` repository variables, and `HAUNT_UPDATE_SSH_KEY` as a
secret. Install that key on the destination with a restricted forced command
running the server's `scripts/install-client-release.py`. That script reads the
release archive on stdin, verifies a separately installed public key and all file
hashes, then publishes the manifest after its files. It grants no general remote
shell and needs write access only to the update directory.

Official repositories and GitHub releases are public. A downstream operator may
still mirror a private custom build through an authenticated Haunt service so
connected users can receive it without publishing those downstream binaries.

## Applying updates

The installed bootstrap downloads an ASAR to the local application-data directory,
verifies its hash and signature, and activates it on the next launch. The previous
working archive is retained. New code must acknowledge local interface startup;
a missing acknowledgement or failed verification causes rollback. This check
never waits for login, a server connection or an audio plugin.

The user can download an update in **User settings → Client updates**. A title-bar
indicator shows when an update is available or ready. Authenticated server mirrors
and external feeds are checked after connection and every 15 minutes. Returning
to the window or waking the machine also checks, with a five-minute cooldown to
avoid repeated requests. Downloads and restarts remain explicit.

If a call, unfinished upload, or unsent message is present, restarting asks for
confirmation and explains what will be interrupted. Cancel keeps everything
running. Opening settings alone never blocks installation. Sessions, caches,
preferences and encryption keys stay outside the update directory.

A fingerprint separates routine JS/UI changes from changes to Electron, the fixed
launcher, packaging configuration, entitlements or native helpers. A different
fingerprint downloads a full baseline installer instead. A dismissible popup
explains that the latest full app is required, shows platform-specific steps, and
provides download/open-installer controls. Dismissing it keeps the title-bar update
indicator available; the same notice does not repeat on every poll.

| Platform | Baseline installation |
| --- | --- |
| Windows | Open NSIS installer, quit Haunt and upgrade the existing installation |
| Linux AppImage | Verify and atomically replace the actual launch file, retaining `.haunt-previous` |
| Fedora RPM | Verify and open the RPM in the system package installer; DNF manages the installed files |
| macOS arm64 | Installations using the included local installer stage, sign, verify and replace the bundle with their persistent key, then relaunch; other installations open the DMG |

An extracted Linux directory build opens the downloaded AppImage instead of
modifying an unknown installation layout. A failed full-package installation is
not covered by the ASAR startup rollback; retain the previous installer or recovery
AppImage. The macOS local installer retains a previous bundle and restores it if
replacement fails. Native platform installation and signing require target-OS testing.

## Desktop status icons

The macOS menu bar uses a monochrome template owl and an unread count (or a dot
for uncounted unread messages); the Dock uses its native badge. Windows uses a
tray icon and taskbar overlay. Linux uses a tray icon and a launcher count where
the desktop supports it. The tray menu opens/hides Haunt and offers **Quit Haunt**.
Closing the main window keeps the renderer and active calls running in the tray;
Quit exits, including during an updater restart. If no tray can be created,
closing the main window exits normally so there is no inaccessible hidden app.
Native tray support depends on the desktop environment.

## Dependency toolchains

The application typechecker uses TypeScript 7. The current OpenAPI generator uses
its supported TypeScript 5 compiler API in `scripts/api-generator` with its own lockfile, installed by the root
postinstall step. Its compiler dependency does not constrain
the application's compiler. Keep `npm ls`, `npm ls --prefix scripts/api-generator`, and `npm run generate:check` passing
when updating either toolchain. Node type definitions follow the Node 22 build
runtime; newer Node-only APIs must not leak into these scripts.

The native media publisher uses Go 1.26 or newer; rebuild it with
`npm run build:native-media` after changing its Go dependencies. SwiftCaptureWorker
remains an independently supplied binary. The DM module uses OpenMLS 0.9.1 and
wasm-bindgen 0.2.129; rebuilding it requires the matching wasm-bindgen CLI and
Rust's wasm32 target. Ordinary client builds verify the committed helper/WASM
artifacts and do not require those compilers. Changing a bundled native helper
changes the update runtime identity and requires a full installer on that target.
