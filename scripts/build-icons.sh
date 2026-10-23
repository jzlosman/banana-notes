#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ICONSET="$ROOT/assets/AppIcon.iconset"
BRAND="$ROOT/assets/brand"
mkdir -p "$ICONSET" "$BRAND"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
TARGET="$(uname -m)-apple-macosx14.0"
swiftc -target "$TARGET" -framework CoreText -framework CoreGraphics \
  "$ROOT/native/BananaMark.swift" "$ROOT/native/BananaBrandSVG.swift" "$ROOT/scripts/make-brand-assets.swift" \
  -o "$TMP/make-brand-assets"
"$TMP/make-brand-assets" "$ROOT"
swiftc -target "$TARGET" -framework AppKit \
  "$ROOT/native/BananaMark.swift" "$ROOT/native/BananaMarkRenderer.swift" "$ROOT/scripts/make-icon.swift" \
  -o "$TMP/make-icon"
"$TMP/make-icon" "$TMP/AppIcon-rendered.png"
sips -s dpiWidth 72 -s dpiHeight 72 -z 1024 1024 "$TMP/AppIcon-rendered.png" --out "$TMP/AppIcon.png" >/dev/null
cp "$TMP/AppIcon.png" "$ROOT/assets/AppIcon.png"
cp "$TMP/AppIcon.png" "$BRAND/app-icon-1024.png"
for size in 16 32 128 256 512; do
  sips -s dpiWidth 72 -s dpiHeight 72 -z "$size" "$size" "$TMP/AppIcon.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -s dpiWidth 72 -s dpiHeight 72 -z "$double" "$double" "$TMP/AppIcon.png" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$ROOT/assets/AppIcon.icns"
printf 'Generated app icons and assets/brand/*.svg from native/BananaMark.swift\n'
