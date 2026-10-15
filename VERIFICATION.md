# Verification guide

Run `npm test` for the client unit tests and `npm run build` for the generated API,
type checking, artifact integrity checks and production web build.

`npm run test:version` checks size-based version selection, explicit overrides,
manifest/lockfile synchronization and concurrent Git pushes using disposable local
repositories. It does not push to GitHub or build Electron.

The desktop release workflow builds Windows x64, Linux x64/arm64 and macOS arm64.
Updater tests cover signed manifests, bounded downloads, file verification, activation,
failed-startup rollback and AppImage file replacement using isolated fixtures.
Those tests do not substitute for testing an installed app on each operating system.

`npm run test:integration` expects this checkout at the Haunt Server repository's
`client/` submodule path. Its Go harness checks the identity of the isolated test
PostgreSQL container before creating disposable databases. Browser tests own their
profiles and processes. Read the harness configuration before running it.

`HAUNT_CLIENT_CHECK=signin-browser npm run test:integration` runs only headless
browser sign-in checks against isolated HTTPS and local HTTP server fixtures. It
covers account-address validation, the profile footer, invite signup, logout,
saved sign-ins and reload. It does not launch Electron.

`HAUNT_CLIENT_CHECK=source-audio npm run test:integration` checks simultaneous
microphone, camera audio and screen-share audio through WebRTC and the WebSocket
relay. It checks playing media elements, distinct test tones, independent source
meters and volumes, mute/deafen, PiP/pop-out views, capture restarts and autoplay
recovery. It also checks chat visibility, hidden-message badges, draft retention
and expansion of the video stage when chat is hidden in either window.

`HAUNT_CLIENT_CHECK=native-media HAUNT_NATIVE_AUDIO_ONLY=1 npm run test:integration`
checks the native FD/IPC publishing path with small video fixtures and stereo
44.1/48 kHz audio. It builds the Go media helper for the test host and substitutes
a fixture for the macOS capture executable and Electron shell APIs; it does not
build or launch Electron. This mode checks audio routing, not video throughput.

Hardware capture quality, platform permission prompts, keyring behavior and signing
require checks on the target operating system with real devices. Unit and headless
browser tests alone do not establish those behaviors.
