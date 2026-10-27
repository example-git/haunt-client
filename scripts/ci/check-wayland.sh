#!/usr/bin/env bash
set -euo pipefail
test "${CI:-}" = true
test "${GITHUB_ACTIONS:-}" = true
export PATH="$RUNNER_TEMP/wayland-sdk/bin:$PATH"
export LD_LIBRARY_PATH="$RUNNER_TEMP/wayland-sdk/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
unset DISPLAY WAYLAND_DISPLAY SWAYSOCK
export XDG_RUNTIME_DIR
XDG_RUNTIME_DIR=$(mktemp -d /tmp/haunt-wayland.XXXXXX)
export XDG_CONFIG_HOME="$XDG_RUNTIME_DIR/config"
export XDG_DATA_HOME="$XDG_RUNTIME_DIR/data"
export XDG_SESSION_TYPE=wayland XDG_CURRENT_DESKTOP=sway
export WLR_BACKENDS=headless WLR_RENDERER=pixman WLR_LIBINPUT_NO_DEVICES=1
export HAUNT_PORTAL_CHOICE="$XDG_RUNTIME_DIR/portal-choice"
export PULSE_SERVER="unix:$XDG_RUNTIME_DIR/pulse/native"
export HAUNT_CLIENT_CHECK=wayland-share-audio
mkdir -p test-results/wayland "$XDG_CONFIG_HOME/xdg-desktop-portal" "$XDG_CONFIG_HOME/xdg-desktop-portal-wlr" "$XDG_DATA_HOME/applications"
chmod 700 "$XDG_RUNTIME_DIR"
pids=()
cleanup() {
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait || true
  if mountpoint -q "$XDG_RUNTIME_DIR/doc"; then fusermount3 -u "$XDG_RUNTIME_DIR/doc"; fi
  rm -rf "$XDG_RUNTIME_DIR"
}
trap cleanup EXIT
cat > "$XDG_CONFIG_HOME/sway.conf" <<'EOF'
xwayland disable
output HEADLESS-1 mode 1600x1000
output HEADLESS-1 bg #e02040 solid_color
for_window [app_id="com.exampleuser.haunt"] floating enable, resize set 1000 700, move position center
EOF
cat > "$XDG_CONFIG_HOME/xdg-desktop-portal/portals.conf" <<'EOF'
[preferred]
default=gtk
org.freedesktop.impl.portal.ScreenCast=wlr
org.freedesktop.impl.portal.Screenshot=wlr
EOF
cat > "$XDG_CONFIG_HOME/xdg-desktop-portal-wlr/config" <<EOF
[screencast]
max_fps=30
chooser_type=simple
chooser_cmd=cat $HAUNT_PORTAL_CHOICE
EOF
cat > "$XDG_DATA_HOME/applications/com.exampleuser.haunt.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Haunt
Exec=$PWD/node_modules/electron/dist/electron $PWD/apps/desktop/main.cjs
StartupWMClass=com.exampleuser.haunt
EOF
printf 'HEADLESS-1\n' > "$HAUNT_PORTAL_CHOICE"
sway --config "$XDG_CONFIG_HOME/sway.conf" --debug > test-results/wayland/sway.log 2>&1 &
pids+=("$!")
for attempt in $(seq 1 100); do
  for socket in "$XDG_RUNTIME_DIR"/wayland-*; do
    if test -S "$socket"; then export WAYLAND_DISPLAY="${socket##*/}"; break; fi
  done
  test -n "${WAYLAND_DISPLAY:-}" && break
  sleep 0.1
done
test -n "${WAYLAND_DISPLAY:-}"
for socket in "$XDG_RUNTIME_DIR"/sway-ipc.*.sock; do export SWAYSOCK="$socket"; done
dbus-update-activation-environment WAYLAND_DISPLAY XDG_CURRENT_DESKTOP XDG_SESSION_TYPE XDG_CONFIG_HOME XDG_DATA_HOME XDG_RUNTIME_DIR HAUNT_PORTAL_CHOICE
pipewire > test-results/wayland/pipewire.log 2>&1 &
pids+=("$!")
wireplumber > test-results/wayland/wireplumber.log 2>&1 &
pids+=("$!")
pipewire-pulse > test-results/wayland/pipewire-pulse.log 2>&1 &
pids+=("$!")
for attempt in $(seq 1 100); do
  pactl info > test-results/wayland/audio-server.txt 2>/dev/null && break
  sleep 0.1
done
grep -q PipeWire test-results/wayland/audio-server.txt
pactl load-module module-null-sink sink_name=haunt_fixture rate=48000 channels=2 sink_properties=device.description=Haunt_test_output
pactl load-module module-null-sink sink_name=haunt_playback rate=48000 channels=2 sink_properties=device.description=Haunt_receiver_output
pactl set-default-sink haunt_playback
../../portal-wlr/build/xdg-desktop-portal-wlr --loglevel=DEBUG > test-results/wayland/portal-wlr.log 2>&1 &
portal_pid=$!
pids+=("$portal_pid")
gdbus wait --session --timeout 30 org.freedesktop.impl.portal.desktop.wlr
kill -0 "$portal_pid"
gdbus call --session --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus --method org.freedesktop.DBus.GetConnectionUnixProcessID org.freedesktop.impl.portal.desktop.wlr | grep -qw "$portal_pid"
/usr/libexec/xdg-desktop-portal --verbose > test-results/wayland/portal.log 2>&1 &
pids+=("$!")
gdbus wait --session --timeout 30 org.freedesktop.portal.Desktop
wayland-info > test-results/wayland/protocols.txt
dpkg-query -W pipewire wireplumber xdg-desktop-portal xdg-desktop-portal-wlr > test-results/wayland/packages.txt
sway --version > test-results/wayland/compositor.txt
git rev-parse HEAD > test-results/wayland/client-sha.txt
GST_DEBUG="3,pipewiresrc:6,videorate:6,x264enc:5" GST_DEBUG_FILE="$PWD/test-results/wayland/gstreamer-%p.log" HAUNT_CAPTURE_EXISTING_SESSION=1 node scripts/check-linux-capture-worker.mjs
npm run test:integration 2>&1 | tee test-results/wayland/runtime.log
