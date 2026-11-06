#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB_DIST="$ROOT/web/dist"
APP="$ROOT/build/Banana Tasks.app"
CONTENTS="$APP/Contents"
RESOURCES="$CONTENTS/Resources"
MACOS="$CONTENTS/MacOS"
VERSION_FILE="$ROOT/tasks/version.txt"

[[ -f "$VERSION_FILE" ]] || { echo "Missing Tasks-owned version source: tasks/version.txt" >&2; exit 1; }
VERSION="${TASKS_VERSION:-$(tr -d '\r\n' < "$VERSION_FILE")}"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9.-]+)?$ ]] || {
  echo "TASKS_VERSION must be a semantic version (got '$VERSION')." >&2; exit 1;
}
BUILD="${TASKS_BUILD:-$(git -C "$ROOT" rev-list --count HEAD)}"
[[ "$BUILD" =~ ^[0-9]+(\.[0-9]+){0,2}$ ]] || {
  echo "TASKS_BUILD must contain one to three numeric components (got '$BUILD')." >&2; exit 1;
}

required=(tasks.html tasks.js tasks.css app.css theme-catalog.json)
for file in "${required[@]}"; do
  [[ -f "$WEB_DIST/$file" ]] || { echo "Missing Tasks web asset: web/dist/$file. Build the Tasks web assets first." >&2; exit 1; }
done
for path in "$WEB_DIST/fonts/manifest.js" "$WEB_DIST/fonts" "$WEB_DIST/third-party" "$WEB_DIST/tasks-brand" \
            "$ROOT/tasks/Info.plist" "$ROOT/assets/tasks-brand/AppIcon.icns" \
            "$ROOT/assets/tasks-brand/menu-bar.svg" "$ROOT/THIRD_PARTY_NOTICES.md"; do
  [[ -e "$path" ]] || { echo "Missing Banana Tasks build input: $path" >&2; exit 1; }
done
if ! grep -q 'Content-Security-Policy' "$WEB_DIST/tasks.html" || \
   { ! grep -q "default-src 'none'" "$WEB_DIST/tasks.html" && ! grep -q "default-src 'self'" "$WEB_DIST/tasks.html"; } || \
   ! grep -q "connect-src 'none'" "$WEB_DIST/tasks.html" || \
   ! grep -q "object-src 'none'" "$WEB_DIST/tasks.html" || \
   ! grep -q "base-uri 'none'" "$WEB_DIST/tasks.html" || \
   ! grep -q 'tasks.js' "$WEB_DIST/tasks.html" || \
   ! grep -q 'tasks.css' "$WEB_DIST/tasks.html" || \
   grep -Eq "script-src[^;]*'unsafe-inline'" "$WEB_DIST/tasks.html"; then
  echo "tasks.html must load Tasks JS/CSS and declare a restrictive, non-inline CSP with connect-src 'none'." >&2
  exit 1
fi

rm -rf "$APP"
mkdir -p "$MACOS" "$RESOURCES/web"
cp "$ROOT/tasks/Info.plist" "$CONTENTS/Info.plist"
cp "$WEB_DIST/tasks.html" "$WEB_DIST/tasks.js" "$WEB_DIST/tasks.css" \
   "$WEB_DIST/app.css" "$WEB_DIST/theme-catalog.json" "$RESOURCES/web/"
cp -R "$WEB_DIST/third-party" "$RESOURCES/web/"
cp -R "$WEB_DIST/fonts" "$RESOURCES/web/"
cp -R "$WEB_DIST/tasks-brand" "$RESOURCES/web/"
cp "$ROOT/THIRD_PARTY_NOTICES.md" "$RESOURCES/THIRD_PARTY_NOTICES.md"
cp "$ROOT/assets/tasks-brand/menu-bar.svg" "$RESOURCES/TasksMenuBar.svg"

for ARCH in arm64 x86_64; do
  swiftc -swift-version 5 -O -target "$ARCH-apple-macosx14.0" \
    -framework AppKit -framework WebKit -framework EventKit -framework Security -framework Carbon \
    "$ROOT"/tasks/native/*.swift -o "$MACOS/Banana Tasks.$ARCH"
done
lipo -create "$MACOS/Banana Tasks.arm64" "$MACOS/Banana Tasks.x86_64" -output "$MACOS/Banana Tasks"
rm "$MACOS/Banana Tasks.arm64" "$MACOS/Banana Tasks.x86_64"
lipo "$MACOS/Banana Tasks" -verify_arch arm64
lipo "$MACOS/Banana Tasks" -verify_arch x86_64

/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $BUILD" "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleIdentifier com.jzlosman.banana-tasks' "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleExecutable Banana Tasks' "$CONTENTS/Info.plist"
cp "$ROOT/assets/tasks-brand/AppIcon.icns" "$RESOURCES/AppIcon.icns"
/usr/libexec/PlistBuddy -c 'Add :CFBundleIconFile string AppIcon' "$CONTENTS/Info.plist"

# Standalone local builds are ad-hoc signed only; release signing/notarization is out of scope.
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"
echo "Built universal $APP ($VERSION, build $BUILD)"
