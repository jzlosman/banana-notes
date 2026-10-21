#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ICONSET="$ROOT/assets/AppIcon.iconset"
mkdir -p "$ICONSET"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
swiftc -target "$(uname -m)-apple-macosx14.0" -framework AppKit \
  "$ROOT/native/BananaMark.swift" "$ROOT/scripts/make-icon.swift" -o "$TMP/make-icon"
"$TMP/make-icon" "$TMP/AppIcon-rendered.png"
sips -s dpiWidth 72 -s dpiHeight 72 -z 1024 1024 "$TMP/AppIcon-rendered.png" --out "$TMP/AppIcon.png" >/dev/null
cp "$TMP/AppIcon.png" "$ROOT/assets/AppIcon.png"
for size in 16 32 128 256 512; do
  sips -s dpiWidth 72 -s dpiHeight 72 -z "$size" "$size" "$TMP/AppIcon.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -s dpiWidth 72 -s dpiHeight 72 -z "$double" "$double" "$TMP/AppIcon.png" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$ROOT/assets/AppIcon.icns"
printf 'Generated assets/AppIcon.png, assets/AppIcon.icns, and ignored assets/AppIcon.iconset\n'
