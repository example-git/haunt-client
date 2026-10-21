# Text to speech

Open **Account settings → Text to speech**, below voice plugins. This compact
section controls personal narration for the current server/account; provider
credentials and setup belong in **Server settings → Server extensions**, available
to owners, Administrators, and members with Manage configuration.

Settings navigation is grouped and searchable. Installed extension pages use
their server-provided names. Groups collapse independently, and the
header's expand control gives you more room without losing the close button.
On narrow screens, use **Browse settings** to switch sections.

## Provider and fallback

Choose **Device TTS** for local system speech, or an enabled server extension such
as **TikTok TTS**. Browser and desktop clients use the same server relay;
provider credentials stay on the server.

**Use device TTS if this extension fails** is independent of provider selection.
Turn it off for extension-only playback: errors stay silent and report a failure,
never use a local voice, and never choose another server. Disabled/unconfigured
extensions do not alter the saved provider or fallback choice. Administrator
extension tests never use device fallback.

Only voices exposed as local system voices are used for device speech. If none
are available, install a system voice supported by your browser or desktop
runtime. Device speech uses the OS default output; extension audio follows
Haunt's Devices output selection. Volume and speed apply only to the narrator.

The extension voice picker displays the voice catalog delivered by the server,
with groups, readable names and IDs. The same list is available for
per-user overrides and administrator extension tests. Choose **Custom voice ID**
to use an unlisted voice; existing custom IDs remain editable. A user's
**Use default voice** option removes their override. Actual voice availability
depends on the upstream provider.

## Announcements

Enable narration and choose joins/leaves, mute/deafen changes or screen sharing.
These events announce **other participants in your current call**, using the
name and voice override of the person who acted. **Ignore myself** suppresses
only your own actions; it does not suppress anyone else's. Turn it off to also
hear your own state changes. **Ignore this user** suppresses that user's events.
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
HAUNT_CLIENT_CHECK=narrator npm run test:integration
```

The browser check signs in two independent clients on real isolated servers and
tests both WebRTC and WebSocket calls. It asserts the actor's name and voice in
speech requests, measures actual audio playback, and checks ignores and disabled
events. An installed executable test extension returns a generated MP3 tone;
no live credentials are needed. This checks dynamic menus, extension invocation
and playback rather than a real provider's voice availability. Use the administrator
**Test extension** control to check a configured provider.
