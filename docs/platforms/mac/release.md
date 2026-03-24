---
summary: "ArgentOS macOS release checklist (Sparkle feed, packaging, signing)"
read_when:
  - Cutting or validating a ArgentOS macOS release
  - Updating the Sparkle appcast or feed assets
title: "macOS Release"
---

# ArgentOS macOS release (Sparkle)

This app now ships Sparkle auto-updates. Release builds must be Developer ID–signed, zipped, and published with a signed appcast entry.

## Prereqs

- Developer ID Application cert installed (example: `Developer ID Application: <Developer Name> (<TEAMID>)`).
- Sparkle private key path set in the environment as `SPARKLE_PRIVATE_KEY_FILE` (path to your Sparkle ed25519 private key; public key baked into Info.plist). If it is missing, check `~/.profile`.
- Notary credentials (keychain profile or API key) for `xcrun notarytool` if you want Gatekeeper-safe DMG/zip distribution.
  - We use a Keychain profile named `argent-notary`, created from App Store Connect API key env vars in your shell profile:
    - `APP_STORE_CONNECT_API_KEY_P8`, `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`
    - `echo "$APP_STORE_CONNECT_API_KEY_P8" | sed 's/\\n/\n/g' > /tmp/argent-notary.p8`
    - `xcrun notarytool store-credentials "argent-notary" --key /tmp/argent-notary.p8 --key-id "$APP_STORE_CONNECT_KEY_ID" --issuer "$APP_STORE_CONNECT_ISSUER_ID"`
- `pnpm` deps installed (`pnpm install --config.node-linker=hoisted`).
- Sparkle tools are fetched automatically via SwiftPM at `apps/macos/.build/artifacts/sparkle/Sparkle/bin/` (`sign_update`, `generate_appcast`, etc.).

## Build & package

Notes:

- `APP_BUILD` maps to `CFBundleVersion`/`sparkle:version`; keep it numeric + monotonic (no `-beta`), or Sparkle compares it as equal.
- Defaults to the current architecture (`$(uname -m)`). For release/universal builds, set `BUILD_ARCHS="arm64 x86_64"` (or `BUILD_ARCHS=all`).
- Use `scripts/package-standalone-app.sh` for release artifacts (zip + DMG + notarization). Use `scripts/package-mac-app.sh` for local/dev packaging.

```bash
# From repo root; set release IDs so Sparkle feed is enabled.
# APP_BUILD must be numeric + monotonic for Sparkle compare.
BUNDLE_ID=bot.molt.mac \
APP_VERSION=2026.2.4 \
APP_BUILD="$(git rev-list --count HEAD)" \
BUILD_CONFIG=release \
SIGN_IDENTITY="Developer ID Application: <Developer Name> (<TEAMID>)" \
scripts/package-mac-app.sh

# Zip for distribution (includes resource forks for Sparkle delta support)
ditto -c -k --sequesterRsrc --keepParent dist/ArgentOS.app dist/ArgentOS-2026.2.4.zip

# Optional: also build a styled DMG for humans (drag to /Applications)
scripts/create-dmg.sh dist/ArgentOS.app dist/ArgentOS-2026.2.4.dmg

# Recommended: build + notarize/staple zip + DMG
# First, create a keychain profile once:
#   xcrun notarytool store-credentials "argent-notary" \
#     --apple-id "<apple-id>" --team-id "<team-id>" --password "<app-specific-password>"
NOTARIZE=1 NOTARYTOOL_PROFILE=argent-notary \
BUNDLE_ID=bot.molt.mac \
APP_VERSION=2026.2.4 \
APP_BUILD="$(git rev-list --count HEAD)" \
BUILD_CONFIG=release \
SIGN_IDENTITY="Developer ID Application: <Developer Name> (<TEAMID>)" \
scripts/package-standalone-app.sh

# Optional: ship dSYM alongside the release
ditto -c -k --keepParent apps/macos/.build/release/ArgentOS.app.dSYM dist/ArgentOS-2026.2.4.dSYM.zip
```

## Argent Manager One-Command Release (recommended for second-Mac installs)

For the menu bar manager app (`dist/Argent.app`), use the release wrapper:

```bash
scripts/release-argent-manager.sh
```

This runs:

1. `scripts/package-argentos.sh` in release mode
2. Developer ID signing
3. notarization + stapling (using `NOTARYTOOL_PROFILE`, default `ArgentOS`)
4. final signature/notary verification
5. SHA256 + release manifest output in `dist/`

Artifacts:

- `dist/Argent-<version>.dmg`
- `dist/Argent-<version>.SHA256`
- `dist/Argent-<version>-release.txt`

If you need explicit overrides:

```bash
SIGN_IDENTITY="Developer ID Application: Jason Brashear (F2DH8T4BVH)" \
NOTARYTOOL_PROFILE="ArgentOS" \
APP_VERSION="2026.3.1" \
APP_BUILD="$(git rev-list --count HEAD)" \
scripts/release-argent-manager.sh
```

## Hosted installer artifact rail

For the public macOS shell installer, do not require Xcode on the user's machine.

Use the hosted artifact rail documented in [Hosted macOS Installer Artifacts](/platforms/mac/hosted-installer-artifacts):

1. build, sign, and notarize `Argent.app` on a controlled Mac
2. publish the `zip`, `dmg`, and manifest to R2
3. let `install.sh` download the `zip` and install `/Applications/Argent.app`

Release helper:

```bash
APP_VERSION="2026.3.2" \
R2_PUBLIC_BASE_URL="https://argentos.ai/releases/macos" \
scripts/publish-macos-release-to-r2.sh
```

## Appcast entry

Use the release note generator so Sparkle renders formatted HTML notes:

```bash
SPARKLE_PRIVATE_KEY_FILE=/path/to/ed25519-private-key scripts/make_appcast.sh dist/ArgentOS-2026.2.4.zip https://raw.githubusercontent.com/ArgentAIOS/argentos/main/appcast.xml
```

Generates HTML release notes from `CHANGELOG.md` (via [`scripts/changelog-to-html.sh`](https://github.com/ArgentAIOS/argentos/blob/main/scripts/changelog-to-html.sh)) and embeds them in the appcast entry.
Commit the updated `appcast.xml` alongside the release assets (zip + dSYM) when publishing.

## Publish & verify

- Upload `ArgentOS-2026.2.4.zip` (and `ArgentOS-2026.2.4.dSYM.zip`) to the GitHub release for tag `v2026.2.4`.
- Ensure the raw appcast URL matches the baked feed: `https://raw.githubusercontent.com/ArgentAIOS/argentos/main/appcast.xml`.
- Sanity checks:
  - `curl -I https://raw.githubusercontent.com/ArgentAIOS/argentos/main/appcast.xml` returns 200.
  - `curl -I <enclosure url>` returns 200 after assets upload.
  - On a previous public build, run “Check for Updates…” from the About tab and verify Sparkle installs the new build cleanly.

Definition of done: signed app + appcast are published, update flow works from an older installed version, and release assets are attached to the GitHub release.
