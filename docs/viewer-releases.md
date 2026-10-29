# Banana Viewer releases

Banana Viewer has its own version source, release tags, assets, and draft releases. It shares this repository and the Developer ID/notarization credentials with Banana Notes, but it does not use the Notes package version or update feed.

## Release a version

1. Set `viewer/version.txt` to the intended Viewer version and merge that change. Do not change `package.json` just to release Viewer.
2. From the release commit, create and push a matching tag, for example `viewer-v0.1.1` for `viewer/version.txt` value `0.1.1`:

   ```sh
   git tag viewer-v0.1.1
   git push origin viewer-v0.1.1
   ```

3. The **Banana Viewer Release** workflow validates the tag against `viewer/version.txt`, runs the repository and Viewer tests, builds the universal app, signs it with Developer ID hardened runtime, notarizes it, and creates a draft GitHub release. A manual workflow dispatch only verifies and builds; it does not sign, notarize, or create a release.
4. Review the draft's app and checksum assets, then publish it without making it the repository's latest release:

   ```sh
   gh release edit viewer-v0.1.1 --draft=false --latest=false
   ```

Viewer assets are named `Banana-Viewer-<version>.dmg`, `Banana-Viewer-<version>.zip`, and `SHA256SUMS`, under `build/viewer-release` during the workflow. The separate Notes workflow accepts only `v` followed by a numeric version, and Viewer releases must not include or replace Notes' `appcast.xml`. Banana Notes' Sparkle updater continues to use the repository's latest release.

To inspect a release locally, run `npm run build:web`, `npm run test:viewer:native`, and `bash scripts/build-viewer.sh`. Local builds remain ad-hoc signed. The shared packaging script's default product is Banana Notes; its explicit Viewer form is `bash scripts/package-release.sh viewer` and requires a signed hardened app plus notarization credentials.
