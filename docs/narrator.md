# Text to speech

Open **Client settings → Text to speech**, below voice plugins. This compact
section controls personal narration for the current server/account; provider
credentials and setup belong in the separate owner-only **Server settings →
Server extensions** page.

## Provider and fallback

Choose **Device TTS** for local system speech, or an enabled server extension such
as **TikTok TTS**. Browser and desktop clients use the same server relay. No
Cloudflare Worker, desktop cookie capture, extension API key or individual TikTok
login is required on the client.

**Use device TTS if this extension fails** is independent of provider selection.
Turn it off for extension-only playback: errors stay silent and report a failure,
never use a local voice, and never choose another server. Disabled/unconfigured
extensions do not alter the saved provider or fallback choice. Owners configure
and test the actual provider in Server extensions; owner tests never fall back.

Only voices exposed as local system voices are used for device speech. If none
are available, install a system voice supported by your browser or desktop
runtime. Device speech uses the OS default output; extension audio follows
Haunt's Devices output selection. Volume and speed apply only to the narrator.

## Announcements

Enable narration and choose joins/leaves, mute/deafen changes or screen sharing.
Only you hear the audio; it is not published into the call or sent as a message.
Expand advanced settings for cooldown and fallback voice, announcement text, or
voices/ignored users on this server. Templates support `{{USER}}`,
`{{DISPLAY_NAME}}` and `{{CHANNEL}}`; blank text suppresses an event.

Initial occupants and reconnects establish a silent baseline. Multiple devices
for one user count once. Room moves are observed as joins/leaves of your current
call, not monitoring of other rooms. Deafening, leaving or disabling narration
stops active and queued speech. Re-enabling does not replay old events.

Personal preferences and user overrides are saved per server/account and included
in normal preference backups/sync. Provider credentials never enter client
preferences. Playback is serialized and bounded; stale queued entries are dropped.
Server speech uses a bounded shared memory cache. Preview works without joining
a call or enabling automatic announcements.

## Validation

```sh
npm test -- tests/server-extensions.test.ts tests/narrator-events.test.ts tests/narrator-playback.test.ts
npm run typecheck
```

Transport tests mock the server/provider. Live TikTok credentials and audio
availability still require an owner-operated test before release.
