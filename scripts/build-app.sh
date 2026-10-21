#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB_DIST="$ROOT/web/dist"
APP="$ROOT/build/Foldnote.app"
CONTENTS="$APP/Contents"
RESOURCES="$CONTENTS/Resources"

if [[ ! -f "$WEB_DIST/index.html" || ! -f "$WEB_DIST/app.js" || ! -f "$WEB_DIST/app.css" ]]; then
  echo "Expected prebuilt web assets at web/dist/{index.html,app.js,app.css}. Build the web frontend first." >&2
  exit 1
fi

rm -rf "$APP"
mkdir -p "$CONTENTS/MacOS" "$RESOURCES/web"
cp "$WEB_DIST"/{index.html,app.js,app.css,theme-catalog.json} "$RESOURCES/web/"
cp -R "$WEB_DIST/third-party" "$RESOURCES/web/"
if [[ -f "$WEB_DIST/app.js.map" ]]; then cp "$WEB_DIST/app.js.map" "$RESOURCES/web/"; fi
ARCH="$(uname -m)"
FLAGS=(-target "$ARCH-apple-macosx14.0" -O -framework AppKit -framework WebKit -framework Carbon)
if [[ "${FOLDNOTE_DEBUG:-}" == "1" ]]; then FLAGS+=(-D DEBUG); fi
swiftc "${FLAGS[@]}" "$ROOT"/native/*.swift -o "$CONTENTS/MacOS/Foldnote"

plutil -create xml1 "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleIdentifier string dev.local.foldnote' "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleName string Foldnote' "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleExecutable string Foldnote' "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundlePackageType string APPL' "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :NSPrincipalClass string NSApplication' "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleVersion string 1' "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleShortVersionString string 0.1.0' "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :LSMinimumSystemVersion string 14.0' "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :LSUIElement bool true' "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :NSHighResolutionCapable bool true' "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleURLTypes array' "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleURLTypes:0 dict' "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleURLTypes:0:CFBundleURLName string dev.local.foldnote' "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleURLTypes:0:CFBundleURLSchemes array' "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string foldnote' "$CONTENTS/Info.plist"

ICON_PATH="${FOLDNOTE_ICON:-}"
if [[ -z "$ICON_PATH" && -f "$ROOT/assets/AppIcon.icns" ]]; then ICON_PATH="$ROOT/assets/AppIcon.icns"; fi
if [[ -n "$ICON_PATH" ]]; then
  cp "$ICON_PATH" "$RESOURCES/AppIcon.icns"
  /usr/libexec/PlistBuddy -c 'Add :CFBundleIconFile string AppIcon' "$CONTENTS/Info.plist"
fi

codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"
echo "Built $APP"
