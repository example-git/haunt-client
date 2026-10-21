#!/bin/bash
set -euo pipefail
parent=$1
destination=$2
staged=$3
shift 3
[[ "$parent" =~ ^[0-9]+$ && "$destination" == /*/Haunt.app && "$staged" == "$HOME/Library/Application Support/Haunt Local Signing/staging/haunt-install."*/Haunt.app ]] || exit 1
work=$(dirname "$staged")
if ! /bin/bash "$work/commit-install.sh" "$staged" "$destination" "$parent" "$work/ready-to-replace"; then
  if ! kill -0 "$parent" 2>/dev/null; then
    /usr/bin/osascript -e 'display alert "Haunt update was not installed" message "The previous app is still installed. Check Haunt Local Signing/last-update.log in your Library/Application Support folder for details."'
    /usr/bin/open "$destination"
  fi
  exit 1
fi
/usr/bin/open -n "$destination" --args "$@"
/bin/rm -rf "$work"
