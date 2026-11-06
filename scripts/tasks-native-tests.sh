#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-deterministic}"
TARGET="$(uname -m)-apple-macosx14.0"

if [[ "$MODE" != "deterministic" && "$MODE" != "--webkit-smoke" ]]; then
  echo "Usage: scripts/tasks-native-tests.sh [deterministic|--webkit-smoke [web-directory]]" >&2
  exit 2
fi
if [[ "$MODE" == "deterministic" && $# -gt 1 ]] || [[ "$MODE" == "--webkit-smoke" && $# -gt 2 ]]; then
  echo "Usage: scripts/tasks-native-tests.sh [deterministic|--webkit-smoke [web-directory]]" >&2
  exit 2
fi

WEB_DIR="${2:-$ROOT/web/dist}"
if [[ "$MODE" == "--webkit-smoke" ]]; then
  for asset in tasks.js tasks.html tasks.css app.css theme-catalog.json fonts/manifest.js; do
    if [[ ! -f "$WEB_DIR/$asset" ]]; then
      echo "Tasks WebKit smoke requires the built asset $WEB_DIR/$asset. Build the Tasks web assets, then rerun this test." >&2
      exit 1
    fi
  done
  if ! compgen -G "$WEB_DIR/fonts/*.woff2" >/dev/null; then
    echo "Tasks WebKit smoke requires at least one built WOFF2 font in $WEB_DIR/fonts." >&2
    exit 1
  fi
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
BIN_DIR="$TMP/bin"
mkdir -p "$BIN_DIR"

check_dependency_boundary() {
  local forbidden='NativeApplicationRuntime|LibraryStore|LibraryDocument|NotePanelController|ViewerApplicationRuntime|ViewerWindowController|banana-notes://|banana-viewer://'
  if grep -nE "$forbidden" "$ROOT"/tasks/native/*.swift; then
    echo "Banana Tasks native sources must not depend on Notes or Viewer runtimes." >&2
    exit 1
  fi
  echo "Tasks dependency boundary passed."
}

check_bundle_contract() {
  local plist="$ROOT/tasks/Info.plist"
  [[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist")" == "com.jzlosman.banana-tasks" ]] || {
    echo "Unexpected Banana Tasks bundle identity." >&2; exit 1;
  }
  [[ "$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$plist")" == "14.0" ]] || {
    echo "Banana Tasks must target macOS 14 or later." >&2; exit 1;
  }
  [[ "$(/usr/libexec/PlistBuddy -c 'Print :LSUIElement' "$plist")" == "true" ]] || {
    echo "Banana Tasks must use accessory activation policy." >&2; exit 1;
  }
  /usr/libexec/PlistBuddy -c 'Print :NSCalendarsFullAccessUsageDescription' "$plist" >/dev/null
  /usr/libexec/PlistBuddy -c 'Print :NSCalendarsUsageDescription' "$plist" >/dev/null
  echo "Tasks bundle and permission contract passed."
}

check_dependency_boundary
check_bundle_contract
CORE_SOURCES=(
  "$ROOT/tasks/native/TasksContracts.swift"
  "$ROOT/tasks/native/TasksStorage.swift"
  "$ROOT/tasks/native/TodoistAdapter.swift"
  "$ROOT/tasks/native/CalendarAdapter.swift"
  "$ROOT/tasks/native/TasksApplication.swift"
  "$ROOT/tasks/native/TasksVerificationAdapters.swift"
  "$ROOT/tasks/native/TasksBridge.swift"
)
swiftc -swift-version 5 -target "$TARGET" -Onone -gnone -parse-as-library \
  -module-name BananaTasksCore -framework AppKit -framework WebKit -framework EventKit -framework Security \
  "${CORE_SOURCES[@]}" "$ROOT/tasks/native-tests/TasksCoreSelfTest.swift" -o "$BIN_DIR/TasksCoreSelfTest"
"$BIN_DIR/TasksCoreSelfTest"

if [[ "$MODE" == "--webkit-smoke" ]]; then
  APP_SOURCES=(
    "$ROOT/tasks/native/TasksContracts.swift"
    "$ROOT/tasks/native/TasksStorage.swift"
    "$ROOT/tasks/native/TasksApplication.swift"
    "$ROOT/tasks/native/TasksVerificationAdapters.swift"
    "$ROOT/tasks/native/TasksBridge.swift"
    "$ROOT/tasks/native/TasksWindowController.swift"
  )
  swiftc -swift-version 5 -target "$TARGET" -Onone -gnone -parse-as-library \
    -module-name TasksWebKitSmoke -framework AppKit -framework WebKit -framework EventKit -framework Security \
    "${APP_SOURCES[@]}" "$ROOT/tasks/native-tests/TasksWebKitSelfTest.swift" -o "$BIN_DIR/TasksWebKitSelfTest"
  mkdir -p "$TMP/home"
  HOME="$TMP/home" "$BIN_DIR/TasksWebKitSelfTest" "$WEB_DIR"
fi
