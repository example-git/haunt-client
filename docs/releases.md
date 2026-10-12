# Desktop releases and updates

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

Repositories and GitHub releases may remain private. Mirroring through an
authenticated Haunt service lets connected users receive builds without making
the repository or binaries public.

## Applying updates

The installed bootstrap downloads an ASAR to the local application-data directory,
verifies its hash and signature, and activates it on the next launch. The previous
working archive is retained. New code must acknowledge local interface startup;
a missing acknowledgement or failed verification causes rollback. This check
never waits for login, a server connection or an audio plugin.

The user can download an update in **User settings → Client updates**. A title-bar
indicator shows when an update is available or ready. Restart is explicit and is
refused during an active call or attachment upload. Sessions, caches, preferences
and encryption keys stay outside the update directory.

A fingerprint separates routine JS/UI changes from changes to Electron, the fixed
launcher, packaging configuration, entitlements or native helpers. A different
fingerprint downloads a full baseline installer instead:

| Platform | Baseline installation |
| --- | --- |
| Windows | Open NSIS installer, quit Haunt and upgrade the existing installation |
| Linux AppImage | Verify and atomically replace the actual launch file, retaining `.haunt-previous` |
| macOS arm64 | Open the new DMG; install/sign the replacement app as needed |

An extracted Linux directory build opens the downloaded AppImage instead of
modifying an unknown installation layout. A failed full-package installation is
not covered by the ASAR startup rollback; retain the previous installer or recovery
AppImage. Native platform installation and signing still need target-OS testing.
