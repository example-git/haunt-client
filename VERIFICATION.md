# Verification guide

Run `npm test` for the client unit tests and `npm run build` for the generated API,
type checking, artifact integrity checks and production web build.

The desktop release workflow builds Windows x64, Linux x64/arm64 and macOS arm64.
Updater tests cover signed manifests, bounded downloads, file verification, activation,
failed-startup rollback and AppImage file replacement using isolated fixtures.
Those tests do not substitute for testing an installed app on each operating system.

`npm run test:integration` expects this checkout at the Haunt Server repository's
`client/` submodule path. Its Go harness checks the identity of the isolated test
PostgreSQL container before creating disposable databases. Browser tests own their
profiles and processes. Read the harness configuration before running it.

Hardware capture quality, platform permission prompts, keyring behavior and signing
require checks on the target operating system with real devices. Unit and headless
browser tests alone do not establish those behaviors.
