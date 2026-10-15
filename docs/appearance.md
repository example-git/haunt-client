# Appearance

User settings → Appearance includes Charcoal, Midnight, Plum, Forest and Paper
presets, wumpoff (Discord Dark palette), plus Ultraviolet (violet/blue/teal with lime), Tidal (teal/blue/plum
with coral), and Afterglow (rose/amber/indigo with mint). The bolder themes
blend two or three background colors; chat uses a subtler opaque blend for
readability. A preset changes the main colors and accent together. Background, chat
panels, channel sidebar, cards/controls, main text, secondary text, borders,
text-selection background/foreground and accent can also be
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
chat (including popped-out voice chat) remains opaque. The channel sidebar uses
the chosen opacity; the server icon rail is 15 percentage points more opaque,
capped at 100%. Frosted glass/Mica has a 30% minimum; plain transparency has a
50% minimum. Theme changes and selection colors propagate to an open call window.

A change requiring a different native transparent-window construction is saved for
next launch. The UI says when a restart is needed; it never interrupts a call to
restart automatically. Unsupported native material falls back to a solid window.
The native preference contains only validated mode/color values and is separate
from authentication data. Old desktop shells without the bridge show an update note.

The platform APIs are [Electron background materials and vibrancy](https://www.electronjs.org/docs/latest/api/base-window#winsetbackgroundmaterialmaterial-windows).
Their appearance must still be checked on the target OS. The Linux development
host uses web screenshots and unit tests; it does not run Electron or pretend to
capture Windows/macOS native material rendering.

## wumpoff palette

Core colors map to Discord's **Dark** theme (`.theme-darker`, distinct from Ash):
rail `#121214`, channel sidebar `#1a1a1e`, chat `#202024`, controls `#242429`,
text `#efeff1`, muted text `#96979e`, and blurple `#5865f2`.
Selection uses blurple with white text. Haunt keeps its own layout and icons.
Source: [Discord's published theme tokens](https://discord.com/assets/952007.3b490a4a037fd35b.css),
checked October 13, 2026. [Discord's theme names](https://support.discord.com/hc/en-us/articles/207260127-How-to-Change-Discord-Color-Themes-and-Customize-Appearance-Settings).
