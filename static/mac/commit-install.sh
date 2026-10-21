#!/bin/bash
set -euo pipefail
staged=$1
destination=$2
wait_pid=${3:-}
ready=${4:-}
[[ "$staged" == /*/Haunt.app && "$destination" == /*/Haunt.app ]] || exit 1
[[ -d "$staged" && ! -L "$staged" && ! -L "$destination" ]] || exit 1
parent=$(dirname "$destination")
if [[ ! -d "$parent" ]]; then /bin/mkdir -p "$parent" 2>/dev/null || true; fi

# Only installing the already signed bundle requires access to /Applications.
# Keychain operations and signing always run as the normal user.
if [[ $EUID != 0 && ( ! -w "$parent" || ( -e "$destination" && ! -w "$destination" ) ) ]]; then
  script_path="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
  printf -v command '/bin/bash %q %q %q %q %q' "$script_path" "$staged" "$destination" "$wait_pid" "$ready"
  /usr/bin/osascript - "$command" <<'APPLESCRIPT'
on run arguments
  do shell script (item 1 of arguments) with administrator privileges
end run
APPLESCRIPT
  exit 0
fi

[[ "$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$staged/Contents/Info.plist")" == com.exampleuser.haunt ]] || exit 1
/usr/bin/codesign --verify --deep --strict "$staged"
if [[ -e "$destination" ]]; then
  [[ "$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$destination/Contents/Info.plist")" == com.exampleuser.haunt ]] || exit 1
fi
backup="${destination%.app}.previous.app"
if [[ -e "$backup" || -L "$backup" ]]; then
  [[ ! -L "$backup" && "$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$backup/Contents/Info.plist")" == com.exampleuser.haunt ]] || exit 1
fi
/bin/mkdir -p "$parent"
work=$(/usr/bin/mktemp -d "$parent/.haunt-replace.XXXXXXXX")
moved=false
cleanup() {
  if [[ -d "$work/previous.app" ]]; then
    if [[ ! -e "$destination" ]]; then
      /bin/mv "$work/previous.app" "$destination" || { printf 'Recovery copy retained at %s\n' "$work/previous.app" >&2; return; }
    else
      printf 'Recovery copy retained at %s\n' "$work/previous.app" >&2
      return
    fi
  fi
  /bin/rm -rf "$work"
}
trap cleanup EXIT
/usr/bin/ditto "$staged" "$work/Haunt.app"
/usr/bin/codesign --verify --deep --strict "$work/Haunt.app"
if [[ -n "$wait_pid" ]]; then
  [[ "$wait_pid" =~ ^[0-9]+$ && "$ready" == "$(dirname "$staged")/ready-to-replace" ]] || exit 1
  [[ ! -e "$(dirname "$staged")/cancelled" ]] || exit 1
  /usr/bin/touch "$ready"
  for ((attempt=0; attempt<120; attempt++)); do
    [[ ! -e "$(dirname "$staged")/cancelled" ]] || exit 1
    if ! kill -0 "$wait_pid" 2>/dev/null; then break; fi
    sleep 0.5
  done
  if kill -0 "$wait_pid" 2>/dev/null; then exit 1; fi
  [[ ! -e "$(dirname "$staged")/cancelled" ]] || exit 1
fi
if [[ -e "$destination" ]]; then
  /bin/mv "$destination" "$work/previous.app"
  moved=true
fi
/bin/mv "$work/Haunt.app" "$destination"
if $moved; then
  if [[ -e "$backup" ]]; then /bin/rm -rf "$backup"; fi
  /bin/mv "$work/previous.app" "$backup"
fi
