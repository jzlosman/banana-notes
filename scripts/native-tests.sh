#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
SOURCES=()
for source in "$ROOT"/native/*.swift; do
  [[ "$(basename "$source")" == "main.swift" ]] || SOURCES+=("$source")
done
for test in "$ROOT"/native/Tests/*SelfTest.swift; do
  name="$(basename "$test" .swift)"
  swiftc -target "$(uname -m)-apple-macosx14.0" -framework AppKit -framework WebKit -framework Carbon -framework NaturalLanguage \
    "${SOURCES[@]}" "$test" -o "$TMP/$name"
  "$TMP/$name"
done
