# Android messaging integration

Android is the planned mobile target. The SDK and responsive UI are implemented; an Android application project, signing, emulator/device verification, background service and push delivery are not implemented. Mobile voice remains separate work. There is no iOS target.

## Reusable SDK

`packages/core` builds the `@haunt/core` ES module and declarations. It depends only on `openapi-fetch` and standard JavaScript network primitives. No browser media module is imported from core.

A Capacitor Android application can reuse the React UI and IndexedDB adapter in a current Android System WebView. A React Native or native-hosted JavaScript application can reuse core with its own adapters; provide compatible Fetch/Request/Response/URL/Blob, abort signals, UUIDs and WebSocket implementations. Core currently uses `AbortSignal.timeout` and `AbortSignal.any`; runtimes without those APIs need a standards-compatible polyfill. Do not import the browser media package in an Android messaging-only build.

```ts
import {
  Client,
  type MessageStore,
  type TokenVault,
  type Runtime,
} from "@haunt/core";

const runtime: Runtime = {
  fetch: platformFetch,
  socket: (url) => platformWebSocket(url),
  randomUUID: () => platformUUID(),
};
const client = new Client(runtime, sqliteMessageStore, androidKeystoreVault);
await client.restore();
const community = await client.login("https://chat.example.com", {
  username: "alice",
  password: suppliedPassword,
  device_name: "Android",
});
const unsubscribe = community.subscribe(() => render(community.getSnapshot()));
await community.send(conversationId, "Hello from Android");
```

Implement `MessageStore` transactionally, with `(scope, message_id)` as the primary key and `(scope, conversation_id, seq)` as the history index. `scope` includes both stable installation ID and account ID. Preserve tombstones and edit timestamps as in `shouldMerge`; never delete messages because the server's retention boundary advances. Store outbox bodies and their original `request_id` before trying a network send. Store cursor changes only after the matching message transaction commits. Do not share one account's cursor or history with another.

Implement `TokenVault` with Android Keystore-backed secret storage. Store session tokens, never passwords. Stop and recreate connections around platform lifecycle/network transitions; `Client.stop()` is final for its current instances, and a new `Client` can restore the vault. A visible foreground app can keep one account event socket per connected installation, with no history polling on capable servers. `Snapshot.readStates` restores unread/mention counters on connect. Use `markRead(conversationId, highestDisplayedSeq)` only for messages actually viewed. Leave `setForeground(false)` for messaging-only/background-server connections; enable it only when displaying that server’s voice roster. Do not imply a WebSocket will keep running while Android suspends the application. The portable `mentions` parser and `shouldNotify` policy can be reused on Android; browser/desktop sounds and notification UI remain in their own adapters. Android background delivery, push registration and OS notification channels need a separate Android design.

Keep server origins explicit and installation-scoped. A Capacitor wrapper must use a stable HTTPS application origin accepted in each host's `HAUNT_CLIENT_ORIGINS`. Do not bypass CORS or TLS checks. Consult the current [Capacitor Android documentation](https://capacitorjs.com/docs/android) when creating the wrapper and choosing SDK requirements.

Media stays behind the `MediaTransport` interface in `packages/browser`. A future Android call adapter can consume the same admission/signaling contract without adding transport settings to the UI. Do not enable browser voice controls in an Android build until capture, audio routing, interruption handling and background policy have device tests.
