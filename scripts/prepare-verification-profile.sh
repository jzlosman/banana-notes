#!/bin/bash
# Copy a built app into a private bundle/data/preferences identity. Never opens real notes.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE="$(mktemp -d /tmp/banana-notes-verification.XXXXXX)"
APP="$PROFILE/Banana Notes Verification.app"
cp -R "$ROOT/build/Banana Notes.app" "$APP"
ID="com.jzlosman.banana-notes.verification.$(uuidgen | tr '[:upper:]' '[:lower:]')"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $ID" "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :BananaNotesVerificationDataDirectory string $PROFILE/data" "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Delete :CFBundleURLTypes' "$APP/Contents/Info.plist"
codesign --force --deep --sign - "$APP" >&2
codesign --verify --deep --strict "$APP" >&2
mkdir -p "$PROFILE/data"
python3 - "$PROFILE" "$ID" <<'PY'
import json,sys,pathlib
root=pathlib.Path(sys.argv[1]);notes=[]
for i in range(5):
    day=10+i
    notes.append({'id':f'project-{i}','createdAt':f'2026-10-{day:02}T12:00:00.000Z','updatedAt':f'2026-10-{day:02}T12:00:00.000Z','markdown':f'---\ntags: [launch, work]\n---\n# Project note {i+1}\n\n- [ ] Shared task {i+1}\n- [x] Finished task {i+1}\n\n[Reference](https://example.com/docs/{i+1})\n\n```typescript\nconst task = {{ done: false, label: "Local only" }};\n```\n'})
notes.append({'id':'old','createdAt':'2026-01-01T12:00:00.000Z','updatedAt':'2026-01-01T12:00:00.000Z','markdown':'# An old thought\n\nA synthetic note for safe bulk actions. #tidy'})
notes.append({'id':'archive','createdAt':'2026-01-02T12:00:00.000Z','updatedAt':'2026-01-02T12:00:00.000Z','markdown':'---\ntags: [archive, work]\n---\n# Archived reference\n\nThis synthetic note appears only when archive is selected.'})
(root/'data/library.json').write_text(json.dumps({'version':1,'notes':notes,'selectedID':'project-0','activeTag':None}))
(root/'profile.json').write_text(json.dumps({'root':str(root),'bundleID':sys.argv[2],'app':str(root/'Banana Notes Verification.app'),'dataDirectory':str(root/'data')},indent=2))
print(root)
PY
