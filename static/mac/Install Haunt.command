#!/bin/bash
set -euo pipefail
umask 077

die() { printf '%s\n' "$*" >&2; exit 1; }
[[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] || die 'Haunt requires an Apple Silicon Mac.'
[[ $EUID != 0 ]] || die 'Run this installer as your normal user, without sudo.'

accepted=false
prepare=false
launch=true
destination="$HOME/Applications/Haunt.app"
if [[ -d /Applications/Haunt.app ]]; then destination=/Applications/Haunt.app; fi
source_app="$(cd "$(dirname "$0")" && pwd)/Haunt.app"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --accept-local-signing) accepted=true; shift ;;
    --prepare-update) prepare=true; shift ;;
    --no-open) launch=false; shift ;;
    --destination) [[ $# -gt 1 ]] || die 'Missing destination'; destination="$2"; shift 2 ;;
    --*) die "Unknown option: $1" ;;
    *) source_app="$1"; shift ;;
  esac
done
progress() { if $prepare; then printf 'HAUNT_PROGRESS\t%s\t%s\t%s\n' "$1" "${2:-0}" "${3:-0}" >&2; fi; }
[[ "$destination" == /*/Haunt.app && "$source_app" == /*/Haunt.app ]] || die 'Use absolute paths ending in Haunt.app.'
[[ -d "$source_app" && ! -L "$source_app" ]] || die 'The source Haunt.app is missing or is a symbolic link.'
bundle_id=$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$source_app/Contents/Info.plist")
[[ "$bundle_id" == com.exampleuser.haunt ]] || die 'This installer only accepts the Haunt application.'
/usr/bin/lipo -verify_arch arm64 "$source_app/Contents/MacOS/Haunt"

state_dir="$HOME/Library/Application Support/Haunt Local Signing"
state="$state_dir/identity.plist"
identity_name='Haunt Local Signing'
if ! $prepare; then
  cat >&2 <<EOF
Haunt local installation

The public app is unsigned and has not been notarized by Apple.
This installer creates a private code-signing key named "$identity_name" in
your user keychain and reuses it for future Haunt installations and updates.
The private key stays on this Mac. Keychain may ask you to allow codesign access.

It signs the installed app and its helpers, verifies the signatures, and removes
the downloaded-file quarantine attribute only from that installed copy.
This opts this copy of Haunt out of the downloaded-app Gatekeeper check; it does
not make Haunt Apple-approved or turn off Gatekeeper for other applications.

Destination: $destination
macOS will request administrator permission if this destination requires it.
EOF
  if ! $accepted; then
    [[ -t 0 ]] || die 'Review the above and rerun in Terminal, or explicitly pass --accept-local-signing.'
    read -r -p 'Install Haunt with this local signing setup? [y/N] ' reply
    [[ "$reply" == y || "$reply" == Y || "$reply" == yes ]] || die 'Installation cancelled.'
  fi
elif [[ ! -f "$state" ]]; then
  die 'Local signing has not been set up. Run Install Haunt.command first.'
fi

mkdir -p "$state_dir"
[[ ! -L "$state_dir" && ! -L "$state" ]] || die 'Local signing state must not be a symbolic link.'
[[ -O "$state_dir" ]] || die 'Local signing state belongs to another user.'
chmod 700 "$state_dir"
work=''
stage=''
cleanup() {
  /bin/rm -rf "$work"
  if [[ -n "$stage" ]]; then /bin/rm -rf "$stage"; fi
  /bin/rmdir "$state_dir/install.lock" 2>/dev/null || true
}
mkdir "$state_dir/install.lock" 2>/dev/null || die 'Another Haunt installation is running. If it stopped unexpectedly, remove the empty install.lock directory in Haunt Local Signing.'
trap cleanup EXIT
trap 'exit 130' INT TERM
work=$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/haunt-sign.XXXXXXXX")

