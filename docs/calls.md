# Calls and video quality

Devices settings and the controls beside Camera and Share screen select separate
outgoing resolutions and frame rates. Selections stay on this device, and active
captures show their actual settings. Changing an active capture keeps its source
and independent source audio.

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

After relaunch, a reconnect banner offers the last successfully joined voice
channel only after an authenticated check confirms current View and Connect
access. Offline checks retry without showing an unverified offer. Reconnecting
restores the member's own mute/deafen choices under current moderator restrictions;
camera and screen sharing stay off. Deliberate leave, dismissal, logout, account
removal, deleted channels and revoked access clear the remembered channel.
