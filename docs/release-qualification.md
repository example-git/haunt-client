# Release qualification

Keep one evidence record per release and platform, using `passed`, `failed`, or
`not run`. Record revisions, artifact hashes, OS/architecture, device models,
network, steps, observations and artifact paths. Missing evidence is not a pass.

## Automated checks

Client regressions run on main pushes and pull requests. Desktop releases require
that job and build on Windows x64, Linux x64/arm64 and macOS arm64. Each native
runner executes `scripts/check-installed-upgrade.mjs`: verify the previous signed
installer, install into a temporary directory, launch with a private profile,
install the candidate, then observe its version and preserved profile marker.
Linux uses AppImage extraction; macOS runs the local signing installer; Windows executes
NSIS. The `installed-upgrade-*` artifacts record the result. No user profile is used.

Linux jobs also install the RPM with DNF in a disposable Fedora container and launch
the installed Electron application as an unprivileged user. They check the menu
launcher, RPM update selection, package replacement, removal, and profile retention
through reinstallation. Results are recorded in `fedora-rpm-*` artifacts.

The bundled-runtime check installs fresh RPM and AppImage packages in a minimal
Fedora container without system GStreamer. It then uses a previous published
package's updater with a signed test feed to replace each format. The packaged
capture worker is copied alone into a separate directory and must produce H.264
video and isolated app/output audio after both installation and update. Checks
verify that loaded GStreamer libraries come from its private runtime despite
conflicting inherited plugin paths. Linux x64 also verifies Selkies runtime hashes
and compiles a kernel with bundled NVRTC; this does not verify GPU encoding. `linux-runtime-install-*` records the runtime hashes,
installer selection and capture results on x64 and ARM64.

The Wayland capture workflow uses a software-rendered Sway session and a pinned
portal backend with the pending upstream [capture-lifetime fix](https://github.com/emersion/xdg-desktop-portal-wlr/pull/407).
It runs the backend's regression tests and verifies decoded video and share audio
through the server relay. Artifacts record the backend revision. Unpatched
xdg-desktop-portal-wlr can terminate with `session already has a frame object`
during buffer replacement. The CI backend is not shipped with Haunt; installed
clients use their desktop's portal, so these checks do not establish compatibility
with affected backend versions.

Notification checks drive the packaged app with protocol messages and real UI
actions. They inspect actual desktop popups and badges, click OS notifications,
and observe sound output, including PipeWire recordings on Linux. Playwright's
default focus emulation is disabled so real window focus controls delivery.
Fedora checks run against KDE Plasma's notification service. The macOS update
check verifies local signing, the Update app action, bundle replacement, stable
signing identity and relaunch with the original profile.

This checks full-installer replacement. Automatic ASAR restarts, OS prompts,
physical capture, account recovery and perceived media quality need the checks
below. A missing previous installer or failed rehearsal fails the release job.

The server browser regression job exercises sign-in, encrypted DMs, source audio
and web updates using disposable databases and private Chrome profiles. Its manual
**Call endurance** workflow observes two peers with microphone, camera audio,
screen audio and two video feeds on each transport sequentially. It requires
audible playback and advancing decoded video frames, and retains all samples.

After verifying the isolated database and building the web client, run locally:

```sh
HAUNT_CLIENT_CHECK=source-audio HAUNT_CALL_SOAK_SECONDS=900 npm run test:integration
```

The duration is per transport and must be 30–1800 seconds. Harness timeouts include
the duration. Results are `test-results/call-soak-*.json`. This is a two-peer
regression using deterministic media fixtures; it does not establish maximum room
capacity, physical capture quality, congested-network behavior or day-long stability.

## Native device and automatic-update qualification

Use dedicated accounts and a disposable profile on each intended OS. Compare
original and filtered clips for audio checks. Keep echo cancellation disabled and
microphone monitoring explicit.

| Case                        | Required observation                                                                                                  |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Initial install             | Installer, signature/security prompts, first launch and expected version                                              |
| Compatible automatic update | Signed ASAR download, confirmation with work active, automatic restart, new version and retained sessions/preferences |
| Runtime-changing update     | Full installer selected, errors visible, replacement launches with existing profile                                   |
| Cancel/rollback             | Cancel preserves ongoing work; failed candidate startup returns to prior working version                              |
| Physical audio              | Device selection, permission denial/retry, explicit monitoring, mute/unmute and device reconnect                      |
| Camera/screen               | Physical camera, screen permission, source switching, independent audio and remote decoded playback                   |
| Mac capture                 | Native Apple Silicon capture, first-use permissions, signing and window/screen capture                                |
| Network recovery            | Real interruption and reconnect; verify messages, call state and no accumulating duplicate streams                    |
| Sustained call              | At least 30 minutes on intended network; retain playback and resource observations                                    |
| Recovery                    | Synthetic-account backup/import, readable history and fresh sending identity without overwriting another profile      |

Attach screenshots and original/received clips where useful. Mark unavailable
devices and unperformed cases `not run`, and identify who must complete them.
Linux browser tests and native CI startup do not establish these results.
