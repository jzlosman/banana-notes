# Releasing Banana Notes

## One-time setup

### Developer ID signing certificate

In Keychain Access, select the **Developer ID Application** certificate together with its private key, then export both as a password-protected `.p12`. Keep the export outside the repository. The workflow imports it into a temporary keychain and removes that keychain after the job.

From the repository root, set the encoded certificate as a GitHub Actions secret:

```sh
gh secret set MACOS_CERTIFICATE_P12_BASE64 < <(base64 -i "$P12_PATH")
```

Set the P12 password and Apple Team ID without putting either value in shell history:

```sh
read -s -p 'P12 password: ' value; printf '\n'; printf '%s' "$value" | gh secret set MACOS_CERTIFICATE_PASSWORD; unset value
read -s -p 'Apple Team ID: ' value; printf '\n'; printf '%s' "$value" | gh secret set APPLE_TEAM_ID; unset value
```

### App Store Connect notarization key

In App Store Connect, create an API key under **Users and Access → Integrations → App Store Connect API** with access suitable for notarization. Keep the downloaded `.p8` file private. Set the key and its identifiers:

```sh
gh secret set APP_STORE_CONNECT_KEY_P8_BASE64 < <(base64 -i "$ASC_KEY_PATH")
read -s -p 'App Store Connect key ID: ' value; printf '\n'; printf '%s' "$value" | gh secret set APP_STORE_CONNECT_KEY_ID; unset value
read -s -p 'App Store Connect issuer ID: ' value; printf '\n'; printf '%s' "$value" | gh secret set APP_STORE_CONNECT_ISSUER_ID; unset value
```

These are the GitHub Actions secrets used for signing and notarization:

- `MACOS_CERTIFICATE_P12_BASE64`
- `MACOS_CERTIFICATE_PASSWORD`
- `APPLE_TEAM_ID`
- `APP_STORE_CONNECT_KEY_P8_BASE64`
- `APP_STORE_CONNECT_KEY_ID`
- `APP_STORE_CONNECT_ISSUER_ID`
- `SPARKLE_PRIVATE_KEY` (set after generating the Sparkle key below)

For local packaging, `scripts/package-release.sh` also accepts either `NOTARY_KEY_PATH`, `NOTARY_KEY_ID`, `NOTARY_ISSUER` or a `NOTARY_PROFILE` created with `xcrun notarytool store-credentials`.

### Sparkle signing key

Sparkle is pinned in `scripts/fetch-sparkle.sh`. Fetch that verified release and create the EdDSA key in the login keychain:

```sh
SPARKLE_DIR="$(bash scripts/fetch-sparkle.sh)"
"$SPARKLE_DIR/bin/generate_keys"
```

Copy the printed public key value to the repository **variable** (it is not secret):

```sh
gh variable set SPARKLE_PUBLIC_KEY --body 'PUBLIC_KEY_FROM_GENERATE_KEYS'
```

Export the matching private key to a protected temporary file and pipe it directly to GitHub Secrets. Do not print it, commit it, or leave it in the repository:

```sh
SPARKLE_PRIVATE_KEY_FILE="$(mktemp)"
chmod 600 "$SPARKLE_PRIVATE_KEY_FILE"
"$SPARKLE_DIR/bin/generate_keys" -x "$SPARKLE_PRIVATE_KEY_FILE"
gh secret set SPARKLE_PRIVATE_KEY < "$SPARKLE_PRIVATE_KEY_FILE"
rm -f "$SPARKLE_PRIVATE_KEY_FILE"
unset SPARKLE_PRIVATE_KEY_FILE
```

## Release steps

1. Bump the version in `package.json` and the root package entry in `package-lock.json`. Run the normal typecheck and tests, then commit the change to `main`.
2. From the updated `main`, create and push an annotated version tag that exactly matches the package version, for example:

   ```sh
   git tag -a v0.2.0 -m 'Banana Notes 0.2.0'
   git push origin v0.2.0
   ```

3. The `Signed Release` workflow runs typecheck, web tests, native tests and the universal build. It imports the Developer ID certificate into a temporary keychain, signs and notarizes the app and DMG, staples and verifies the tickets, signs the Sparkle update, generates `appcast.xml`, and creates a **draft** GitHub release with the DMG, ZIP, appcast, and `SHA256SUMS`. A tag must match `package.json`; the workflow does not publish the draft.
4. Review the workflow logs, DMG/ZIP, notarization and stapler checks, appcast URL/signature, and checksums in the draft. Publish the draft manually when ready. Do not edit a signed release asset after checksumming it.

Running the workflow manually with **workflow_dispatch** is a dry run: it runs checks and builds but skips notarization, release-asset upload, and draft creation.

## Homebrew cask

After approving a release, update `packaging/homebrew/banana-notes.rb` (or a future tap copy): set `version` to the release version and replace the SHA placeholder with the DMG hash from `SHA256SUMS`. The URL derives the tag and filename from `version`. This repository does not publish a tap.

## Uninstalling and keeping data

Removing `Banana Notes.app` does not remove notes or preferences. Notes and attachments remain under `~/Library/Application Support/Foldnote`; the folder intentionally keeps its old name for compatibility. Preferences remain under `~/Library/Preferences/dev.local.foldnote.plist`. Back up or export notes before deleting these paths. The Homebrew cask's `zap` stanza removes both the Foldnote data folder and preferences, so use `brew uninstall --zap banana-notes` only when you intend to erase that data.
