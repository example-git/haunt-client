# Haunt brand identity and implementation handoff

## Owner requirements

The supplied ghost owl is the approved logo. Do not redesign it. Do not redraw, trace, recolor, crop, sharpen, simplify the eyes, add a glow to the image, or generate replacements. The original PNG and its alpha channel are authoritative. Only proportional downsampling, format conversion and platform-required padding/backing are allowed.

The interface must read as **black**, with subtle cool light making it feel navy. Do not implement a navy background or a blue-filled panel system. Orange comes from the owl's spiral eyes. Preserve the warm/cool contrast.

This kit is a specification and asset handoff. No application files were changed or built to produce it. Implement the brand in the main development task. Do not infer feature completeness from these mockups, image exports or supplied manifest.

## Visual identity

Use the ghost owl as the identifying mark. Keep the surrounding interface restrained, with near-black surfaces, a pale outline language, and orange accents drawn from the eyes. The product name is **Haunt**, capital H, lowercase aunt. Do not add slogans, taglines, promotional catchphrases, or a mascot name.

Describe the product as a self-hosted place for a community's messages and calls. Avoid claims of anonymity, end-to-end encryption, permanent history, or guaranteed privacy from the host operator. Use plain action labels: “Join a server”, “Open messages”, “Join voice”, “Reconnect”. Error messages should state what happened and the next action, without spooky jokes or invented technical assurances.

## Name and technical identifiers

Use **Haunt** for the wordmark, window and page titles, launcher display name, installer-facing product name, and descriptive documentation. Keep the owl as a separate image. The current project directory, hostnames, origins, package names, application IDs, storage keys and protocol identifiers remain technical integration details. Do not automatically rename them in a branding pass: some affect saved sessions, app updates and OS identity. Existing code paths in this handoff refer to the current chat-xo-vg project. No domain-name or trademark availability claim is made.

## Palette

These are proposed interface colors coordinated with the original, not replacement colors for the artwork.

| Token | Hex | Use |
| --- | --- | --- |
| Black | `#060609` | Page, server rail, app launch backdrop, launcher backing |
| Surface | `#0C0C11` | Sidebar and ordinary panels; still reads black |
| Raised | `#121219` | Menus, dialogs, selected containers |
| Hover | `#1A1A24` | Subtle surface response |
| Separator | `#353543` | Decorative dividers; not a sole essential control outline |
| Control border | `#646479` | Essential input boundaries on black surfaces |
| Spectral white | `#F1F4FF` | Primary text and wordmark |
| Muted | `#A4A5B6` | Secondary text, timestamps, descriptions |
| Ember | `#FF9A3D` | Primary actions, active accent, mention emphasis |
| Ember hover | `#FFB16A` | Hovered primary action |
| Cool light | `#8996FF` | Low-opacity edge illumination only |
| Focus | `#B8C6FF` | Solid visible keyboard focus outline |
| Success | `#83D6B1` | Connected/success state, with label or shape |
| Danger | `#F28CA6` | Errors/destructive action, with label or icon |
| Warning | `#E6C778` | Warnings, with label or icon |

Keep at least 90% of a normal screen on neutral near-black surfaces. Blue-violet light should occupy edges and small focal areas, not entire panels. Orange is concentrated in the eyes and a few important controls. Do not recolor the owl to match these token values.

## Light, shape and motion

- Use the supplied CSS token file as a reference; it is not loaded into the app.
- Default surface fills remain the neutral values above. An optional background radial light has a maximum 4% cool-light opacity and fades to transparent within 40% of its region.
- Cool edge glow: `0 0 18px rgb(137 150 255 / 8%)`. Warm active glow: `0 0 14px rgb(255 154 61 / 10%)`. Both are decorative and static. Apply to containers/controls, never as a filter on the logo.
- Focus uses a solid 2px pale outline and a 2px gap; glow alone is insufficient.
- Controls: 8px corners. Panels/dialogs: 12px. Use 4/8/12/16/24/32 spacing steps.
- Optional state transitions: 120–160ms, opacity or background only. No perpetual breathing, eye spinning, neon flicker, or animated logo. Respect reduced motion.
- Keep text crisp: no text glow. Do not put body text over light blooms or gradients.