if [[ -f "$state" ]]; then
  [[ -O "$state" ]] || die 'Local signing state belongs to another user.'
  fingerprint=$(/usr/libexec/PlistBuddy -c 'Print Fingerprint' "$state")
  keychain=$(/usr/libexec/PlistBuddy -c 'Print Keychain' "$state")
  [[ "$fingerprint" =~ ^[A-Fa-f0-9]{40}$ && "$keychain" == /* ]] || die 'Invalid local signing identity record.'
  /usr/bin/security find-identity -p codesigning "$keychain" | /usr/bin/grep -F "$fingerprint" >/dev/null || die 'The saved Haunt signing key is unavailable. Unlock or restore its keychain; no replacement key was created.'
else
  keychain=$(/usr/bin/security default-keychain -d user | /usr/bin/sed -e 's/^[[:space:]]*"//' -e 's/"[[:space:]]*$//')
  [[ -f "$keychain" ]] || die 'Your default user keychain is unavailable.'
  if /usr/bin/security find-certificate -c "$identity_name" "$keychain" >/dev/null 2>&1; then
    die 'A Haunt Local Signing certificate already exists without its identity record. Restore the record instead of creating another key.'
  fi
  cat > "$work/certificate.cnf" <<EOF
[req]
distinguished_name=subject
x509_extensions=extensions
prompt=no
[subject]
CN=$identity_name
[extensions]
basicConstraints=critical,CA:TRUE
keyUsage=critical,digitalSignature,keyCertSign
extendedKeyUsage=critical,codeSigning
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid:always
EOF
  /usr/bin/openssl req -new -newkey rsa:3072 -nodes -x509 -sha256 -days 3650 \
    -config "$work/certificate.cnf" -keyout "$work/key.pem" -out "$work/certificate.pem" 2>"$work/keygen.log"
  /usr/bin/openssl rand -base64 48 > "$work/password"
  /usr/bin/openssl pkcs12 -export -name "$identity_name" -inkey "$work/key.pem" \
    -in "$work/certificate.pem" -out "$work/identity.p12" -passout "file:$work/password"
  /usr/bin/security import "$work/identity.p12" -k "$keychain" \
    -P "$(cat "$work/password")" -T /usr/bin/codesign >&2
  fingerprint=$(/usr/bin/openssl x509 -in "$work/certificate.pem" -noout -fingerprint -sha1 | /usr/bin/sed -e 's/.*=//' -e 's/://g')
  /usr/bin/plutil -create xml1 "$work/identity.plist"
  /usr/bin/plutil -insert Fingerprint -string "$fingerprint" "$work/identity.plist"
  /usr/bin/plutil -insert Keychain -string "$keychain" "$work/identity.plist"
  /usr/bin/plutil -insert Name -string "$identity_name" "$work/identity.plist"
  /bin/mv "$work/identity.plist" "$state"
fi

mkdir -p "$state_dir/staging"
stage=$(/usr/bin/mktemp -d "$state_dir/staging/haunt-install.XXXXXXXX")
app="$stage/Haunt.app"
progress 'Copying the new application'
/usr/bin/ditto "$source_app" "$app"
# Only the staged Haunt copy is changed. Never change a downloaded DMG or source app.
if /usr/bin/xattr -lr "$app" | /usr/bin/grep com.apple.quarantine >/dev/null; then
  /usr/bin/xattr -dr com.apple.quarantine "$app"
fi
cat > "$work/entitlements.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>com.apple.security.cs.allow-jit</key><true/>
<key>com.apple.security.cs.disable-library-validation</key><true/>
<key>com.apple.security.device.camera</key><true/>
<key>com.apple.security.device.audio-input</key><true/>
</dict></plist>
EOF
sign() {
  /usr/bin/codesign --force --sign "$fingerprint" --keychain "$keychain" \
    --timestamp=none --options runtime --entitlements "$work/entitlements.plist" "$1" >&2
}
# Sign nested executable code before its containing bundles. Do not use --deep to sign.
progress 'Finding application components'
components=()
while IFS= read -r -d '' file; do
  if /usr/bin/file -b "$file" | /usr/bin/grep 'Mach-O' >/dev/null; then components+=("$file"); fi
done < <(/usr/bin/find "$app/Contents" -type f -print0)
while IFS= read -r -d '' bundle; do components+=("$bundle"); done < <(
  /usr/bin/find "$app/Contents" -depth -type d \( -name '*.app' -o -name '*.framework' -o -name '*.xpc' -o -name '*.appex' \) -print0
)
completed=0
total=$((${#components[@]} + 1))
progress 'Signing application components' "$completed" "$total"
for component in "${components[@]}"; do
  sign "$component"
  completed=$((completed + 1))
  progress 'Signing application components' "$completed" "$total"
done
/usr/bin/codesign --force --sign "$fingerprint" --keychain "$keychain" \
  --timestamp=none --options runtime --entitlements "$work/entitlements.plist" \
  --requirements "=designated => identifier \"com.exampleuser.haunt\" and certificate leaf = H\"$fingerprint\"" "$app" >&2
progress 'Signing application components' "$total" "$total"
progress 'Verifying the signed application'
/usr/bin/codesign --verify --deep --strict --verbose=2 "$app" >&2
if $prepare; then
  /usr/bin/codesign --verify --strict -R "=identifier \"com.exampleuser.haunt\" and certificate leaf = H\"$fingerprint\"" "$destination" >&2
  printf '%s\n' "$app"
  stage=''
  exit 0
fi
[[ ! -L "$destination" ]] || die 'The destination must not be a symbolic link.'
if [[ -e "$destination" ]]; then
  [[ "$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$destination/Contents/Info.plist")" == com.exampleuser.haunt ]] || die 'The destination is not Haunt.'
  if /usr/sbin/lsof -t "$destination/Contents/MacOS/Haunt" >/dev/null 2>&1; then die 'Quit Haunt and run this installer again.'; fi
fi
commit="$(cd "$(dirname "$0")" && pwd)/commit-install.sh"
if [[ ! -f "$commit" ]]; then commit="$source_app/Contents/Resources/local-install/commit-install.sh"; fi
[[ -f "$commit" ]] || die 'The local installation helper is missing from this Haunt bundle.'
/bin/cp "$commit" "$stage/commit-install.sh"
/bin/bash "$stage/commit-install.sh" "$app" "$destination"
printf 'Installed %s\nLocal identity: %s (%s)\n' "$destination" "$identity_name" "$fingerprint" >&2
if $launch; then /usr/bin/open "$destination"; fi
