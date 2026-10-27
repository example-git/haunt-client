![Haunt](../../assets/haunt-wordmark.png)

# @haunt/core

Installation-scoped Haunt HTTP, event and messaging SDK. Generated OpenAPI types cover the server API; networking, token storage and message storage are adapters. No UI or browser media implementation is imported by this package.

```ts
import { Client } from "@haunt/core";
const client = new Client(runtime, messageStore, tokenVault);
const community = await client.login("https://chat.example.com", {
  username,
  password,
  device_name: "Android",
});
await community.send(conversationId, "Hello");
const latest = await community.messages(conversationId, { limit: 100 });
const earlier = await community.messages(conversationId, {
  before: latest[0]?.seq,
  limit: 100,
});
```

`messages()` reads the local archive in ascending order, returning at most 200 messages by default (maximum 10,000 per call). Use `before` to page backward. `selectConversation(id)` opens the newest page first on servers advertising `messages.history_pages.v1`; a budgeted archive job downloads older history separately. `loadOlder()` reuses covered local ranges, and `loadNewer()` fetches forward pages. `refresh()` reconciles the directory, read state and selected history; `refresh(false)` skips history. Live events apply automatically to every authorized conversation through one account feed. Quiet servers do not poll HTTP. After an HTTP mutation, use `refreshAfterChange()` to wait past any earlier in-flight snapshot and then fetch the new directory. `saveArt(kind, blobOrNull)` handles raw avatar/icon/banner upload or removal and refreshes metadata; `art(kind, userID?)` returns an authorized image Blob.

`Runtime.archiveBudget` accepts a shared `ArchiveBudget` with automatic-download,
bytes-per-second and requests-per-minute policy. Without an explicit budget,
instances using the same runtime share the default 64 KiB/s, 30 requests/minute
budget. `archiveAvailable()` supplies platform visibility/data-saver policy.
`pauseArchive()`, `resumeArchive()` and `Snapshot.archives` expose per-conversation
controls and progress; `updateArchivePolicy()` reapplies changed preferences.
`MessageStore.search(scope, conversation, query, options)` searches downloaded text
with account isolation, all-word matching, cancellation and `before` pagination.
Implementations must update their index with message edits/deletions. Legacy
servers without paged-history capability retain the older foreground sync path.

`Snapshot.voiceRooms` maps channel IDs to current voice participants and their mute/deafen/camera/screen state. Call `setForeground(true)` only while this server’s roster is displayed and `setForeground(false)` when switching away. It defaults to off; no call admission or media adapter is needed. The server filters rooms by access and sends complete ephemeral replacements. An empty map does not imply that every member is offline.

Provide Fetch-compatible network primitives and WebSocket creation, UUID generation, `MessageStore`, and `TokenVault`. See the parent client's `README.md` and `ANDROID.md` for behavior, lifecycle, security boundaries and Android integration. `MemoryStore` and `MemoryVault` are useful for tests; production adapters must be durable. Session tokens must never be forwarded across server origins. This library does not implement background delivery or mobile media.

`mentions(text)` returns immutable username mentions with UTF-16 text offsets. `shouldNotify(policy, event)` applies portable trigger, foreground, server and channel rules without a UI or audio dependency, for reuse by future native clients. The browser notification adapter handles sounds, local preferences, inbox state and popups separately.

`Snapshot.readStates` contains server-persisted `read_seq`, `last_seq`, `unread_count` and `mention_count` by conversation ID. Use `unreadSummary()` for aggregate attention counts (mentions plus unread DMs) and ordinary unread dots. Call `markRead(id, highestDisplayedSeq)` only when the user has actually viewed those messages; writes are monotonic and coalesced. Do not mark receipt/history downloads as reads.

`onWire()` receives server events. `liveEventCursor` exposes the connection’s ready cursor: events at or below that cursor are replay and must not make old notification sounds. `events.checkpoint` is saved after preceding message writes; reconnects replay from durable storage. Permission changes remove inaccessible conversations. `sync.required` recovers the compact directory/read snapshot and visible history, without pulling all other histories. Generated protocol documentation describes account-feed frames and their sequencing.

Legacy servers without `events.account_feed` use explicit subscriptions and periodic history discovery. For those servers only, the SDK-local `message.discovered` event covers previously undownloaded, unedited messages created during an already-online session. That fallback assumes reasonably aligned clocks. Neither transport implements Android push/background delivery.
