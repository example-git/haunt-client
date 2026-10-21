# Haunt Client

This repository contains Haunt's browser client, Electron desktop application,
and reusable TypeScript messaging library. The client connects to independently
hosted Haunt servers; each account belongs to one server and is identified as
`username@server-address`.

The client implements text and direct messaging, calls, notifications, profiles,
moderation interfaces, encrypted client data, and multi-server navigation. It is
under active development and does not implement every Discord feature.

## Features

- Multiple independently authenticated servers with background events and unread indicators.
- Text channels, server-scoped DMs, profiles, presence, mentions and configurable notifications.
- Rich messages, Markdown, server emojis, image attachments and local media/message caching.
- Client-side encrypted DMs and images, conversation exports, and encrypted client backups.
- Voice rooms, camera/capture-card video and screen sharing with automatic transport selection.
- Per-user/source volume settings, device selection, microphone monitoring and local audio controls.
- Optional server audio plugins with cached packages and schema-driven settings.
- Optional [text to speech](docs/narrator.md) with server-hosted speech extensions and independently optional device TTS fallback.
- Compact, rounded settings with icon navigation, search, collapsible groups and expandable desktop/mobile layouts.
- Call tiles, speaking indicators, persistent controls and a movable picture-in-picture view.
- Native desktop windows, call popouts, screen-source selection and native Apple Silicon capture.
- Archive-based desktop updates, with signature verification and failed-startup rollback.

Server accounts, moderation and storage limits are governed by the server you join.
This client does not federate accounts or messages between independent services.

## Platforms

| Target | Distribution |
| --- | --- |
| Browser | Static web build, separately hosted or embedded in Haunt Server |
| Windows x64 | Electron / NSIS installer |
| Linux x64 and arm64 | Electron / AppImage or Fedora RPM |
| macOS arm64 | Electron / DMG, native capture helpers |

The shared TypeScript core keeps future mobile messaging in mind. An Android client
is not yet shipped; see [Android planning](ANDROID.md). macOS builds target Apple
Silicon only. The current macOS distribution workflow leaves application signing to
the person installing or distributing their baseline copy.

### macOS installation

The DMG includes **Install Haunt.command** and **Installation.txt**. Run the command
with `bash` in Terminal and review its consent prompt. It creates a persistent
code-signing identity in your user keychain and installs Haunt in `~/Applications`
(or updates an existing `/Applications/Haunt.app`). Later **Update app** actions
reuse that identity, stage and verify the replacement, then relaunch Haunt.
The public download remains unsigned and is not notarized by Apple.

### Fedora installation

