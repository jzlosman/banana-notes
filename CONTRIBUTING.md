# Contributing

Issues and pull requests are welcome. Keep changes focused and describe the behavior you are changing. Only the repository owner merges changes to `main`; pull requests must pass CI. Force pushes, direct pushes, and deletion of `main` are blocked.

## Development

Use macOS 14 or later, Xcode command-line tools, and Node.js 22 or later.

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
bash scripts/native-tests.sh
npm run build
```

Create a feature branch and open a pull request against `main`. Include meaningful tests and, for interface changes, screenshots using synthetic notes. The browser preview is available with `npm run dev` after building the web assets.

To test the native UI without touching your notes or preferences, create an isolated bundle:

```sh
PROFILE="$(bash scripts/prepare-verification-profile.sh)"
FOLDNOTE_DATA_DIR="$PROFILE/data" \
  "$PROFILE/Foldnote Verification.app/Contents/MacOS/Foldnote"
```

Quit the verification app before removing its temporary directory. It has a separate bundle identity and synthetic notes; do not substitute your personal library.

## Design and safety

- Keep note rules deterministic and independent of AppKit, WebKit, storage, and network adapters. Separate read models from state-changing commands.
- Markdown is authoritative. Preferences, attachments, fonts, and search indexes are separate from note content.
- Keep the single-window interface compact. Infrequent actions belong in menus or settings.
- Network requests, downloads, OCR, startup registration, and local model startup must remain explicit and optional.
- Test destructive operations with synthetic data. Never include personal notes, credentials, local research, planning artifacts, generated app bundles, or test recordings in a contribution.
- Preserve third-party license notices. User-downloaded fonts and models are governed by their respective licenses; do not add them to the repository.

By contributing, you agree that your contributions are licensed under the repository's MIT license. Respectful, constructive communication is expected.
