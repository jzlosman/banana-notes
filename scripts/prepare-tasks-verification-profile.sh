#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${1:-$ROOT/build/Banana Tasks.app}"
[[ -d "$APP" && -f "$APP/Contents/Info.plist" ]] || {
  echo "Build Banana Tasks.app first (or pass its bundle path)." >&2; exit 1;
}
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist")" == "com.jzlosman.banana-tasks" ]] || {
  echo "The supplied app is not the separately identified Banana Tasks bundle." >&2; exit 1;
}

PROFILE="$(mktemp -d "${TMPDIR:-/tmp}/BananaTasksVerification.XXXXXXXX")"
mkdir -p "$PROFILE/data"
chmod 700 "$PROFILE" "$PROFILE/data"
cp -R "$APP" "$PROFILE/Banana Tasks Verification.app"
VERIFY_APP="$PROFILE/Banana Tasks Verification.app"
INFO="$VERIFY_APP/Contents/Info.plist"
NONCE="$(basename "$PROFILE" | tr -cd '[:alnum:]' | tr '[:upper:]' '[:lower:]')"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.jzlosman.banana-tasks.verification.$NONCE" "$INFO"
/usr/libexec/PlistBuddy -c 'Set :CFBundleName Banana Tasks Verification' "$INFO"
/usr/libexec/PlistBuddy -c 'Set :CFBundleDisplayName Banana Tasks Verification' "$INFO"
/usr/libexec/PlistBuddy -c "Add :BananaTasksVerificationProfilePath string '$PROFILE'" "$INFO"
printf '{"version":1,"tasks":[],"runningSession":null,"todoistOutbox":[]}\n' > "$PROFILE/data/tasks.json"
chmod 600 "$PROFILE/data/tasks.json"
codesign --force --deep --sign - "$VERIFY_APP"
codesign --verify --deep --strict "$VERIFY_APP"
printf '%s\n' "$PROFILE"
