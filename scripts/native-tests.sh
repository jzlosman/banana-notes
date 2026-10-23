#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

TARGET="$(uname -m)-apple-macosx14.0"
JOBS="$(sysctl -n hw.ncpu)"
MODULE_DIR="$TMP/module"
LIB_DIR="$TMP/lib"
BIN_DIR="$TMP/bin"
COMPILE_LOGS="$TMP/compile-logs"
RUN_LOGS="$TMP/run-logs"
mkdir -p "$MODULE_DIR" "$LIB_DIR" "$BIN_DIR" "$COMPILE_LOGS" "$RUN_LOGS"

SOURCES=()
for source in "$ROOT"/native/*.swift; do
  [[ "$(basename "$source")" == "main.swift" ]] || SOURCES+=("$source")
done
TESTS=("$ROOT"/native/Tests/*SelfTest.swift)

# Build the app module once. Tests import this same module with @testable access.
swiftc -target "$TARGET" -Onone -gnone -enable-testing -parse-as-library \
  -module-name BananaNotesCore -emit-library -static -emit-module \
  -emit-module-path "$MODULE_DIR/BananaNotesCore.swiftmodule" \
  -framework AppKit -framework WebKit -framework Carbon -framework NaturalLanguage \
  "${SOURCES[@]}" -o "$LIB_DIR/libBananaNotesCore.a"

export TARGET MODULE_DIR LIB_DIR BIN_DIR COMPILE_LOGS RUN_LOGS
if ! printf '%s\0' "${TESTS[@]}" | xargs -0 -n 1 -P "$JOBS" bash -c '
  set -euo pipefail
  test="$1"
  name="$(basename "$test" .swift)"
  if swiftc -target "$TARGET" -Onone -gnone -parse-as-library -I "$MODULE_DIR" \
      -framework AppKit -framework WebKit -framework Carbon -framework NaturalLanguage \
      "$test" "$LIB_DIR/libBananaNotesCore.a" -o "$BIN_DIR/$name" \
      >"$COMPILE_LOGS/$name.log" 2>&1; then
    touch "$BIN_DIR/$name.compiled"
  else
    exit "$?"
  fi
' _; then
  compile_failed=0
  for test in "${TESTS[@]}"; do
    name="$(basename "$test" .swift)"
    if [[ ! -f "$BIN_DIR/$name.compiled" ]]; then
      compile_failed=1
      printf '\nNative self-test compile failed: %s\n' "$name" >&2
      cat "$COMPILE_LOGS/$name.log" >&2
    fi
  done
  (( compile_failed == 0 )) || exit 1
fi

if ! printf '%s\0' "${TESTS[@]}" | xargs -0 -n 1 -P "$JOBS" bash -c '
  set -euo pipefail
  test="$1"
  name="$(basename "$test" .swift)"
  if "$BIN_DIR/$name" >"$RUN_LOGS/$name.log" 2>&1; then
    touch "$RUN_LOGS/$name.passed"
  else
    exit "$?"
  fi
' _; then
  run_failed=0
  for test in "${TESTS[@]}"; do
    name="$(basename "$test" .swift)"
    if [[ ! -f "$RUN_LOGS/$name.passed" ]]; then
      run_failed=1
      printf '\nNative self-test failed: %s\n' "$name" >&2
      cat "$RUN_LOGS/$name.log" >&2
    fi
  done
  (( run_failed == 0 )) || exit 1
fi

# Keep the historical output order even though compilation and execution are parallel.
for test in "${TESTS[@]}"; do
  name="$(basename "$test" .swift)"
  cat "$RUN_LOGS/$name.log"
done
