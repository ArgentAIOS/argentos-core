#!/usr/bin/env bash
set -euo pipefail

# Build and package Argent.app — the menu bar service manager.
#
# This script:
#   1. Builds the Swift menu bar app
#   2. Bundles the ArgentOS runtime (Node.js + CLI + Dashboard)
#   3. Creates Argent.app with embedded runtime
#   4. Optionally code-signs and creates a DMG
#
# Output:
#   dist/Argent.app
#
# Usage:
#   scripts/package-argentos.sh
#
# Env:
#   SKIP_BUILD          Skip pnpm build (default: 0)
#   SKIP_UI_BUILD       Skip dashboard build (default: 0)
#   SKIP_SIGN           Skip code signing (default: 0)
#   SKIP_DMG            Skip DMG creation (default: 0)
#   SKIP_NOTARIZE       Skip notarization (default: 1)
#   BUILD_CONFIG        debug or release (default: release)
#   BUNDLE_ID           App bundle identifier (default: ai.argent.manager)
#   SIGN_IDENTITY       Code signing identity (default: auto-detect or ad-hoc)

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SWIFT_APP_DIR="$ROOT_DIR/apps/argent-manager"
BUILD_CONFIG="${BUILD_CONFIG:-release}"
BUNDLE_ID="${BUNDLE_ID:-ai.argent.manager}"
ENTITLEMENTS_PLIST="${ENTITLEMENTS_PLIST:-$SWIFT_APP_DIR/entitlements.mac.plist}"
NODE_RUNTIME_ENTITLEMENTS_PLIST="${NODE_RUNTIME_ENTITLEMENTS_PLIST:-$SWIFT_APP_DIR/entitlements.node-runtime.plist}"
SKIP_BUILD="${SKIP_BUILD:-0}"
SKIP_UI_BUILD="${SKIP_UI_BUILD:-0}"
SKIP_SIGN="${SKIP_SIGN:-0}"
SKIP_DMG="${SKIP_DMG:-0}"
SKIP_NOTARIZE="${SKIP_NOTARIZE:-1}"

PKG_VERSION="$(cd "$ROOT_DIR" && node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0")"
GIT_BUILD_NUMBER=$(cd "$ROOT_DIR" && git rev-list --count HEAD 2>/dev/null || echo "0")
APP_VERSION="${APP_VERSION:-$PKG_VERSION}"

derive_numeric_build() {
  local version="$1"
  if [[ "$version" =~ ^([0-9]{4})\.([0-9]{1,2})\.([0-9]{1,2})([.-].*)?$ ]]; then
    printf "%04d%02d%02d" "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}"
    return 0
  fi
  return 1
}

DEFAULT_APP_BUILD="$(derive_numeric_build "$APP_VERSION" || echo "$GIT_BUILD_NUMBER")"
APP_BUILD="${APP_BUILD:-$DEFAULT_APP_BUILD}"

APP_ROOT="$ROOT_DIR/dist/Argent.app"
PRODUCT_NAME="Argent"

echo "=== Building $PRODUCT_NAME v${APP_VERSION} (${BUILD_CONFIG}) ==="

# ---------- Step 1: Build SwiftUI Menu Bar App ----------
echo ""
echo "--- Step 1: Building Swift App ---"
cd "$SWIFT_APP_DIR"

swift build -c "$BUILD_CONFIG" --product ArgentManager
SWIFT_BIN="$SWIFT_APP_DIR/.build/$BUILD_CONFIG/ArgentManager"

if [[ ! -f "$SWIFT_BIN" ]]; then
  echo "ERROR: Swift binary not found at $SWIFT_BIN" >&2
  exit 1
fi
echo "Swift binary: $SWIFT_BIN"

# ---------- Step 1b: Build Audio Capture CLI ----------
echo ""
echo "--- Step 1b: Building Audio Capture CLI ---"
AUDIO_CAPTURE_DIR="$ROOT_DIR/apps/argent-audio-capture"
(cd "$AUDIO_CAPTURE_DIR" && swift build -c "$BUILD_CONFIG" --product argent-audio-capture)
AUDIO_CAPTURE_BIN="$AUDIO_CAPTURE_DIR/.build/$BUILD_CONFIG/argent-audio-capture"

if [[ -f "$AUDIO_CAPTURE_BIN" ]]; then
  echo "Audio capture binary: $AUDIO_CAPTURE_BIN"
else
  echo "WARN: Audio capture binary not found (meeting recording will be unavailable)" >&2
fi

