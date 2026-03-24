---
summary: "Hosted macOS installer artifact flow (build, R2 publish, manifest, website sync)"
read_when:
  - Wiring the public macOS installer
  - Publishing signed/notarized Argent.app artifacts
  - Updating install.sh to use prebuilt app downloads
title: "Hosted macOS Installer Artifacts"
---

# Hosted macOS installer artifacts

The public macOS installer should not build Swift from source on the end-user's machine.

Use this rail instead:

1. Build `Argent.app` on a controlled Mac
2. Sign with Developer ID
3. Notarize and staple the app + DMG
4. Publish the `zip` and `dmg` to Cloudflare R2
5. Publish a small JSON release manifest
6. Let `install.sh` download the `zip`, verify SHA-256, install `/Applications/Argent.app`, and open it

## Why

This removes Xcode and Swift toolchain requirements from the public install path and avoids machine-specific SwiftPM and macro plugin failures on user Macs.

## Artifacts

The release build produces:

- `dist/Argent.app`
- `dist/Argent-<version>.zip`
- `dist/Argent-<version>.dmg`
- `dist/Argent-<version>.dSYM.zip`

Use:

- `zip` for automated `install.sh`
- `dmg` for website and manual download
- `dSYM.zip` for crash and debug use only

## Build on the controlled Mac

```bash
SIGN_IDENTITY="Developer ID Application: Jason Brashear (F2DH8T4BVH)" \
NOTARYTOOL_PROFILE="ArgentOS" \
BUNDLE_ID="ai.argent.mac" \
BUILD_CONFIG=release \
scripts/package-standalone-app.sh
```

This produces a signed and notarized `Argent.app`, `zip`, and `dmg`.

## R2 layout

Recommended object layout:

- `releases/macos/latest.json`
- `releases/macos/<version>.json`
- `releases/macos/<version>/Argent-<version>.zip`
- `releases/macos/<version>/Argent-<version>.dmg`
- `releases/macos/<version>/Argent-<version>.dSYM.zip`

Example:

- `releases/macos/latest.json`
- `releases/macos/2026.3.2.json`
- `releases/macos/2026.3.2/Argent-2026.3.2.zip`
- `releases/macos/2026.3.2/Argent-2026.3.2.dmg`

## Generate the release manifest

```bash
node --import tsx scripts/write-macos-release-manifest.ts \
  --base-url "https://argentos.ai/releases/macos/2026.3.2" \
  --bundle-id "ai.argent.mac" \
  --channel stable \
  --dist-dir dist \
  --out dist/macos-release-manifest.json \
  --version 2026.3.2
```

Manifest shape:

```json
{
  "manifestVersion": 1,
  "channel": "stable",
  "version": "2026.3.2",
  "macos": {
    "appName": "Argent.app",
    "bundleId": "ai.argent.mac",
    "installTarget": "/Applications/Argent.app",
    "artifacts": {
      "zip": {
        "url": "https://argentos.ai/releases/macos/2026.3.2/Argent-2026.3.2.zip",
        "sha256": "<zip sha256>"
      },
      "dmg": {
        "url": "https://argentos.ai/releases/macos/2026.3.2/Argent-2026.3.2.dmg",
        "sha256": "<dmg sha256>"
      }
    }
  }
}
```

## Publish to R2

Set the release bucket env, then run:

```bash
export R2_ACCOUNT_ID="..."
export R2_BUCKET_NAME="argentos-licensing-marketplace"
export R2_ACCESS_KEY_ID="..."
export R2_SECRET_ACCESS_KEY="..."
export R2_PUBLIC_BASE_URL="https://argentos.ai/releases/macos"

APP_VERSION="2026.3.2" \
ARGENTOS_INSTALL_CHANNEL=stable \
scripts/publish-macos-release-to-r2.sh
```

This uploads:

- versioned artifacts under `releases/macos/<version>/`
- `releases/macos/<version>.json`
- `releases/macos/latest.json`

## Hosted installer behavior

On macOS, `scripts/install-hosted.sh` now defaults to `--install-method artifact`.

The installer:

1. fetches the manifest (`https://argentos.ai/releases/macos/latest.json` by default)
2. downloads the `zip`
3. verifies SHA-256
4. installs `/Applications/Argent.app`
5. writes an optional CLI shim to `~/bin/argent`
6. opens `Argent.app`
7. defers onboarding to the app's first-run flow

Override the manifest URL for staging or testing:

```bash
ARGENTOS_MACOS_RELEASE_MANIFEST_URL="https://staging.example/releases/macos/latest.json" \
curl -fsSL https://argentos.ai/install.sh | bash
```

Force the old developer and source-build rail only when needed:

```bash
curl -fsSL https://argentos.ai/install.sh | bash -s -- --install-method git
```

## Website sync

The website repo must keep the served `install.sh` in sync with `scripts/install-hosted.sh`.

If the website serves `/install.sh` from a different repository:

- sync the updated installer script after merge
- ensure the website proxies `https://argentos.ai/releases/macos/*` from the R2 bucket, or set `ARGENTOS_MACOS_RELEASE_MANIFEST_URL` in the served installer to another public manifest URL

## Verification

Local installer smoke:

```bash
pnpm test:install:hosted:macos:artifact:local:smoke
```

Release verification:

```bash
spctl --assess --type execute dist/Argent.app
xcrun stapler validate dist/Argent-<version>.dmg
shasum -a 256 dist/Argent-<version>.zip dist/Argent-<version>.dmg
```
