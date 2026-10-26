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

Create a feature branch and open a pull request against `main`. Include meaningful tests and, for interface changes, screenshots using synthetic notes. The browser preview is available with `npm run dev` after building the web assets. For the static Pages site, run `npm run site:dev` and `cd site && python3 -m http.server 4321` in separate terminals; run `npm run site:build` for a production stylesheet.

To test the native UI without touching your notes or preferences, create an isolated bundle:

```sh
PROFILE="$(bash scripts/prepare-verification-profile.sh)"
BANANA_NOTES_DATA_DIR="$PROFILE/data" \
  "$PROFILE/Banana Notes Verification.app/Contents/MacOS/Banana Notes"
```

Quit the verification app before removing its temporary directory. It has a separate bundle identity and synthetic notes. Its bundle also requires a binding to that profile’s sibling `data/` directory, so reopening through LaunchServices cannot fall back to personal notes when an environment variable is absent. Never substitute your personal library.

## Architecture

For the task-item caret’s local WebKit matrix, install the browser once with `npx playwright install webkit`, then run `npm run test:task-caret-webkit`. It uses synthetic browser-preview notes and is kept separate from the default test suite because it requires a separate WebKit browser installation and launches that browser.

The web app separates deterministic rules in `web/src/domain/`, use cases and ports in `web/src/application/`, effect adapters in `web/src/adapters/`, and interface code in `web/src/ui/`; `web/src/main.ts` composes the capabilities, and `web/tests/architecture.test.ts` checks the dependency boundaries.

On macOS, `AppDelegate.swift` handles lifecycle callbacks and `NativeApplicationRuntime.swift` composes the window, hotkey, bridge, menu, and termination services. `BridgeCommandDecoder` turns wire actions into typed `BridgeCommand` values; `BridgeRouter` dispatches each to a capability handler. `NativePorts.swift` defines effect ports, while framework-independent policy code is checked by `ArchitectureSelfTest`.

Dependencies point inward: domain and application rules depend on contracts, while UI and adapters depend on those inner boundaries. To add a native capability, add its wire action and typed `BridgeCommand` case, implement and register a handler, then expose a web capability port and adapter.

## Design and safety

- Keep note rules deterministic and independent of AppKit, WebKit, storage, and network adapters. Separate read models from state-changing commands.
- Markdown is authoritative. Preferences, attachments, fonts, and search indexes are separate from note content.
- Keep the single-window interface compact. Infrequent actions belong in menus or settings.
- Network requests, downloads, OCR, startup registration, and local model startup must remain explicit and optional.
- Test destructive operations with synthetic data. Never include personal notes, credentials, local research, planning artifacts, generated app bundles, or test recordings in a contribution.
- Preserve the legacy bundle ID, storage directory, managed media/font URL schemes, and preference keys when changing branding; existing notes and settings must continue to load. Public app links support both `banananotes://` and `foldnote://`.
- Preserve third-party license notices. User-downloaded fonts and models are governed by their respective licenses; do not add them to the repository.

By contributing, you agree that your contributions are licensed under the repository's MIT license. Respectful, constructive communication is expected.