# ---------- Step 2: Bundle Runtime ----------
echo ""
echo "--- Step 2: Bundling Runtime ---"
RUNTIME_DIR="$ROOT_DIR/dist/argent-runtime"
SKIP_BUILD="$SKIP_BUILD" SKIP_UI_BUILD="$SKIP_UI_BUILD" "$ROOT_DIR/scripts/bundle-runtime.sh" "$RUNTIME_DIR"

# ---------- Step 3: Assemble .app Bundle ----------
echo ""
echo "--- Step 3: Assembling App Bundle ---"
rm -rf "$APP_ROOT"
mkdir -p "$APP_ROOT/Contents/MacOS"
mkdir -p "$APP_ROOT/Contents/Resources"

# Copy binary
cp "$SWIFT_BIN" "$APP_ROOT/Contents/MacOS/ArgentManager"
chmod +x "$APP_ROOT/Contents/MacOS/ArgentManager"

# Copy bundled runtime into Resources
echo "Embedding runtime into app bundle..."
cp -R "$RUNTIME_DIR" "$APP_ROOT/Contents/Resources/argent-runtime"

# Copy audio capture binary into Resources/bin
if [[ -f "$AUDIO_CAPTURE_BIN" ]]; then
  mkdir -p "$APP_ROOT/Contents/Resources/bin"
  cp "$AUDIO_CAPTURE_BIN" "$APP_ROOT/Contents/Resources/bin/argent-audio-capture"
  chmod +x "$APP_ROOT/Contents/Resources/bin/argent-audio-capture"
  echo "Embedded audio capture binary"
fi

# Create Info.plist
cat > "$APP_ROOT/Contents/Info.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>${PRODUCT_NAME}</string>
    <key>CFBundleDisplayName</key>
    <string>${PRODUCT_NAME}</string>
    <key>CFBundleIdentifier</key>
    <string>${BUNDLE_ID}</string>
    <key>CFBundleVersion</key>
    <string>${APP_BUILD}</string>
    <key>CFBundleShortVersionString</key>
    <string>${APP_VERSION}</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleExecutable</key>
    <string>ArgentManager</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>LSMinimumSystemVersion</key>
    <string>13.0</string>
    <key>LSUIElement</key>
    <true/>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>NSSupportsAutomaticTermination</key>
    <false/>
    <key>NSSupportsSuddenTermination</key>
    <false/>
    <key>NSMicrophoneUsageDescription</key>
    <string>ArgentOS needs microphone access for meeting capture and transcription.</string>
    <key>NSScreenCaptureDescription</key>
    <string>ArgentOS needs screen and system audio capture for Zoom/Meet/Teams recording.</string>
</dict>
</plist>
PLIST

# Create a minimal icon if none exists
ICON_SRC="$ROOT_DIR/assets/argent-icon.icns"
if [[ -f "$ICON_SRC" ]]; then
  cp "$ICON_SRC" "$APP_ROOT/Contents/Resources/AppIcon.icns"
else
  echo "WARN: No app icon found at $ICON_SRC (app will use default icon)" >&2
fi

# ---------- Step 4: Code Sign ----------
if [[ "$SKIP_SIGN" != "1" ]]; then
  echo ""
  echo "--- Step 4: Code Signing ---"
  if [[ -n "${SIGN_IDENTITY:-}" ]]; then
    echo "Signing with: $SIGN_IDENTITY"
    ENT_ARGS=()
    if [[ -f "$ENTITLEMENTS_PLIST" ]]; then
      echo "Using entitlements: $ENTITLEMENTS_PLIST"
      ENT_ARGS=(--entitlements "$ENTITLEMENTS_PLIST")
    fi
    NODE_ENT_ARGS=()
    if [[ -f "$NODE_RUNTIME_ENTITLEMENTS_PLIST" ]]; then
      echo "Using Node runtime entitlements: $NODE_RUNTIME_ENTITLEMENTS_PLIST"
      NODE_ENT_ARGS=(--entitlements "$NODE_RUNTIME_ENTITLEMENTS_PLIST")
    fi

    NODE_BIN="$APP_ROOT/Contents/Resources/argent-runtime/bin/node"
    if [[ -f "$NODE_BIN" ]]; then
      echo "Signing Node runtime binary..."
      codesign --force --sign "$SIGN_IDENTITY" --timestamp --options runtime "${NODE_ENT_ARGS[@]}" "$NODE_BIN" 2>/dev/null || true
    fi

    # Sign all nested Mach-O binaries first (excluding node, already signed with JIT entitlements)
    echo "Signing nested binaries..."
    find "$APP_ROOT/Contents/Resources" -type f \( -name "node" -o -name "*.node" -o -name "*.dylib" \) -print0 | while IFS= read -r -d '' binary; do
      [[ "$binary" == "$NODE_BIN" ]] && continue
      echo "  Signing: ${binary#$APP_ROOT/}"
      codesign --force --sign "$SIGN_IDENTITY" --timestamp --options runtime "$binary" 2>/dev/null || true
    done

    # Sign any executable binaries in node_modules (like esbuild)
    find "$APP_ROOT/Contents/Resources" -type f -perm +111 -print0 | while IFS= read -r -d '' binary; do
      if file "$binary" | grep -q "Mach-O"; then
        [[ "$binary" == "$NODE_BIN" ]] && continue
        echo "  Signing: ${binary#$APP_ROOT/}"
        codesign --force --sign "$SIGN_IDENTITY" --timestamp --options runtime "$binary" 2>/dev/null || true
      fi
    done

    # Sign the main app bundle
    echo "Signing app bundle..."
    codesign --force --sign "$SIGN_IDENTITY" --timestamp --options runtime "${ENT_ARGS[@]}" "$APP_ROOT"
  else
    echo "Ad-hoc signing..."
    codesign --force --deep --sign - "$APP_ROOT"
  fi
  echo "Signed: $APP_ROOT"