Download the `.rpm` from the [desktop releases](https://github.com/example-git/haunt-client/releases/latest).
Choose `linux-x64` for Intel/AMD systems or `linux-arm64` for ARM systems, then install
the downloaded file with `sudo dnf install ./Haunt-VERSION-linux-x64.rpm`, substituting
its filename. Open **Haunt** from the applications menu or run `haunt` in a terminal.
The package installs in `/opt/Haunt`; your profile stays in `~/.config/haunt`
(or `$XDG_CONFIG_HOME/haunt`). Removing the package leaves that profile intact.

## Local development

Requires Node.js 22.12+ and npm.

```sh
git clone https://github.com/example-git/haunt-client.git
cd haunt-client
npm ci
npm run dev
```

Open the local development URL and sign in as `username@serveraddress`, with an
optional port after the address. HTTPS is selected by default; turn it off for a
localhost or private-network HTTP server. Saved sign-ins restore that choice.
Paste an invitation link to create an account using a username and password.
A server must allow the browser client's origin. LAN HTTP is supported for messaging,
but browser capture requires HTTPS or localhost. The Electron client handles supported
LAN connections through its native networking layer.

```sh
npm test
npm run build
```

The production web build is written to `dist/`. The generated API snapshots are
included, so ordinary client builds do not require a server checkout or database.
`npm ci` also installs the separately locked API generator under
`scripts/api-generator`; its compiler dependency is independent of the client
typechecker.

## Desktop builds and updates

```sh
npm run electron:win
npm run electron:linux
npm run electron:mac
```

Build on the appropriate supported host. macOS targets arm64 only. Packaging uses
the slim `electron-app/` stage; application resources live under `static/`.
The native media worker is a standalone Go module under `native/media-worker/`.
Normal packaging verifies the supplied native helpers rather than rebuilding them.

Routine updates download a verified ASAR into the client's application-data directory.
The installed launcher validates its release signature and file hash before loading
it, preserves the previous working version, and rolls back an update that fails to
acknowledge startup. Updates do not overwrite saved sessions, DM keys or preferences.
The app never restarts automatically during a call or upload.

Changes to Electron, the launcher or native workers require a new baseline package.
Windows uses its installer to update the existing installation; AppImage updates
replace the launch file and retain a recovery copy. macOS installations made with
the included local installer reuse their signing identity for new DMGs; other
installations open the DMG for manual installation. Fedora installations download an RPM
and open the system package installer. See [release setup](docs/releases.md).

Pushes to `main` automatically update the client version: explicit version intent
takes priority, otherwise source-diff size selects patch, minor or major. See the
[version policy and release workflow](docs/releases.md#automatic-client-versions).

GitHub Actions builds Windows x64, Linux x64/arm64 and macOS arm64 releases from
`client-vX.Y.Z` tags. The release version must match `package.json`. Repository
tokens are never embedded in clients. Operators that choose a private downstream
build need an accessible download mirror; Haunt Server can serve those downloads
to authenticated members, with optional platform installer links in the web client.

## Repository layout

To build a compatible microphone processor, see [Audio plugin authoring](docs/audio-plugin-authoring.md)
for the working example, Wasm ABI, settings schema, sandbox and validation steps.

- `apps/web/`: shared React interface.
- `apps/desktop/`: Electron launcher, native integrations and networking.
- `packages/core/`: service API, sessions, events and messaging abstractions.
- `packages/browser/`: browser storage, media, encryption and notifications.
- `static/`: build inputs, native helpers and generated service contracts.
- `tests/`: unit tests and redistributable fixtures.

[Haunt Server](https://github.com/example-git/haunt-server) includes this repository
at `client/` as a pinned Git submodule. The server's Go integration fixtures live in
its own repository; `npm run test:integration` expects that parent layout and an
explicitly isolated test database.

Run `python3 scripts/check-repository.py` before committing local setup changes.
Repository hygiene CI checks ignore boundaries and scans Git history for credentials.
Keep private plugins, model downloads, saved sessions and signing keys outside the
tracked source. `static/`, emoji artwork, lockfiles and redistributable fixtures are
intentional build inputs; generated bundles belong in the ignored output directories.

## Privacy and recovery

DM content and images support end-to-end encryption between participating clients.
Server channels and relayed media have different trust boundaries; do not assume the
server operator is unable to access them. Servers still handle account and connection
metadata. The implementation has not received an independent security audit.

Client backups contain sensitive saved sessions and encryption recovery material.
Keep the backup and its password secure. Local caches improve resilience but are not
a substitute for a deliberate backup.

Haunt is independent of Discord. No proprietary noise-suppression implementation or
model is bundled; server operators may provide compatible audio plugins separately.

Theme presets, editable main colors and desktop sidebar effects are described in
[Appearance](docs/appearance.md). The [Haunt project hub](https://github.com/example-git/haunt)
provides coordinated component pins, releases and demo screenshots.

Optional group-hosted synchronization, private client secrets and browser pairing are explained in [the sync guide](docs/sync.md).

## License and participation

Haunt-owned code in this repository is available under the
[BSD 3-Clause License](LICENSE). Bundled third-party assets retain their own
notices. See [CONTRIBUTING.md](CONTRIBUTING.md) before submitting changes and
[SECURITY.md](SECURITY.md) for private vulnerability reports.
