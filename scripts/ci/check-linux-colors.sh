#!/usr/bin/env bash
set -euo pipefail

test "${CI:-}" = true
test "${GITHUB_ACTIONS:-}" = true
dnf install -y nodejs gtk3 nss alsa-lib libXScrnSaver mesa-dri-drivers mesa-libEGL mesa-libGL \
  dbus-daemon xorg-x11-server-Xvfb xorg-x11-xauth xorg-x11-server-Xwayland \
  kwin qt6-qtwayland ImageMagick wayland-utils glx-utils python3-pillow
mkdir -p test-results/linux-colors /tmp/haunt-color-runtime /tmp/haunt-color-config
chmod 700 /tmp/haunt-color-runtime
cat /etc/os-release > test-results/linux-colors/os-release.txt
rpm -q kwin mesa-dri-drivers mesa-libEGL xorg-x11-server-Xwayland > test-results/linux-colors/packages.txt
rpm -q --filecaps kwin > test-results/linux-colors/kwin-capabilities.txt
QT_QPA_PLATFORM=offscreen kwin_wayland --version > test-results/linux-colors/kwin-version.txt
python3 scripts/ci/linux-color-pixels.py generate
export XDG_RUNTIME_DIR=/tmp/haunt-color-runtime
export XDG_CONFIG_HOME=/tmp/haunt-color-config
export XDG_SESSION_TYPE=wayland
export XDG_CURRENT_DESKTOP=KDE
export QT_QPA_PLATFORM=xcb
export LIBGL_ALWAYS_SOFTWARE=1
export KWIN_COMPOSE=O2
export KWIN_WAYLAND_NO_PERMISSION_CHECKS=1
export KWIN_SCREENSHOT_NO_PERMISSION_CHECKS=1
xvfb-run -a -s "-screen 0 1280x900x24 -nolisten tcp" bash -c '
  export HAUNT_COLOR_OUTER_DISPLAY="$DISPLAY"
  export HAUNT_COLOR_OUTER_XAUTHORITY="$XAUTHORITY"
  glxinfo -B > test-results/linux-colors/outer-gl.txt 2>&1
  dbus-run-session -- kwin_wayland --x11-display "$DISPLAY" --width 1280 --height 900 \
    --xwayland --no-lockscreen --no-global-shortcuts --socket haunt-colors \
    --exit-with-session "node scripts/check-linux-colors.mjs" \
    > test-results/linux-colors/kwin.log 2>&1
'
python3 scripts/ci/linux-color-pixels.py analyze
