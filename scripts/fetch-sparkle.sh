#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="2.10.0"
SHA256="c2bf58aa8387266ac179357b1415d6f2635f044da8be41042af32425dae6da0c"
URL="https://github.com/sparkle-project/Sparkle/releases/download/${VERSION}/Sparkle-${VERSION}.tar.xz"
CACHE="$ROOT/build/sparkle-${VERSION}"
ARCHIVE="$CACHE/Sparkle-${VERSION}.tar.xz"

mkdir -p "$CACHE"
if [[ -f "$ARCHIVE" ]] && ! printf '%s  %s\n' "$SHA256" "$ARCHIVE" | shasum -a 256 -c - >/dev/null 2>&1; then
  rm -f "$ARCHIVE"
fi
if [[ ! -f "$ARCHIVE" ]]; then
  echo "Downloading pinned Sparkle ${VERSION} archive..." >&2
  curl --fail --location --silent --show-error --retry 3 "$URL" --output "$ARCHIVE"
fi
printf '%s  %s\n' "$SHA256" "$ARCHIVE" | shasum -a 256 -c - >&2

if [[ ! -d "$CACHE/Sparkle.framework" || ! -x "$CACHE/bin/sign_update" || ! -x "$CACHE/bin/generate_appcast" ]]; then
  rm -rf "$CACHE/Sparkle.framework" "$CACHE/bin"
  mkdir -p "$CACHE"
  tar -xf "$ARCHIVE" -C "$CACHE" ./Sparkle.framework ./bin/sign_update ./bin/generate_appcast ./bin/generate_keys
fi
printf '%s\n' "$CACHE"
