#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PRODUCT="${1:-notes}"
if [[ "$#" -gt 1 ]]; then
  echo "Usage: bash scripts/package-release.sh [notes|viewer]" >&2
  exit 2
fi
case "$PRODUCT" in
  notes)
    PRODUCT_NAME='Banana Notes'
    BUNDLE_ID='com.jzlosman.banana-notes'
    ASSET_PREFIX='Banana-Notes'
    OUT="$ROOT/build/release"
    TEMP_PREFIX='banana-notes-release'
    EXPECTED_VERSION="${BANANA_VERSION:-}"
    ;;
  viewer)
    PRODUCT_NAME='Banana Viewer'
    BUNDLE_ID='com.jzlosman.banana-viewer'
    ASSET_PREFIX='Banana-Viewer'
    OUT="$ROOT/build/viewer-release"
    TEMP_PREFIX='banana-viewer-release'
    EXPECTED_VERSION="${VIEWER_VERSION:-}"
    ;;
  *)
    echo "Unknown release product '$PRODUCT'. Use 'notes' or 'viewer'." >&2
    exit 2
    ;;
esac

APP="$ROOT/build/$PRODUCT_NAME.app"
if [[ ! -d "$APP" || ! -f "$APP/Contents/Info.plist" ]]; then
  echo "Signed app not found at '$APP'. Build the $PRODUCT_NAME app first." >&2
  exit 1
fi

plist_value() {
  /usr/libexec/PlistBuddy -c "Print :$1" "$APP/Contents/Info.plist"
}
ACTUAL_NAME="$(plist_value CFBundleName)"
ACTUAL_ID="$(plist_value CFBundleIdentifier)"
ACTUAL_EXECUTABLE="$(plist_value CFBundleExecutable)"
VERSION="$(plist_value CFBundleShortVersionString)"
BUILD="$(plist_value CFBundleVersion)"
if [[ "$ACTUAL_NAME" != "$PRODUCT_NAME" || "$ACTUAL_ID" != "$BUNDLE_ID" || "$ACTUAL_EXECUTABLE" != "$PRODUCT_NAME" ]]; then
  echo "The app bundle identity does not match the selected $PRODUCT release product." >&2
  exit 1
fi
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9.-]+)?$ ]]; then
  echo "The app bundle has an invalid release version '$VERSION'." >&2
  exit 1
fi
if [[ -n "$EXPECTED_VERSION" && "$VERSION" != "$EXPECTED_VERSION" ]]; then
  echo "App version '$VERSION' does not match the requested release version '$EXPECTED_VERSION'." >&2
  exit 1
fi

if [[ -z "${SIGN_IDENTITY:-}" ]]; then
  echo "SIGN_IDENTITY is required to sign the release disk image with the app's Developer ID." >&2
  exit 1
fi
if ! codesign --verify --deep --strict --verbose=2 "$APP"; then
  echo "The app signature is invalid; release packaging requires a Developer ID-signed app." >&2
  exit 1
fi
SIGNATURE_DETAILS="$(codesign -dv --verbose=4 "$APP" 2>&1 || true)"
ACTUAL_TEAM_ID=''
if [[ "$SIGNATURE_DETAILS" =~ TeamIdentifier=([A-Z0-9]{10}) ]]; then
  ACTUAL_TEAM_ID="${BASH_REMATCH[1]}"
fi
if ! grep -q 'flags=.*runtime' <<<"$SIGNATURE_DETAILS" || \
   ! grep -Fq "Identifier=$BUNDLE_ID" <<<"$SIGNATURE_DETAILS" || \
   [[ ! "$ACTUAL_TEAM_ID" =~ ^[A-Z0-9]{10}$ ]]; then
  echo "The app must have a hardened-runtime Developer ID signature for $BUNDLE_ID with a valid TeamIdentifier." >&2
  exit 1
fi
if [[ -n "${APPLE_TEAM_ID:-}" && "$ACTUAL_TEAM_ID" != "$APPLE_TEAM_ID" ]]; then
  echo "The app is signed by team $ACTUAL_TEAM_ID, not the expected APPLE_TEAM_ID." >&2
  exit 1
fi

