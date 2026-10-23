#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB_DIST="$ROOT/web/dist"
APP="$ROOT/build/Banana Notes.app"
CONTENTS="$APP/Contents"
RESOURCES="$CONTENTS/Resources"
MACOS="$CONTENTS/MacOS"
FRAMEWORKS="$CONTENTS/Frameworks"

if [[ ! -f "$WEB_DIST/index.html" || ! -f "$WEB_DIST/app.js" || ! -f "$WEB_DIST/app.css" ]]; then
  echo "Expected prebuilt web assets at web/dist/{index.html,app.js,app.css}. Build the web frontend first." >&2
  exit 1
fi

if [[ -n "${BANANA_VERSION:-}" ]]; then
  VERSION="$BANANA_VERSION"
else
  VERSION="$(cd "$ROOT" && node -p "JSON.parse(require('node:fs').readFileSync('package.json', 'utf8')).version")"
fi
if [[ ! "$VERSION" =~ ^[0-9]+(\.[0-9]+){1,2}([.-][A-Za-z0-9.-]+)?$ ]]; then
  echo "BANANA_VERSION must be a valid numeric app version (got '$VERSION')." >&2
  exit 1
fi
BUILD="${BANANA_BUILD:-$(git -C "$ROOT" rev-list --count HEAD)}"
if [[ ! "$BUILD" =~ ^[0-9]+(\.[0-9]+){0,2}$ ]]; then
  echo "BANANA_BUILD must contain one to three numeric components (got '$BUILD')." >&2
  exit 1
fi

SPARKLE_PUBLIC_KEY="${SPARKLE_PUBLIC_KEY:-}"
SPARKLE_DIR=""
if [[ -n "$SPARKLE_PUBLIC_KEY" ]]; then
  SPARKLE_DIR="$(bash "$ROOT/scripts/fetch-sparkle.sh")"
fi

rm -rf "$APP"
mkdir -p "$MACOS" "$RESOURCES/web"
cp "$WEB_DIST/index.html" "$WEB_DIST/app.js" "$WEB_DIST/app.css" "$WEB_DIST/theme-catalog.json" "$RESOURCES/web/"
cp -R "$WEB_DIST/third-party" "$RESOURCES/web/"
cp -R "$WEB_DIST/fonts" "$RESOURCES/web/"
if [[ -f "$WEB_DIST/app.js.map" ]]; then cp "$WEB_DIST/app.js.map" "$RESOURCES/web/"; fi

COMMON_FLAGS=(-O -framework AppKit -framework WebKit -framework Carbon -framework NaturalLanguage)
if [[ "${BANANA_NOTES_DEBUG-${FOLDNOTE_DEBUG:-}}" == "1" ]]; then COMMON_FLAGS+=(-D DEBUG); fi
if [[ -n "$SPARKLE_DIR" ]]; then
  mkdir -p "$FRAMEWORKS"
  cp -R "$SPARKLE_DIR/Sparkle.framework" "$FRAMEWORKS/"
  COMMON_FLAGS+=(-F "$SPARKLE_DIR" -framework Sparkle -Xlinker -rpath -Xlinker '@executable_path/../Frameworks')
fi

for ARCH in arm64 x86_64; do
  swiftc "${COMMON_FLAGS[@]}" -target "$ARCH-apple-macosx14.0" "$ROOT"/native/*.swift \
    -o "$MACOS/Banana Notes.$ARCH"
done
lipo -create "$MACOS/Banana Notes.arm64" "$MACOS/Banana Notes.x86_64" -output "$MACOS/Banana Notes"
rm "$MACOS/Banana Notes.arm64" "$MACOS/Banana Notes.x86_64"
lipo "$MACOS/Banana Notes" -verify_arch arm64
lipo "$MACOS/Banana Notes" -verify_arch x86_64

plutil -create xml1 "$CONTENTS/Info.plist"
# Keep the bundle identity so preferences, login-item identity, and single-instance behavior survive the rename.
/usr/libexec/PlistBuddy -c 'Add :CFBundleIdentifier string dev.local.foldnote' "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleName string Banana Notes' "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleDisplayName string Banana Notes' "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleExecutable string Banana Notes' "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundlePackageType string APPL' "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :NSPrincipalClass string NSApplication' "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c "Add :CFBundleVersion string $BUILD" "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c "Add :CFBundleShortVersionString string $VERSION" "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :NSHumanReadableCopyright string Copyright © 2026 Jeremy Zaborowski. MIT License.' "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :LSMinimumSystemVersion string 14.0' "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :LSUIElement bool true' "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :NSHighResolutionCapable bool true' "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleURLTypes array' "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleURLTypes:0 dict' "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleURLTypes:0:CFBundleURLName string dev.local.foldnote' "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleURLTypes:0:CFBundleURLSchemes array' "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string banananotes' "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleURLTypes:0:CFBundleURLSchemes:1 string foldnote' "$CONTENTS/Info.plist"
if [[ -n "$SPARKLE_PUBLIC_KEY" ]]; then
  /usr/libexec/PlistBuddy -c "Add :SUFeedURL string https://github.com/jzlosman/banana-notes/releases/latest/download/appcast.xml" "$CONTENTS/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :SUPublicEDKey string $SPARKLE_PUBLIC_KEY" "$CONTENTS/Info.plist"
fi

ICON_PATH="${BANANA_NOTES_ICON:-${FOLDNOTE_ICON:-}}"
if [[ -z "$ICON_PATH" && -f "$ROOT/assets/AppIcon.icns" ]]; then ICON_PATH="$ROOT/assets/AppIcon.icns"; fi
if [[ -n "$ICON_PATH" ]]; then
  cp "$ICON_PATH" "$RESOURCES/AppIcon.icns"
  /usr/libexec/PlistBuddy -c 'Add :CFBundleIconFile string AppIcon' "$CONTENTS/Info.plist"
fi

SIGN_IDENTITY="${SIGN_IDENTITY:-}"
if [[ -n "$SIGN_IDENTITY" ]]; then
  if [[ ! -f "$ROOT/packaging/BananaNotes.entitlements" ]]; then
    echo "Missing hardened-runtime entitlements at packaging/BananaNotes.entitlements." >&2
    exit 1
  fi
  if [[ -n "$SPARKLE_DIR" ]]; then
    SPARKLE_FRAMEWORK="$FRAMEWORKS/Sparkle.framework"
    codesign --force --sign "$SIGN_IDENTITY" --options runtime --timestamp \
      "$SPARKLE_FRAMEWORK/Versions/Current/Autoupdate"
    find "$SPARKLE_FRAMEWORK" -depth -type d \( -name '*.xpc' -o -name '*.app' \) \
      -exec codesign --force --sign "$SIGN_IDENTITY" --options runtime --timestamp {} \;
    codesign --force --sign "$SIGN_IDENTITY" --options runtime --timestamp "$SPARKLE_FRAMEWORK"
  fi
  codesign --force --sign "$SIGN_IDENTITY" --options runtime --timestamp \
    --entitlements "$ROOT/packaging/BananaNotes.entitlements" "$APP"
else
  codesign --force --deep --sign - "$APP"
fi
codesign --verify --deep --strict --verbose=2 "$APP"
echo "Built universal $APP ($VERSION, build $BUILD)"
