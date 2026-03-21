#!/usr/bin/env bash
set -euo pipefail

# One-command release pipeline for the ArgentOS menu bar manager app.
#
# What it does:
# 1) Build Argent.app (manager) in release mode
# 2) Sign with Developer ID
# 3) Notarize + staple DMG
# 4) Verify signatures/notarization
# 5) Emit checksum + release manifest for easy transfer/install on another Mac
#
# Usage:
#   scripts/release-argent-manager.sh
#
# Optional env:
#   SIGN_IDENTITY        Override codesign identity
#   NOTARYTOOL_PROFILE   Override notary profile (defaults: ArgentOS, fallback argent-notary)
#   APP_VERSION          Override app version (defaults to package.json version)
#   APP_BUILD            Override build number (defaults to git commit count)
#   SKIP_BUILD=1         Skip JS/runtime build steps
#   SKIP_UI_BUILD=1      Skip dashboard build step

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"

detect_sign_identity() {
  if [[ -n "${SIGN_IDENTITY:-}" ]]; then
    echo "$SIGN_IDENTITY"
    return 0
  fi

  local preferred=""
  preferred="$(security find-identity -p codesigning -v 2>/dev/null \
    | awk -F'"' '/Developer ID Application: Jason Brashear \(F2DH8T4BVH\)/ { print $2; exit }')"
  if [[ -n "$preferred" ]]; then
    echo "$preferred"
    return 0
  fi

  preferred="$(security find-identity -p codesigning -v 2>/dev/null \
    | awk -F'"' '/Developer ID Application/ { print $2; exit }')"
  if [[ -n "$preferred" ]]; then
    echo "$preferred"
    return 0
  fi

  return 1
}

profile_is_usable() {
  local profile="$1"
  xcrun notarytool history --keychain-profile "$profile" --output-format json >/dev/null 2>&1
}

detect_notary_profile() {
  if [[ -n "${NOTARYTOOL_PROFILE:-}" ]]; then
    if profile_is_usable "$NOTARYTOOL_PROFILE"; then
      echo "$NOTARYTOOL_PROFILE"
      return 0
    fi
    echo "ERROR: NOTARYTOOL_PROFILE is set but not usable: $NOTARYTOOL_PROFILE" >&2
    return 1
  fi

  if profile_is_usable "ArgentOS"; then
    echo "ArgentOS"
    return 0
  fi
  if profile_is_usable "argent-notary"; then
    echo "argent-notary"
    return 0
  fi

  cat >&2 <<'EOF'
ERROR: No usable notary profile found.
Create one and rerun:
  xcrun notarytool store-credentials "ArgentOS" \
    --apple-id "<apple-id>" --team-id "<team-id>" --password "<app-specific-password>"
EOF
  return 1
}

if ! command -v security >/dev/null 2>&1; then
  echo "ERROR: security tool not found (macOS required)." >&2
  exit 1
fi
if ! command -v xcrun >/dev/null 2>&1; then
  echo "ERROR: xcrun not found (install Xcode command line tools)." >&2
  exit 1
fi

SIGN_IDENTITY_VALUE="$(detect_sign_identity)" || {
  echo "ERROR: No Developer ID signing identity found. Set SIGN_IDENTITY explicitly." >&2
  exit 1
}
NOTARY_PROFILE_VALUE="$(detect_notary_profile)" || exit 1

APP_VERSION_VALUE="${APP_VERSION:-$(cd "$ROOT_DIR" && node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0")}"

derive_numeric_build() {
  local version="$1"
  if [[ "$version" =~ ^([0-9]{4})\.([0-9]{1,2})\.([0-9]{1,2})([.-].*)?$ ]]; then
    printf "%04d%02d%02d" "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}"
    return 0
  fi
  return 1
}

if APP_BUILD_DEFAULT="$(derive_numeric_build "$APP_VERSION_VALUE")"; then
  true
else
  APP_BUILD_DEFAULT="$(cd "$ROOT_DIR" && git rev-list --count HEAD 2>/dev/null || echo "0")"
fi
APP_BUILD_VALUE="${APP_BUILD:-$APP_BUILD_DEFAULT}"
GIT_COMMIT_VALUE="$(cd "$ROOT_DIR" && git rev-parse --short HEAD 2>/dev/null || echo "unknown")"
RELEASE_TIME_UTC="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

echo "=== ArgentOS Manager Release ==="
echo "Version:        $APP_VERSION_VALUE"
echo "Build:          $APP_BUILD_VALUE"
echo "Git commit:     $GIT_COMMIT_VALUE"
echo "Sign identity:  $SIGN_IDENTITY_VALUE"
echo "Notary profile: $NOTARY_PROFILE_VALUE"
echo "Release time:   $RELEASE_TIME_UTC"
echo

NOTARYTOOL_PROFILE="$NOTARY_PROFILE_VALUE" \
SIGN_IDENTITY="$SIGN_IDENTITY_VALUE" \
BUILD_CONFIG="${BUILD_CONFIG:-release}" \
APP_VERSION="$APP_VERSION_VALUE" \
APP_BUILD="$APP_BUILD_VALUE" \
SKIP_SIGN=0 \
SKIP_DMG=0 \
SKIP_NOTARIZE=0 \
SKIP_BUILD="${SKIP_BUILD:-0}" \
SKIP_UI_BUILD="${SKIP_UI_BUILD:-0}" \
"$ROOT_DIR/scripts/package-argentos.sh"

APP_PATH="$DIST_DIR/Argent.app"
DMG_PATH="$DIST_DIR/Argent-$APP_VERSION_VALUE.dmg"

if [[ ! -d "$APP_PATH" ]]; then
  echo "ERROR: Missing app bundle after packaging: $APP_PATH" >&2
  exit 1
fi
if [[ ! -f "$DMG_PATH" ]]; then
  echo "ERROR: Missing DMG after packaging: $DMG_PATH" >&2
  exit 1
fi

echo
echo "=== Verifying signed artifacts ==="
codesign --verify --deep --strict "$APP_PATH"
spctl --assess --type execute "$APP_PATH"
xcrun stapler validate "$DMG_PATH"
spctl --assess --type open "$DMG_PATH"

mkdir -p "$DIST_DIR"
SHA_FILE="$DIST_DIR/Argent-$APP_VERSION_VALUE.SHA256"
MANIFEST_FILE="$DIST_DIR/Argent-$APP_VERSION_VALUE-release.txt"

shasum -a 256 "$DMG_PATH" > "$SHA_FILE"
{
  echo "ArgentOS Manager Release Manifest"
  echo "Version: $APP_VERSION_VALUE"
  echo "Build: $APP_BUILD_VALUE"
  echo "Commit: $GIT_COMMIT_VALUE"
  echo "Signed with: $SIGN_IDENTITY_VALUE"
  echo "Notary profile: $NOTARY_PROFILE_VALUE"
  echo "Generated at (UTC): $RELEASE_TIME_UTC"
  echo
  echo "Artifacts:"
  echo "  App: $APP_PATH"
  echo "  DMG: $DMG_PATH"
  echo
  echo "SHA256:"
  cat "$SHA_FILE"
} > "$MANIFEST_FILE"

echo
echo "✅ Release ready"
echo "DMG:       $DMG_PATH"
echo "Checksums: $SHA_FILE"
echo "Manifest:  $MANIFEST_FILE"
echo
echo "Install on second Mac:"
echo "1) Copy the DMG to the other Mac."
echo "2) Open DMG and drag Argent.app to /Applications."
echo "3) Launch Argent.app and grant prompts for Mic/Screen/System Audio as needed."
