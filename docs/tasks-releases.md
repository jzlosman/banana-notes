# Banana Tasks releases

Banana Tasks has its own version, release tags, installers, and draft releases. It shares this repository's approved Developer ID/notarization setup, not the Banana Notes download or Sparkle update feed. Needle and other model runtimes are not included.

## Prepare a release

1. Set `tasks/version.txt` to the intended Tasks version. Do not change `package.json` to release Tasks.
2. Complete the pull request checks and merge through the repository's owner-only merge policy.
3. With explicit release authorization, tag the approved commit using the exact source version, for example:

   ```sh
   git tag tasks-v0.1.0
   git push origin tasks-v0.1.0
   ```

The **Banana Tasks Release** workflow rejects a tag that does not match `tasks/version.txt` or points to a commit outside `main`. It runs the repository tests, Tasks native checks, and actual bundled WebKit smoke with synthetic data and denied integration capabilities. It builds a universal macOS 14+ app, signs with Developer ID hardened runtime, notarizes and staples the app and disk image, and creates a **draft**, not a published release.

The release stays unsandboxed, so existing task-data paths do not migrate into an App Sandbox container. Its hardened-runtime entitlements include only Calendar resource access; [Apple requires that entitlement for hardened-runtime Calendar use](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.personal-information.calendars). The entitlement does not grant user consent: Calendar access still requires the explicit in-app request and macOS permission. No runtime-debugging exceptions are enabled.

Manual workflow dispatch is verification-only: it does not import signing credentials, notarize, or create a release. Dispatching workflows, creating release tags, and publishing drafts are separate maintainer actions, not part of preparing a pull request.

The tag workflow uses the existing repository signing/notarization secret names: `MACOS_CERTIFICATE_P12_BASE64`, `MACOS_CERTIFICATE_PASSWORD`, `APPLE_TEAM_ID`, `APP_STORE_CONNECT_KEY_P8_BASE64`, `APP_STORE_CONNECT_KEY_ID`, and `APP_STORE_CONNECT_ISSUER_ID`. Missing credentials fail closed. Never place their values in source, screenshots, logs, or task data.

## Review the release candidate

Before publishing:

- Check the workflow result and the draft's version, bundle identity, universal architectures, Developer ID signature, notarization ticket, and `SHA256SUMS`.
- Install the actual downloaded artifact on a clean test profile. Check Gatekeeper/first launch, capture/save/quit/reopen, shortcut registration/conflicts, pin/hide behavior, reduced motion, and timer behavior across sleep/wake. Use synthetic data, not a personal task library.
- Exercise backup restoration and an upgrade from a previous synthetic version-1 profile. Confirm task identity, capture age, effort/history, timer intent, integration source IDs/outbox operation IDs, preferences, and custom shortcut survive. Do not force-quit over an outstanding save failure.
- Todoist and Calendar are optional integrations. Automated checks use substitute ports and do not establish live-account interoperability or signed-build permission behavior. Test those separately only with an explicitly authorized dedicated capture project/test calendar and credentials; never substitute personal tasks or appointments. Local task use does not depend on either integration.

Artifacts are `Banana-Tasks-<version>.dmg`, `Banana-Tasks-<version>.zip`, and `SHA256SUMS`. The workflow stages them under `build/tasks-release`. The shared packaging entry point is `bash scripts/package-release.sh tasks`; it rejects an ad-hoc app and requires approved signing/notarization credentials. Ordinary `npm run build:tasks` remains an ad-hoc local development build unless a signing identity is deliberately supplied.

With explicit publication authorization, publish the reviewed draft **without making it this repository's latest release**:

```sh
gh release edit tasks-v0.1.0 --draft=false --latest=false
```

Keep Tasks releases separate from Notes/Viewer assets. Do not attach or replace `appcast.xml`: Banana Notes uses the repository's latest release for its updater.

## Install and update

Tasks v1 uses manual updates, not an automatic updater. After a Tasks release has been published, choose the release tagged `tasks-v…` on [GitHub Releases](https://github.com/jzlosman/banana-notes/releases), verify its checksums, open its DMG, and drag **Banana Tasks.app** into Applications. Banana Notes and Viewer need not be installed.

For an update, quit the old Tasks copy normally and wait for saving to finish. If saving fails, keep the app open and use its retry/copy controls before continuing. Back up the Tasks data folder, then replace the application in Applications. Do not keep two running/installed copies with the same bundle identity. Replacing the app does not require deleting task data, preferences, or Keychain items.

The bundle identity remains `com.jzlosman.banana-tasks`; task data remains under `~/Library/Application Support/Banana Tasks/`. Appearance preferences and the configured shortcut stay independent of Notes/Viewer. A change from an ad-hoc development build to a Developer ID build may require macOS to approve access to an existing Keychain item; do not reset credentials automatically.

The current document format is version 1. Startup does not migrate or rewrite compatible data just because the app version changed. A future/unsupported document version must remain untouched: reinstall a compatible newer app rather than restoring an older-format backup or resetting the store. Any future schema change must add explicit migration and upgrade/rollback regression coverage before release.
