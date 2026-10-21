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
while Haunt is in the background. **Send test notification** gives you five seconds
to switch away, then uses the normal notification rules, popup and sound delivery,
and unread badge path. It adds one temporary unread item for one minute; **Clear
test badge** removes only that item. Keeping Haunt focused suppresses the popup.
The result reports disabled settings, native errors and unconfirmed delivery.
Desktop focus comes from the native window, including minimization and hiding;
browser clients use page visibility and document focus.
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
Changes to the launcher or application identity require a full installer update.
The updater selects that installer by runtime fingerprint and preserves profiles.

Native notifications replace older alerts from the same conversation without
suppressing simultaneous alerts from different conversations. The OS controls
notification lifetime.
Clicking restores the window and opens the originating server/conversation.
Keep Haunt running and connected to receive notifications.

## Window and tray behavior

The tray menu opens or hides Haunt and offers **Quit Haunt**. Closing the main
window keeps the client and active calls running when a tray is available;
**Quit Haunt** exits the application. If no tray can be created, closing the main
window exits. Tray support depends on the desktop environment.

## Verification

Native Actions rehearsals use the packaged app, actual OS notifications and
desktop captures, real popup clicks, unread transitions and selected notification
sounds. Linux also records output from PipeWire and runs the RPM in Fedora KDE
Plasma. macOS reads the real Dock badge. Test reports and captures are retained as
release artifacts; they do not establish behavior on every desktop configuration.

References: [Electron notifications](https://www.electronjs.org/docs/latest/api/notification),
[desktop identity and badges](https://www.electronjs.org/docs/latest/api/app#appsetdesktopnamename-linux).
