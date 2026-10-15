# Appearance

User settings → Appearance includes Charcoal, Midnight, Plum, Forest and Paper
presets, plus Ultraviolet (violet/blue/teal with lime), Tidal (teal/blue/plum
with coral), and Afterglow (rose/amber/indigo with mint). The bolder themes
blend two or three background colors; chat uses a subtler opaque blend for
readability. A preset changes the main colors and accent together. Background, chat
panels, cards/controls, main text, secondary text, borders and accent can also be
edited individually with color pickers or six-digit hex values. Invalid hex input
reverts on blur. A low-contrast notice helps with custom choices; Reset appearance
returns to neutral Charcoal and the original accent. The 96-pastel accent palette
remains available in a collapsible section.

Preferences apply across servers on the current client, survive logout/restart and
are included in configuration backups. They are local UI settings, not a server's
branding or permission to change another user's appearance.

## Save and share

Name the current appearance and choose **Save as new theme**. Select a saved
entry to apply, rename/update it with the current appearance, or delete it.
Up to 64 named presets are saved locally and included in client backups.
**Export theme** downloads the current colors, background blend and desktop
effect settings as a `.haunt-theme.json` file. **Import theme** validates and
saves a shared file; it does not apply it until you click **Apply saved theme**.
Exports contain no accounts, sessions or device identifiers. Imports accept only
bounded numeric settings and hex colors, never CSS, scripts or external assets.
Unsupported file versions and files larger than 32 KiB are rejected.

## Desktop materials

Electron adds Solid, native material and Transparent sidebar modes. Windows uses
Mica on Windows 11 22H2 or later; macOS uses vibrancy (shown as Frosted glass).
Linux offers plain transparency, whose result depends on the compositor. Browser
clients keep opaque surfaces. Only the sidebars/title bar expose the background;
chat remains opaque, and an opacity slider adjusts the sidebar tint.

A change requiring a different native transparent-window construction is saved for
next launch. The UI says when a restart is needed; it never interrupts a call to
restart automatically. Unsupported native material falls back to a solid window.
The native preference contains only validated mode/color values and is separate
from authentication data. Old desktop shells without the bridge show an update note.

The platform APIs are [Electron background materials and vibrancy](https://www.electronjs.org/docs/latest/api/base-window#winsetbackgroundmaterialmaterial-windows).
Their appearance must still be checked on the target OS. The Linux development
host uses web screenshots and unit tests; it does not run Electron or pretend to
capture Windows/macOS native material rendering.
