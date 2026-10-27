# Desktop releases and updates

## Coordinated builds

The [hub release pipelines](https://github.com/example-git/haunt/blob/main/docs/releases.md)
own versions, source revisions, publication, and deployment. Component pushes run
regressions without modifying version manifests or deploying hosted web.

Development builds use `X.Y.Z-dev.N`, build only selected targets, and publish as
manual-download prereleases. Desktop development installs use the `haunt-dev`
profile and a separate application identity. Their updater remains disabled.
They do not replace stable feeds or container tags.

A stable hub release selects patch, minor, major, or an explicit version. It
stamps `package.json`, root/workspace lockfile entries, `electron-app/package.json`,
and `packages/core/package.json` in each build checkout. All four desktop targets
must pass their checks before the complete Ed25519 manifest is signed. Source
commits remain fixed throughout the run; the hub release records them alongside
the build version. Local stamping is available with:

```sh
npm run version:stamp -- 0.17.9
```

## Release setup

The public verification key is pinned in `static/updates.json`. Keep its private
counterpart offline and in the hub repository secret `HAUNT_UPDATE_PRIVATE_KEY`.
The hub validates that its private signing key matches the client trust key. To initialize a separate fork's key:

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

The hub release deploys the verified Nexus image and atomically imports desktop
artifacts into its configured update directory. Files are verified before the
current manifest pointer changes. The hub then checks public feeds and downloads.

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
launcher, packaging configuration, entitlements, native helpers or bundled Linux
library and plugin contents. A different
fingerprint downloads a full baseline installer instead. A dismissible popup
explains that the latest full app is required, shows platform-specific steps, and
provides download/open-installer controls. Dismissing it keeps the title-bar update
indicator available; the same notice does not repeat on every poll.

| Platform       | Baseline installation                                                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows        | Open NSIS installer, quit Haunt and upgrade the existing installation                                                                                                  |
| Linux AppImage | Verify and atomically replace the actual launch file, retaining `.haunt-previous`                                                                                      |
| Fedora RPM     | Verify and open the RPM in the system package installer; DNF manages the installed files                                                                               |
| macOS arm64    | Installations using the included local installer stage, sign, verify and replace the bundle with their persistent key, then relaunch; other installations open the DMG |

An extracted Linux directory build opens the downloaded AppImage instead of
modifying an unknown installation layout. A failed full-package installation is
not covered by the ASAR startup rollback; retain the previous installer or recovery
AppImage. The macOS local installer retains a previous bundle and restores it if
replacement fails. Native platform installation and signing require target-OS testing.

## Dependency toolchains

The application uses TypeScript 7.0.2. API generation uses
`json-schema-to-typescript` 16.0.0 under `scripts/api-generator`, with its own
lockfile and no TypeScript compiler dependency. The root postinstall step installs
the generator. `npm run generate:check` checks the generated client contracts.

The native media publisher uses Go 1.26 or newer; rebuild it with
`npm run build:native-media` after changing its Go dependencies. SwiftCaptureWorker
remains an independently supplied binary. The DM module uses OpenMLS 0.9.1 and
wasm-bindgen 0.2.129; rebuilding it requires the matching wasm-bindgen CLI and
Rust's wasm32 target. Ordinary client builds verify the committed helper/WASM
artifacts and do not require those compilers. Changing a bundled native helper
changes the update runtime identity and requires a full installer on that target.

Linux desktop staging compiles the capture, publisher, audio and shortcut helpers
on the target architecture. Alongside Go, a C compiler and `pkg-config`, Ubuntu
build hosts need:

```sh
sudo apt-get install libpulse-dev libglib2.0-dev libx11-dev libxrandr-dev libxcomposite-dev \
  libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev gstreamer1.0-tools \
  gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-bad \
  gstreamer1.0-plugins-ugly gstreamer1.0-pipewire
```

Staging bundles the required GStreamer, PipeWire and PulseAudio libraries and
plugins with their license notices in both the RPM and AppImage. Installation
supplies this app-local runtime even when system GStreamer is absent. Updates
replace the complete package whenever its native runtime contents change;
JS/UI-only updates reuse the installed runtime. NVIDIA drivers and optional V4L2/NVMM vendor
plugins come from the user's installed driver or SDK. Wayland capture requires a
running screen-sharing portal and PipeWire service; X11 audio supports PulseAudio.