else
  echo ""
  echo "--- Step 4: Skipping code signing (SKIP_SIGN=1) ---"
fi

# ---------- Step 5: Verify Bundle ----------
echo ""
echo "--- Step 5: Verifying Bundle ---"
if [[ ! -f "$APP_ROOT/Contents/MacOS/ArgentManager" ]]; then
  echo "ERROR: Missing binary in app bundle" >&2
  exit 1
fi
if [[ ! -d "$APP_ROOT/Contents/Resources/argent-runtime/bin" ]]; then
  echo "ERROR: Missing bundled runtime" >&2
  exit 1
fi
if [[ ! -f "$APP_ROOT/Contents/Resources/argent-runtime/bin/node" ]]; then
  echo "ERROR: Missing bundled Node.js binary" >&2
  exit 1
fi

# Verify no actual API keys in bundle (match real key patterns, not code references)
if grep -rPq 'sk-ant-(?:api|oat)\d{2}-[A-Za-z0-9_-]{20,}' "$APP_ROOT" 2>/dev/null; then
  echo "ERROR: Found actual API keys in app bundle! Aborting." >&2
  grep -rPl 'sk-ant-(?:api|oat)\d{2}-[A-Za-z0-9_-]{20,}' "$APP_ROOT" 2>/dev/null
  exit 1
fi

APP_SIZE=$(du -sh "$APP_ROOT" | awk '{print $1}')
echo "App bundle: $APP_ROOT ($APP_SIZE)"

echo "Running embedded runtime verification..."
set +e
"$ROOT_DIR/scripts/verify-argent-manager-bundle.sh" "$APP_ROOT"
VERIFY_RC=$?
set -e
if [[ $VERIFY_RC -ne 0 ]]; then
  echo "WARN: Runtime verification exited with code $VERIFY_RC (non-fatal)" >&2
fi

# ---------- Step 6: Create DMG ----------
if [[ "$SKIP_DMG" != "1" ]]; then
  echo ""
  echo "--- Step 6: Creating DMG ---"
  DMG_PATH="$ROOT_DIR/dist/${PRODUCT_NAME}-${APP_VERSION}.dmg"

  DMG_VOLUME_NAME="$PRODUCT_NAME" "$ROOT_DIR/scripts/create-dmg.sh" "$APP_ROOT" "$DMG_PATH"

  if [[ "$SKIP_NOTARIZE" != "1" ]] && [[ -n "${SIGN_IDENTITY:-}" ]]; then
    echo "Signing DMG..."
    codesign --force --sign "$SIGN_IDENTITY" --timestamp "$DMG_PATH"
    "$ROOT_DIR/scripts/notarize-mac-artifact.sh" "$DMG_PATH"
  fi

  DMG_SIZE=$(du -sh "$DMG_PATH" | awk '{print $1}')
  echo ""
  echo "=== DMG ready ==="
  echo "  Path: $DMG_PATH"
  echo "  Size: $DMG_SIZE"
else
  echo ""
  echo "--- Step 6: Skipping DMG creation (SKIP_DMG=1) ---"
fi

echo ""
echo "=== Build Complete ==="
echo "  App:     $APP_ROOT"
echo "  Version: $APP_VERSION (build $APP_BUILD)"