## Typography and logo layout

Use the existing Inter-first system font stack. If Inter is not bundled, use the system fallback; this kit does not provide or fetch a font. Do not assume a particular installed font when checking layout.

| Role | Size / line height | Weight |
| --- | --- | --- |
| Brand wordmark | 28 / 32px | 700 |
| Display heading | 40 / 44px desktop; 30 / 36px compact | 700 |
| Section heading | 20 / 28px | 600 |
| Body | 15 / 22px | 400 |
| Control label | 14 / 20px | 600 |
| Metadata | 12 / 16px | 400 |

Use `-0.02em` letter spacing for the wordmark/display text only. Render “Haunt” as live text next to the approved image, not baked into a new logo. Use spectral white for the name. No custom letter substitutions or eye/letter mashups.

For a horizontal lockup, use a 48px owl with a 12px gap before the wordmark; vertically center the pair. Maintain at least 1/8 of the displayed icon width as external clear space. For a stacked presentation use a 128px owl, then a 24px gap to the name. These are layout recipes, not new artwork files.

Use the complete owl at all sizes. Preferred standalone UI size is at least 32px; 24px is acceptable in a constrained toolbar. The 16px favicon inevitably loses spiral detail. It must not silently be replaced by eyes-only art, an “xo” monogram, or a new simplified mark. Test at actual scale.

## Export inventory

All paths below are relative to this kit. The original is a 3762 × 3762 RGBA PNG. `source/logo-original.png` is a byte-for-byte copy of the owner file. `asset-manifest.json` records dimensions and SHA-256 values. `tools/export_assets.py` reproduces the exports using Pillow, without building any app.

| Location | Supplied exports | Intended use |
| --- | --- | --- |
| `png/` | 16, 20, 24, 32, 40, 48, 64, 96, 128, 192, 256, 384, 512, 1024, 2048px | Transparent UI, high-density display, documentation |
| `web/` | 16/32/48 PNG + multi-size ICO favicon; 192/512 regular icons | Browser tab and install metadata |
| `web/` | 192/512 maskable PNG; 180px apple-touch icon | Unchanged owl on near-black backing with platform padding |
| `web/site.webmanifest` | Example manifest, relative icon URLs | Merge into the real web app with correct deployment scope |
| `desktop/icon.png` | 1024px transparent PNG | Electron runtime/window image; packaging source |
| `desktop/icon.ico` | 16/24/32/48/64/128/256 embedded sizes | Windows packaging |
| `desktop/icon.icns` and `desktop/icon.iconset/` | macOS icon container and 1x/2x PNG sources through 1024px | macOS packaging |
| `desktop/linux/` | 16/24/32/48/64/128/256/512/1024 PNG | Linux desktop icon set |
| `android/res/` | Legacy launchers in five densities; transparent adaptive foregrounds; background color and adaptive XML | Future Android app resource tree |
| `android/play-store-512.png` | 512px opaque square | Store icon source, not a complete store listing |

Padded images add surrounding space and near-black backing only. They retain the original proportions, pixels subject to ordinary resampling, outline, eyes and embedded glow. Maskable icons keep all artwork inside the central 80%-diameter safe circle. Android foregrounds use 108dp canvases and fit inside the central 66dp safe circle with extra pixel margin. This is deliberately conservative so the ears and tail survive masks.

There is no true vector master. Do not describe a PNG embedded in SVG as a vector logo. No monochrome template, Android monochrome/themed asset, Android notification-small-icon silhouette, Safari pinned-tab mask, or recolored light-mode variant is supplied: these would require new artwork and owner approval. Android/other operating systems may still apply their own theme or mask behavior. Color app/launcher exports are supplied; Android native integration and OS theming remain device-verification work. There is no iOS application target in the inspected project; the apple-touch icon is for web bookmarks, not an iOS app asset catalog.

