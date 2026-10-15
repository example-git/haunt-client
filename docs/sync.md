# Optional encrypted sync

Choose your group's independent Haunt Sync instance in the desktop sign-in screen
or Encrypted sync settings. Ordinary community accounts work without it. The sync
instance stores current encrypted snapshots, not an archival backup; losing it
leaves your local working settings and sign-ins available.

Create a sync account with a master password and **private sync keyword**. Keep
both secret. The exact same pair deterministically derives the same 256-bit root
on your devices using Argon2id v1.3, 64 MiB, three iterations and four lanes.
Neither value, its locally computed salt, nor the root is sent to the service.
Use a long private keyword or phrase; case and spaces matter. Save the separate
offline recovery key outside the device; email recovery cannot decrypt data alone.

A community web client receives only that server's key. Choose the sync instance,
start a browser pairing request, and copy it to **Approve browser access** in
unlocked desktop sync settings. Check the displayed server, instance and matching
fingerprint before approving. Copy the encrypted approval back to the browser.
Its private key stays there, and the approval cannot be used by another browser.
Neither global secret is entered into a hosted sign-in page. Requests expire in
five minutes; established sessions stay signed in until logout or revocation.

Changing either secret re-encrypts the current snapshots and replaces the recovery
key. Authentication, snapshots and recovery data change together only when every
revision matches. The client then forces full and per-server resync, including
unchanged snapshots. An unfinished resync remains flagged and shows a persistent
notice outside settings; use Retry sync or sign in again as directed. Local data
remains available. Keep a local backup until the resync completes. Other sync
devices must sign in or pair again after a change.

An older password-only account can be upgraded from its already unlocked desktop
using Change sync password or private keyword. Email recovery with the saved
recovery key also migrates its snapshots to the two-secret format. New ordinary
sign-ins require both secret values; they do not fall back to password-only unlock.
