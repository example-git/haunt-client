# Notifications

## Server and user overrides

Choose a server in **Notification Settings**, then search by username or display
name. Only matching users from that server's authenticated member directory are
shown, up to 20 at a time. Empty searches show no users. Changing servers clears
the search. Channel overrides stay below the user results.

User rules and sounds apply to incoming DMs from that user on that server, without
creating or opening a conversation. An explicit conversation override takes
precedence, then the user's DM override, then the server and client defaults.
A muted server or the master notification switch still silences notifications.
These local preferences, including custom sound files, survive restarts and are
included in client backups.

## Desktop delivery and badges

Enable **Client settings → Notification Settings → Desktop popups** for alerts
while Haunt is in the background. **Send test notification** exercises the same
native delivery service immediately, including while the app is focused, without
changing your saved notification preferences. Native errors appear in settings.
A system acknowledgement does not mean a banner was visible: Focus/Do Not Disturb
and notification permissions still control what the desktop presents.

Unread DMs and mentions contribute to the count; ordinary unread channel messages
use a dot. Counts aggregate connected accounts and clear as conversations are read
or accounts sign out. macOS uses the Dock badge and menu-bar title. Allow Haunt
alerts and badges in **System Settings → Notifications**. Linux uses the tray,
window icon and the LauncherEntry badge API on supporting docks. Packaging and
runtime share `com.exampleuser.haunt.desktop`, including Wayland app identity and
X11 window grouping. Linux native alerts require the system `libnotify` library
(`libnotify4` on Ubuntu/Debian) and a running desktop notification service.
A desktop without launcher badges still has the tray count.
The desktop identity change requires a full installer update; the updater detects
the changed launcher fingerprint and offers that installer. Existing profiles keep
their current location.

Native notifications replace older alerts from the same conversation without
suppressing simultaneous alerts from different conversations. The OS controls
notification lifetime; Haunt no longer forcibly dismisses them after 15 seconds.
Clicking restores the window and opens the originating server/conversation.
Keep Haunt running and connected; closing the window to its tray is supported.

Native Actions rehearsals exercise the packaged bridge and real Dock badge reads
on Apple Silicon, and real notification/LauncherEntry D-Bus traffic against a
private Linux daemon with click-to-restore checks. These are integration checks,
not evidence that banners or badges were visually displayed in every desktop.
Verify an installed client's alerts and clear-on-read behavior on the target Mac
or Linux desktop using another account, with Haunt hidden and system alerts enabled.

References: [Electron notifications](https://www.electronjs.org/docs/latest/api/notification),
[desktop identity and badges](https://www.electronjs.org/docs/latest/api/app#appsetdesktopnamename-linux).
