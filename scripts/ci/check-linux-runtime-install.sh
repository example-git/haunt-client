#!/usr/bin/env bash
set -euo pipefail

test "${CI:-}" = true
test "$(id -u)" = 0
report_owner=$(stat -c '%u:%g' .)
restore_report_owner() {
  if [ -d test-results ]; then chown -R "$report_owner" test-results; fi
}
trap restore_report_owner EXIT
dnf install -y --setopt=install_weak_deps=False nodejs xorg-x11-server-Xvfb dbus-daemon python3 pipewire pipewire-pulseaudio wireplumber pulseaudio-utils ffmpeg-free gtk3 libnotify nss libXScrnSaver libXtst xdg-utils at-spi2-core libuuid libsecret alsa-lib mesa-libgbm
dbus-run-session -- node scripts/check-linux-runtime-install.mjs
