#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if (( $# > 1 )); then
  echo "usage: build-icons.sh [notes|viewer]" >&2
  exit 2
fi
PRODUCT="${1:-notes}"
case "$PRODUCT" in
  notes)
    BRAND="$ROOT/assets/brand"
    ICONSET="$ROOT/assets/AppIcon.iconset"
    ICON="$BRAND/app-icon-1024.png"
    ICNS="$ROOT/assets/AppIcon.icns"
    ;;
  viewer)
    BRAND="$ROOT/assets/viewer-brand"
    ICONSET="$BRAND/AppIcon.iconset"
    ICON="$BRAND/app-icon-1024.png"
    ICNS="$BRAND/AppIcon.icns"
    ;;
  *)
    echo "product must be notes or viewer" >&2
    exit 2
    ;;
esac
mkdir -p "$ICONSET" "$BRAND"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
TARGET="$(uname -m)-apple-macosx14.0"
swiftc -target "$TARGET" -framework CoreText -framework CoreGraphics \
  "$ROOT/native/BananaMark.swift" "$ROOT/native/BananaBrandSVG.swift" "$ROOT/scripts/make-brand-assets.swift" \
  -o "$TMP/make-brand-assets"
"$TMP/make-brand-assets" "$ROOT" "$PRODUCT"
swiftc -target "$TARGET" -framework AppKit \
  "$ROOT/native/BananaMark.swift" "$ROOT/native/BananaMarkRenderer.swift" "$ROOT/scripts/make-icon.swift" \
  -o "$TMP/make-icon"
"$TMP/make-icon" "$TMP/AppIcon-rendered.png" "$PRODUCT"
sips -s dpiWidth 72 -s dpiHeight 72 -z 1024 1024 "$TMP/AppIcon-rendered.png" --out "$TMP/AppIcon.png" >/dev/null
cp "$TMP/AppIcon.png" "$ICON"
if [[ "$PRODUCT" == "notes" ]]; then
  cp "$TMP/AppIcon.png" "$ROOT/assets/AppIcon.png"
fi
for size in 16 32 128 256 512; do
  sips -s dpiWidth 72 -s dpiHeight 72 -z "$size" "$TMP/AppIcon.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -s dpiWidth 72 -s dpiHeight 72 -z "$double" "$TMP/AppIcon.png" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$ICNS"
if [[ "$PRODUCT" == "notes" ]]; then
  printf 'Generated Banana Notes app icons and assets/brand/*.svg from native/BananaMark.swift\n'
else
  printf 'Generated Banana Viewer app icons and assets/viewer-brand/*.svg from native/BananaMark.swift\n'
fi