if [[ -n "${NOTARY_PROFILE:-}" ]]; then
  if [[ -n "${NOTARY_KEY_PATH:-}${NOTARY_KEY_ID:-}${NOTARY_ISSUER:-}" ]]; then
    echo "Set either NOTARY_PROFILE or the complete NOTARY_KEY_PATH, NOTARY_KEY_ID, and NOTARY_ISSUER tuple, not both." >&2
    exit 1
  fi
  NOTARY_MODE=profile
elif [[ -n "${NOTARY_KEY_PATH:-}" || -n "${NOTARY_KEY_ID:-}" || -n "${NOTARY_ISSUER:-}" ]]; then
  if [[ -z "${NOTARY_KEY_PATH:-}" || -z "${NOTARY_KEY_ID:-}" || -z "${NOTARY_ISSUER:-}" ]]; then
    echo "Notarization API credentials are incomplete. Set NOTARY_KEY_PATH, NOTARY_KEY_ID, and NOTARY_ISSUER together." >&2
    exit 1
  fi
  if [[ ! -r "$NOTARY_KEY_PATH" ]]; then
    echo "Notarization API key is not readable at NOTARY_KEY_PATH." >&2
    exit 1
  fi
  NOTARY_MODE=api
else
  echo "Notarization credentials are missing. Set NOTARY_KEY_PATH, NOTARY_KEY_ID, and NOTARY_ISSUER, or set NOTARY_PROFILE to a notarytool keychain profile." >&2
  exit 1
fi

TEMP="$(mktemp -d "${TMPDIR:-/tmp}/$TEMP_PREFIX.XXXXXX")"
trap 'rm -rf "$TEMP"' EXIT
mkdir -p "$OUT"
DMG_NAME="$ASSET_PREFIX-${VERSION}.dmg"
ZIP_NAME="$ASSET_PREFIX-${VERSION}.zip"
DMG="$OUT/$DMG_NAME"
ZIP="$OUT/$ZIP_NAME"

submit_for_notarization() {
  local file="$1"
  echo "Submitting $(basename "$file") for notarization..."
  if [[ "$NOTARY_MODE" == api ]]; then
    xcrun notarytool submit "$file" --wait --key "$NOTARY_KEY_PATH" --key-id "$NOTARY_KEY_ID" --issuer "$NOTARY_ISSUER"
  else
    xcrun notarytool submit "$file" --wait --keychain-profile "$NOTARY_PROFILE"
  fi
}

# Stapling and validation fetch the ticket from Apple's CDN, which occasionally drops the
# connection after notarization has already succeeded. Retry those network steps only.
staple_with_retry() {
  local action="$1" file="$2" attempt
  local args=("$action")
  [[ "$action" == validate ]] && args+=(-v)
  for attempt in 1 2 3 4; do
    if xcrun stapler "${args[@]}" "$file"; then return 0; fi
    [[ "$attempt" == 4 ]] && break
    echo "stapler $action failed (attempt $attempt); retrying in $((attempt * 15))s..." >&2
    sleep $((attempt * 15))
  done
  echo "stapler $action failed after 4 attempts: $file" >&2
  return 1
}

NOTARY_ZIP="$TEMP/${ASSET_PREFIX}-${VERSION}-notary.zip"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$NOTARY_ZIP"
submit_for_notarization "$NOTARY_ZIP"
staple_with_retry staple "$APP"
staple_with_retry validate "$APP"

rm -f "$DMG" "$ZIP"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ZIP"
STAGING="$TEMP/dmg-root"
mkdir -p "$STAGING"
cp -R "$APP" "$STAGING/$PRODUCT_NAME.app"
ln -s /Applications "$STAGING/Applications"
hdiutil create -volname "$PRODUCT_NAME $VERSION" -srcfolder "$STAGING" -ov -format UDZO "$DMG"
codesign --force --sign "$SIGN_IDENTITY" --timestamp "$DMG"
submit_for_notarization "$DMG"
staple_with_retry staple "$DMG"
staple_with_retry validate "$DMG"
spctl -a -vv -t install "$DMG"
spctl -a -vv -t execute "$APP"

(
  cd "$OUT"
  shasum -a 256 "$DMG_NAME" "$ZIP_NAME" > SHA256SUMS
)
echo "Packaged $PRODUCT_NAME $VERSION (build $BUILD) in $OUT"
echo "Checksums: $OUT/SHA256SUMS"
