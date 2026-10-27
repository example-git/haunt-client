# Optional encrypted sync

Choose your group's independent Haunt Sync instance in the desktop or standalone
web sign-in screen, or in Encrypted sync settings. Ordinary community accounts work without it. The sync
instance stores encrypted settings, sign-ins and private message text archives.
Losing it leaves the copies already stored on your devices available.

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
Global secrets are entered only in a trusted full-account client, not a
community-hosted page. Requests expire in five minutes; established sessions stay
signed in until logout or revocation.

Downloaded readable message text is retained separately from live chat. Deleting
a message from chat does not remove an already downloaded archive copy. In
**Backup & restore**, browse saved text, delete individual archive entries, or
export and import `.jsonl.gz` files. Importing saved text does not recreate live
chat messages. Text exports contain message metadata and readable text after
decompression, excluding attachment files, session tokens and encryption keys.
Previously exported copies remain independent of later archive changes.

Sync encrypts compressed text chunks on the client and merges saved messages
across devices. Explicit archive deletions propagate to those synced copies and
prevent stale imports from restoring the entries. Each compressed chunk holds at
most 100 messages and syncs independently. A paged change cursor finds remote
updates; unchanged chunks reuse local compression and are not transferred.
Interrupted uploads resume from completed chunks. There is no 20 MiB aggregate
archive limit; the 20 MiB encryption limit applies to individual payloads.
Existing single-snapshot archives migrate after their chunks upload successfully.
A community web client synchronizes only its server's archive. Incremental
archives require an updated Haunt Sync service.

Changing either secret re-encrypts the current snapshots and replaces the recovery
key. Encrypted replacements upload individually into a temporary migration.
Authentication, snapshots and recovery data change together only when every
starting revision still matches. The client then forces full and per-server resync, including
unchanged settings snapshots; archives recheck every remote chunk and upload
only changed text. An unfinished resync remains flagged and shows a persistent
notice outside settings; use Retry sync or sign in again as directed. Local data
remains available. Keep a local backup until the resync completes. Other sync
devices must sign in or pair again after a change.

An older password-only account can be upgraded from its already unlocked desktop
using Change sync password or private keyword. Email recovery with the saved
recovery key also migrates its snapshots to the two-secret format. New ordinary
sign-ins require both secret values; they do not fall back to password-only unlock.
