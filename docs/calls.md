# Calls and video quality

Devices settings and the controls beside Camera and Share screen select separate
outgoing resolutions and frame rates. Selections stay on this device, and active
captures show their actual settings. Changing an active capture keeps its source
and independent source audio.

Linux desktop screen sharing offers an audio-output selector in the capture
picker. Enable system audio and select the output carrying the sound. Haunt
captures that output's monitor through PulseAudio or PipeWire's PulseAudio
service; it does not substitute a microphone. The selected output includes all
applications playing to it, even when sharing one window. Stopping the share
also stops its audio capture. Browser screen audio remains browser-dependent.

Desktop Devices settings enable global microphone/deafen shortcuts and push to
talk. Linux uses held F9 on X11 or the desktop's GlobalShortcuts portal on
Wayland; the portal may offer a different binding. An unavailable binding shows
an error. Other platforms provide F9 while Haunt is focused. Push to talk gates
only the microphone and preserves manual mute, moderator restrictions and
independent share audio. The tray shows call/share state and offers mute,
deafen, stop-sharing and leave actions.

Camera choices follow the selected device. Browser clients verify exact
resolution/FPS combinations before offering them; native macOS capture uses the
device's format catalog. Available FPS choices change with resolution, including
120/240 FPS when supported. The initial choice prefers 1080p/60, otherwise a
supported mode at or below that target. An unavailable saved selection displays
an error. Screen sharing defaults to 1080p/60, offers bounds from 360p through
2160p, and preserves aspect ratio without upscaling.

WebRTC viewers choose Auto or a fixed available quality on each remote video tile,
including PiP and call windows. Auto reacts to received packet loss and decode
drops, then probes higher quality after sustained recovery. A fixed choice stays
fixed through transient call reconnects until Auto is selected again. These
choices affect only that viewer;
outgoing capture settings and other viewers remain independent. Legacy sources
and WebSocket calls display Single quality. Both transports preserve outgoing
capture settings.

Moderators with Mute members or Deafen members can restrict lower-ranked voice
participants. The channel's Voice restrictions list can clear restrictions while
members are absent. Restrictions survive leaving and server restarts. The
member's own mute/deafen choices remain separate and return when a restriction
is removed. Camera and screen audio remain independent of microphone mute.

Microphone tile meters use the sender's post-filter, post-gain level on servers
advertising `media.levels.v1`. Receiver volume and deafen do not change the reading.
Muted microphones stop reporting and display zero; deafen also mutes the sender's
microphone. Missing reports become unavailable after two seconds. Participants
that have never sent a level report use received microphone audio before playback
volume instead. This fallback is unavailable while deafened or without an audio
feed. The meter tooltip distinguishes received levels from sender reports. Camera
and screen-share meters still measure received playback. A sender report indicates
microphone activity, not confirmation of audio delivery.

After relaunch, a reconnect banner offers the last successfully joined voice
channel only after an authenticated check confirms current View and Connect
access. Offline checks retry without showing an unverified offer. Reconnecting
restores the member's own mute/deafen choices under current moderator restrictions;
camera and screen sharing stay off. Deliberate leave, dismissal, logout, account
removal, deleted channels and revoked access clear the remembered channel.

Embedded and attached videos offer local playback speed and picture in picture.
The speed is saved on the device. Single-file videos can be saved; HLS posts
remain streamed. Image previews support native clipboard copying and downloads.
