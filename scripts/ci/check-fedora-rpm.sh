#!/usr/bin/env bash
set -euo pipefail

test "${CI:-}" = true
test "$(id -u)" = 0
rpm_file=$(find release/updates -maxdepth 1 -name '*.rpm' -print)
test -n "$rpm_file"
test "$(printf '%s\n' "$rpm_file" | wc -l)" = 1
rpm_file=$(realpath "$rpm_file")
dnf install -y nodejs xorg-x11-server-Xvfb xorg-x11-xauth dbus-daemon shadow-utils desktop-file-utils python3-dbus python3-gobject-base plasma-workspace-x11 kwin-x11 xdotool ImageMagick tesseract appstream pipewire pipewire-pulseaudio wireplumber pulseaudio-utils
dnf install -y "$rpm_file"
test "$(rpm -q --qf '%{NAME}' -p "$rpm_file")" = haunt
test "$(cat /opt/Haunt/resources/package-type)" = rpm
test -x /opt/Haunt/haunt
test "$(readlink -f /usr/bin/haunt)" = /opt/Haunt/haunt
rpm -ql haunt | grep -Fx /usr/share/applications/com.exampleuser.haunt.desktop
rpm -ql haunt | grep -Fx /opt/Haunt/resources/package-type
rpm -qf /usr/bin/haunt
rpm -V haunt
appstreamcli validate --no-net /usr/share/metainfo/com.exampleuser.haunt.metainfo.xml
desktop-file-validate /usr/share/applications/com.exampleuser.haunt.desktop
grep -Fx 'StartupWMClass=com.exampleuser.haunt' /usr/share/applications/com.exampleuser.haunt.desktop
grep -Fx 'X-GNOME-UsesNotifications=true' /usr/share/applications/com.exampleuser.haunt.desktop
useradd --create-home --uid 1001 haunt-rpm
mkdir -p test-results
chmod a+rwx test-results
runuser -u haunt-rpm -- xvfb-run -a -s "-screen 0 1920x1080x24" dbus-run-session -- node scripts/check-rpm-installed.mjs write
dnf reinstall -y "$rpm_file"
test "$(readlink -f /usr/bin/haunt)" = /opt/Haunt/haunt
runuser -u haunt-rpm -- xvfb-run -a -s "-screen 0 1920x1080x24" dbus-run-session -- node scripts/check-rpm-installed.mjs read
dnf remove -y haunt
test ! -e /opt/Haunt/haunt
test ! -e /usr/share/applications/com.exampleuser.haunt.desktop
test -d /home/haunt-rpm/.config/haunt
dnf install -y "$rpm_file"
runuser -u haunt-rpm -- xvfb-run -a -s "-screen 0 1920x1080x24" dbus-run-session -- node scripts/check-rpm-installed.mjs complete
