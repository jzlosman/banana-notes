#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-deterministic}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

TARGET="$(uname -m)-apple-macosx14.0"
MODULE_DIR="$TMP/module"
LIB_DIR="$TMP/lib"
BIN_DIR="$TMP/bin"
mkdir -p "$MODULE_DIR" "$LIB_DIR" "$BIN_DIR"

check_dependency_boundary() {
  local forbidden='LibraryStore|LibraryDocument|PreferenceMigration|NativeApplicationRuntime|NotePanelController|NativeFeatures|banananotes://|foldnote://'
  if grep -nE "$forbidden" "$ROOT"/viewer/native/*.swift; then
    echo "Banana Viewer native sources must not depend on Banana Notes runtime or deep links." >&2
    exit 1
  fi
  echo "Viewer dependency boundary passed."
}

check_info_plist_contract() {
  local plist="$ROOT/viewer/Info.plist"
  local value
  value="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist")"
  [[ "$value" == "com.jzlosman.banana-viewer" ]] || { echo "Unexpected viewer bundle identity: $value" >&2; exit 1; }
  [[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleDocumentTypes:0:LSItemContentTypes:0' "$plist")" == "net.daringfireball.markdown" ]] || {
    echo "Viewer must register the established net.daringfireball.markdown UTI." >&2; exit 1;
  }
  [[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleDocumentTypes:0:CFBundleTypeRole' "$plist")" == "Viewer" ]] || {
    echo "Viewer document role must be Viewer." >&2; exit 1;
  }
  [[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleDocumentTypes:0:LSHandlerRank' "$plist")" == "Alternate" ]] || {
    echo "Viewer document rank must be Alternate." >&2; exit 1;
  }
  [[ "$(/usr/libexec/PlistBuddy -c 'Print :UTImportedTypeDeclarations:0:UTTypeIdentifier' "$plist")" == "net.daringfireball.markdown" ]] || {
    echo "Viewer must import the established Markdown UTI." >&2; exit 1;
  }
  local expected_extensions=(md markdown mdown mkd)
  for index in 0 1 2 3; do
    local extension document_extension
    extension="$(/usr/libexec/PlistBuddy -c "Print :UTImportedTypeDeclarations:0:UTTypeTagSpecification:public.filename-extension:$index" "$plist")"
    document_extension="$(/usr/libexec/PlistBuddy -c "Print :CFBundleDocumentTypes:0:CFBundleTypeExtensions:$index" "$plist")"
    [[ "$extension" == "${expected_extensions[$index]}" && "$document_extension" == "${expected_extensions[$index]}" ]] || {
      echo "Unexpected registered Markdown extension: $extension / $document_extension" >&2; exit 1;
    }
  done
  if /usr/libexec/PlistBuddy -c 'Print :CFBundleURLTypes' "$plist" >/dev/null 2>&1; then
    echo "Banana Viewer must not claim Banana Notes URL schemes." >&2
    exit 1
  fi
  if /usr/libexec/PlistBuddy -c 'Print :LSUIElement' "$plist" >/dev/null 2>&1; then
    echo "Banana Viewer must be a regular Dock app, not an LSUIElement." >&2
    exit 1
  fi
  echo "Viewer bundle and Finder document-type contract passed."
}

build_module() {
  local kind="$1"
  local output="$2"
  shift 2
  local -a sources=("$@")
  local -a frameworks=()
  if [[ "$kind" == "app" ]]; then
    frameworks=(-framework AppKit -framework WebKit -framework UniformTypeIdentifiers)
  fi
  swiftc -swift-version 5 -target "$TARGET" -Onone -gnone -enable-testing -parse-as-library \
    -module-name BananaViewerCore -emit-library -static -emit-module \
    -emit-module-path "$MODULE_DIR/BananaViewerCore.swiftmodule" \
    "${frameworks[@]}" "${sources[@]}" -o "$output"
}

if [[ "$MODE" == "deterministic" ]]; then
  check_dependency_boundary
  check_info_plist_contract
  CORE_SOURCES=(
    "$ROOT/viewer/native/ViewerModel.swift"
    "$ROOT/viewer/native/ViewerDocumentReader.swift"
    "$ROOT/viewer/native/ViewerDocumentWriter.swift"
    "$ROOT/viewer/native/ViewerPolicies.swift"
    "$ROOT/viewer/native/ViewerRasterResourceReader.swift"
    "$ROOT/viewer/native/ViewerPreferencesStore.swift"
  )
  build_module core "$LIB_DIR/libBananaViewerCore.a" "${CORE_SOURCES[@]}"
  swiftc -swift-version 5 -target "$TARGET" -Onone -gnone -parse-as-library \
    -I "$MODULE_DIR" "$ROOT/viewer/native-tests/ViewerCoreSelfTest.swift" \
    "$LIB_DIR/libBananaViewerCore.a" -o "$BIN_DIR/ViewerCoreSelfTest"
  "$BIN_DIR/ViewerCoreSelfTest"
  exit 0
fi

if [[ "$MODE" != "--webkit-smoke" ]]; then
  echo "Usage: scripts/viewer-native-tests.sh [deterministic|--webkit-smoke [Banana Viewer.app]]" >&2
  exit 2
fi

APP="${2:-$ROOT/build/Banana Viewer.app}"
if [[ ! -d "$APP/Contents/Resources/web" ]]; then
  if [[ -n "${2:-}" ]]; then
    echo "The supplied app has no bundled web assets: $APP" >&2
    exit 1
  fi
  bash "$ROOT/scripts/build-viewer.sh"
fi
WEB_DIR="$APP/Contents/Resources/web"
if [[ ! -d "$WEB_DIR" ]]; then
  echo "Viewer app assets are unavailable at $WEB_DIR. Build web viewer assets, then rerun this smoke test." >&2
  exit 1
fi

check_dependency_boundary
check_info_plist_contract
APP_SOURCES=()
for source in "$ROOT"/viewer/native/*.swift; do
  [[ "$(basename "$source")" == "main.swift" ]] || APP_SOURCES+=("$source")
done
build_module app "$LIB_DIR/libBananaViewerCore.a" "${APP_SOURCES[@]}"
swiftc -swift-version 5 -target "$TARGET" -Onone -gnone -parse-as-library \
  -I "$MODULE_DIR" -framework AppKit -framework WebKit -framework UniformTypeIdentifiers \
  "$ROOT/viewer/native-tests/ViewerWebKitSmokeTest.swift" \
  "$LIB_DIR/libBananaViewerCore.a" -o "$BIN_DIR/ViewerWebKitSmokeTest"
mkdir -p "$TMP/home"
HOME="$TMP/home" "$BIN_DIR/ViewerWebKitSmokeTest" "$WEB_DIR"
