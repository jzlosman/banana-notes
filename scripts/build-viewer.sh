#!/bin/bash
set -euo pipefail

# VIEWER_VERSION is an optional local build override; releases start from viewer/version.txt.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB_DIST="$ROOT/web/dist"
APP="$ROOT/build/Banana Viewer.app"
CONTENTS="$APP/Contents"
RESOURCES="$CONTENTS/Resources"
MACOS="$CONTENTS/MacOS"
VERSION_FILE="$ROOT/viewer/version.txt"

if [[ ! -f "$VERSION_FILE" ]]; then
  echo "Missing viewer-owned version source: viewer/version.txt" >&2
  exit 1
fi
VERSION="${VIEWER_VERSION:-$(tr -d '\r\n' < "$VERSION_FILE")}"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9.-]+)?$ ]]; then
  echo "VIEWER_VERSION must be a semantic version (got '$VERSION')." >&2
  exit 1
fi
BUILD="${VIEWER_BUILD:-$(git -C "$ROOT" rev-list --count HEAD)}"
if [[ ! "$BUILD" =~ ^[0-9]+(\.[0-9]+){0,2}$ ]]; then
  echo "VIEWER_BUILD must contain one to three numeric components (got '$BUILD')." >&2
  exit 1
fi

required=(viewer.html viewer.js viewer.css app.css theme-catalog.json)
for file in "${required[@]}"; do
  if [[ ! -f "$WEB_DIST/$file" ]]; then
    echo "Missing web viewer asset: web/dist/$file. Build the web viewer assets first." >&2
    exit 1
  fi
done
for path in "$WEB_DIST/fonts/manifest.js" "$WEB_DIST/fonts" "$WEB_DIST/third-party" \
            "$ROOT/web/src/domain/note-font-catalog.json" "$ROOT/viewer/Info.plist"; do
  if [[ ! -e "$path" ]]; then
    echo "Missing Banana Viewer build input: $path" >&2
    exit 1
  fi
done
if ! grep -q 'Content-Security-Policy' "$WEB_DIST/viewer.html" || \
   { ! grep -q "default-src 'none'" "$WEB_DIST/viewer.html" && ! grep -q "default-src 'self'" "$WEB_DIST/viewer.html"; } || \
   ! grep -q "connect-src 'none'" "$WEB_DIST/viewer.html" || \
   ! grep -q "object-src 'none'" "$WEB_DIST/viewer.html" || \
   ! grep -q "base-uri 'none'" "$WEB_DIST/viewer.html" || \
   ! grep -q 'banana-viewer-resource:' "$WEB_DIST/viewer.html" || \
   ! grep -q 'viewer.js' "$WEB_DIST/viewer.html" || \
   ! grep -q 'viewer.css' "$WEB_DIST/viewer.html" || \
   grep -Eq "script-src[^;]*'unsafe-inline'" "$WEB_DIST/viewer.html"; then
  echo "viewer.html must load viewer.js/css and declare a restrictive, non-inline CSP." >&2
  exit 1
fi

rm -rf "$APP"
mkdir -p "$MACOS" "$RESOURCES/web"
cp "$ROOT/viewer/Info.plist" "$CONTENTS/Info.plist"
cp "$WEB_DIST/viewer.html" "$WEB_DIST/viewer.js" "$WEB_DIST/viewer.css" \
   "$WEB_DIST/app.css" "$WEB_DIST/theme-catalog.json" "$RESOURCES/web/"
cp "$ROOT/web/src/domain/note-font-catalog.json" "$RESOURCES/web/note-font-catalog.json"
cp -R "$WEB_DIST/third-party" "$RESOURCES/web/"
cp -R "$WEB_DIST/fonts" "$RESOURCES/web/"

for ARCH in arm64 x86_64; do
  swiftc -swift-version 5 -O -target "$ARCH-apple-macosx14.0" \
    -framework AppKit -framework WebKit -framework UniformTypeIdentifiers \
    "$ROOT"/viewer/native/*.swift -o "$MACOS/Banana Viewer.$ARCH"
done
lipo -create "$MACOS/Banana Viewer.arm64" "$MACOS/Banana Viewer.x86_64" -output "$MACOS/Banana Viewer"
rm "$MACOS/Banana Viewer.arm64" "$MACOS/Banana Viewer.x86_64"
lipo "$MACOS/Banana Viewer" -verify_arch arm64
lipo "$MACOS/Banana Viewer" -verify_arch x86_64

/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $BUILD" "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleIdentifier com.jzlosman.banana-viewer' "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleExecutable Banana Viewer' "$CONTENTS/Info.plist"
if [[ -f "$ROOT/assets/AppIcon.icns" ]]; then
  cp "$ROOT/assets/AppIcon.icns" "$RESOURCES/AppIcon.icns"
  /usr/libexec/PlistBuddy -c 'Add :CFBundleIconFile string AppIcon' "$CONTENTS/Info.plist"
fi

if [[ -n "${VIEWER_SIGN_IDENTITY:-}" ]]; then
  codesign --force --sign "$VIEWER_SIGN_IDENTITY" "$APP"
else
  codesign --force --deep --sign - "$APP"
fi
codesign --verify --deep --strict --verbose=2 "$APP"
echo "Built universal $APP ($VERSION, build $BUILD)"