## Main agent integration map

Inspect current files before editing: this map was read from the local copy on 2026-10-10 and remote work may have advanced.

1. **Web assets:** place `web/` outputs in `client/apps/web/public/brand/` (or the project's actual static directory). Put favicon/apple-touch/manifest links in `client/apps/web/index.html`; update its theme color to black. Resolve URLs relative to the actual base path. A manifest alone does not establish offline support or successful installation.
2. **Desktop packaging:** the inspected `client/electron-builder.config.json` points all platforms at `build/icon.png`. Populate `client/build/` with the kit's PNG, ICO and ICNS; set each platform's icon to the appropriate file if desired. Linux may use the explicit PNG set. `client/build/` was absent in the inspected local checkout: create it deliberately.
3. **Staging:** `client/scripts/stage-electron.mjs` copies `build/icon.png` to staged `electron-app/resources/icon.png`. Maintain this path. Do not edit generated staged resources as the only implementation: staging would overwrite them.
4. **Window launch:** `client/apps/desktop/main.cjs` chooses staged `resources/icon.png` when packaged and `build/icon.png` in development. Update its `backgroundColor` to the black token as part of the later implementation.
5. **Dynamic badge path:** `client/packages/browser/src/badges.ts` currently draws an “xo” monogram onto a 64px canvas and sends it to desktop `setBadge` even when unread counts are zero. Replace this base drawing with the approved owl image; keep existing unread-count/title behavior. Wait for image decode before first redraw; keep the static owl visible during loading. Route clear/unread/count/99+/logout transitions through the same owl source. Restore the owl when clearing counts. Do not retain a hidden fallback to “xo”. Preserve the main-process 64 × 64 badge validation. Place count/dot decoration outside the owl's eyes; if needed use a padded 64px canvas and downsample the full owl within it.
6. **In-app mark:** replace the product's own “xo” branding with a complete owl image and live-text lockup. Preserve user/community avatars and custom server icons. Do not recolor user content or apply global image filters.
7. **Theme:** map `brand-tokens.css` into the actual theme system in `client/apps/web/src/style.css`. Audit hard-coded fills as well as variables. Updating `--accent` alone will leave old green selections and slate/blue backgrounds. Preserve readable status colors and visible keyboard focus.
8. **Android later:** merge resource files into the Android module's `res/` directory and reference `@mipmap/ic_launcher` from the application manifest. Android is a planned target, not a native module found in this task. Do not create an Android app just to consume the kit.

## Acceptance checklist for the main agent

- Source hash matches `asset-manifest.json`; the original is unchanged.
- Surfaces read black at normal brightness. Cool light is localized; broad areas do not read blue or navy.
- Transparent logo is undistorted, fully visible and legible on intended surfaces. Inspect 16/24/32/48px at native scale.
- Keyboard focus, text, inputs and statuses remain legible. Use `contrast-report.json` for exact proposed token-pair ratios; verify final composed UI separately.
- Browser tab starts with the owl and keeps it after unread messages, mentions, count clearing, logout and reload.
- Electron window/taskbar starts with the owl, survives badge updates and clears back to it. Packaged application/installer icons match too.
- Missing assets fail visibly during development; image loading never silently restores the old monogram.
- Inspect launcher crops with circle and rounded-square masks. Verify real device/OS rendering; file validity is not runtime proof.
- No claims of feature implementation, successful builds, device validation, encryption, or privacy guarantees based only on this kit.

## Platform references

- [Electron Builder icon formats and paths](https://www.electron.build/v26/docs/features/icons-and-images/)
- [MDN app icons and maskable safe area](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Define_app_icons)
- [Android adaptive layers and dimensions](https://developer.android.com/develop/ui/compose/system/icon_design_adaptive)

The palette, typography and visual examples are design proposals for the main agent; the owner's fixed requirements are the unchanged logo, black surfaces with subtle cool illumination, and no slogans.
