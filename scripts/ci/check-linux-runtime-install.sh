#!/usr/bin/env bash
set -euo pipefail

test "${CI:-}" = true
test "$(id -u)" = 0
dnf install -y --setopt=install_weak_deps=False nodejs xorg-x11-server-Xvfb dbus-daemon python3 pulseaudio pulseaudio-utils ffmpeg-free gtk3 libnotify nss libXScrnSaver libXtst xdg-utils at-spi2-core libuuid libsecret alsa-lib mesa-libgbm
node scripts/check-linux-runtime-install.mjs
