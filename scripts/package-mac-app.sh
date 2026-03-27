#!/usr/bin/env bash
set -euo pipefail

# Build and bundle ArgentOS into a minimal .app we can open.
# Outputs to dist/Argent.app

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_ROOT="$ROOT_DIR/dist/Argent.app"
BUILD_ROOT="$ROOT_DIR/apps/macos/.build"
PRODUCT="Argent"
BUNDLE_ID="${BUNDLE_ID:-ai.argent.mac.debug}"
PKG_VERSION="$(cd "$ROOT_DIR" && node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0")"
BUILD_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
GIT_COMMIT=$(cd "$ROOT_DIR" && git rev-parse --short HEAD 2>/dev/null || echo "unknown")
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
BUILD_CONFIG="${BUILD_CONFIG:-debug}"
BUILD_ARCHS_VALUE="${BUILD_ARCHS:-$(uname -m)}"
if [[ "${BUILD_ARCHS_VALUE}" == "all" ]]; then
  BUILD_ARCHS_VALUE="arm64 x86_64"
fi
IFS=' ' read -r -a BUILD_ARCHS <<< "$BUILD_ARCHS_VALUE"
PRIMARY_ARCH="${BUILD_ARCHS[0]}"
SPARKLE_PUBLIC_ED_KEY="${SPARKLE_PUBLIC_ED_KEY:-AGCY8w5vHirVfGGDGc8Szc5iuOqupZSh9pMj/Qs67XI=}"
SPARKLE_FEED_URL="${SPARKLE_FEED_URL:-https://raw.githubusercontent.com/ArgentAIOS/argentos-core/main/appcast.xml}"
AUTO_CHECKS=true
if [[ "$BUNDLE_ID" == *.debug ]]; then
  SPARKLE_FEED_URL=""
  AUTO_CHECKS=false
fi
if [[ "$AUTO_CHECKS" == "true" && ! "$APP_BUILD" =~ ^[0-9]+$ ]]; then
  echo "ERROR: APP_BUILD must be numeric for Sparkle compare (CFBundleVersion). Got: $APP_BUILD" >&2
  exit 1
fi

echo "🖼  Syncing canonical macOS branding assets"
"$ROOT_DIR/scripts/sync-macos-branding-assets.sh"

ensure_workspace_dependencies() {
  if [[ "${FORCE_PNPM_INSTALL:-0}" == "1" ]]; then
    echo "📦 FORCE_PNPM_INSTALL=1 — running pnpm install in active workspace"
    (cd "$ROOT_DIR" && pnpm install --frozen-lockfile)
    return 0
  fi

  if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
    echo "ERROR: node_modules missing in active workspace." >&2
    echo "Run 'pnpm install' first, or rerun packaging with FORCE_PNPM_INSTALL=1." >&2
    exit 1
  fi

  if [[ ! -f "$ROOT_DIR/node_modules/.modules.yaml" ]]; then
    echo "ERROR: pnpm workspace metadata missing under node_modules/.modules.yaml." >&2
    echo "Run 'pnpm install' first, or rerun packaging with FORCE_PNPM_INSTALL=1." >&2
    exit 1
  fi

  echo "📦 Using existing workspace dependencies (no install mutation)"
}

build_path_for_arch() {
  echo "$BUILD_ROOT/$1"
}

bin_for_arch() {
  echo "$(build_path_for_arch "$1")/$BUILD_CONFIG/$PRODUCT"
}

sparkle_framework_for_arch() {
  echo "$(build_path_for_arch "$1")/$BUILD_CONFIG/Sparkle.framework"
}

merge_framework_machos() {
  local primary="$1"
  local dest="$2"
  shift 2
  local others=("$@")

  archs_for() {
    /usr/bin/lipo -info "$1" | /usr/bin/sed -E 's/.*are: //; s/.*architecture: //'
  }

  arch_in_list() {
    local needle="$1"
    shift
    for item in "$@"; do
      if [[ "$item" == "$needle" ]]; then
        return 0
      fi
    done
    return 1
  }

  while IFS= read -r -d '' file; do
    if /usr/bin/file "$file" | /usr/bin/grep -q "Mach-O"; then
      local rel="${file#$primary/}"
      local primary_archs
      primary_archs=$(archs_for "$file")
      IFS=' ' read -r -a primary_arch_array <<< "$primary_archs"

      local missing_files=()
      local tmp_dir
      tmp_dir=$(mktemp -d)
      for fw in "${others[@]}"; do
        local other_file="$fw/$rel"
        if [[ ! -f "$other_file" ]]; then
          echo "ERROR: Missing $rel in $fw" >&2
          rm -rf "$tmp_dir"
          exit 1
        fi
        if /usr/bin/file "$other_file" | /usr/bin/grep -q "Mach-O"; then
          local other_archs
          other_archs=$(archs_for "$other_file")
          IFS=' ' read -r -a other_arch_array <<< "$other_archs"
          for arch in "${other_arch_array[@]}"; do
            if ! arch_in_list "$arch" "${primary_arch_array[@]}"; then
              local thin_file="$tmp_dir/$(echo "$rel" | tr '/' '_')-$arch"
              /usr/bin/lipo -thin "$arch" "$other_file" -output "$thin_file"
              missing_files+=("$thin_file")
              primary_arch_array+=("$arch")
            fi
          done
        fi
      done

      if [[ "${#missing_files[@]}" -gt 0 ]]; then
        /usr/bin/lipo -create "$file" "${missing_files[@]}" -output "$dest/$rel"
      fi
      rm -rf "$tmp_dir"
    fi
  done < <(find "$primary" -type f -print0)
}

ensure_workspace_dependencies
if [[ "${SKIP_TSC:-0}" != "1" ]]; then
  echo "📦 Building JS (pnpm build)"
  (cd "$ROOT_DIR" && pnpm build)
else
  echo "📦 Skipping JS build (SKIP_TSC=1)"
fi

if [[ "${SKIP_UI_BUILD:-0}" != "1" ]]; then
  echo "🖥  Building Control UI (ui:build)"
  (cd "$ROOT_DIR" && node scripts/ui.js build)
else
  echo "🖥  Skipping Control UI build (SKIP_UI_BUILD=1)"
fi

cd "$ROOT_DIR/apps/macos"

echo "🔨 Building $PRODUCT ($BUILD_CONFIG) [${BUILD_ARCHS[*]}]"
for arch in "${BUILD_ARCHS[@]}"; do
  BUILD_PATH="$(build_path_for_arch "$arch")"
  swift build -c "$BUILD_CONFIG" --product "$PRODUCT" --build-path "$BUILD_PATH" --arch "$arch" -Xlinker -rpath -Xlinker @executable_path/../Frameworks
done

BIN_PRIMARY="$(bin_for_arch "$PRIMARY_ARCH")"
echo "pkg: binary $BIN_PRIMARY" >&2
echo "🧹 Cleaning old app bundle"
rm -rf "$APP_ROOT"
mkdir -p "$APP_ROOT/Contents/MacOS"
mkdir -p "$APP_ROOT/Contents/Resources"
mkdir -p "$APP_ROOT/Contents/Frameworks"

echo "📄 Copying Info.plist template"
INFO_PLIST_SRC="$ROOT_DIR/apps/macos/Sources/Argent/Resources/Info.plist"
if [ ! -f "$INFO_PLIST_SRC" ]; then
  echo "ERROR: Info.plist template missing at $INFO_PLIST_SRC" >&2
  exit 1
fi
cp "$INFO_PLIST_SRC" "$APP_ROOT/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier ${BUNDLE_ID}" "$APP_ROOT/Contents/Info.plist" || true
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString ${APP_VERSION}" "$APP_ROOT/Contents/Info.plist" || true
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${APP_BUILD}" "$APP_ROOT/Contents/Info.plist" || true
/usr/libexec/PlistBuddy -c "Set :ArgentBuildTimestamp ${BUILD_TS}" "$APP_ROOT/Contents/Info.plist" || true
/usr/libexec/PlistBuddy -c "Set :ArgentGitCommit ${GIT_COMMIT}" "$APP_ROOT/Contents/Info.plist" || true
/usr/libexec/PlistBuddy -c "Set :SUFeedURL ${SPARKLE_FEED_URL}" "$APP_ROOT/Contents/Info.plist" \
  || /usr/libexec/PlistBuddy -c "Add :SUFeedURL string ${SPARKLE_FEED_URL}" "$APP_ROOT/Contents/Info.plist" || true
/usr/libexec/PlistBuddy -c "Set :SUPublicEDKey ${SPARKLE_PUBLIC_ED_KEY}" "$APP_ROOT/Contents/Info.plist" \
  || /usr/libexec/PlistBuddy -c "Add :SUPublicEDKey string ${SPARKLE_PUBLIC_ED_KEY}" "$APP_ROOT/Contents/Info.plist" || true
if /usr/libexec/PlistBuddy -c "Set :SUEnableAutomaticChecks ${AUTO_CHECKS}" "$APP_ROOT/Contents/Info.plist"; then
  true
else
  /usr/libexec/PlistBuddy -c "Add :SUEnableAutomaticChecks bool ${AUTO_CHECKS}" "$APP_ROOT/Contents/Info.plist" || true
fi

echo "🚚 Copying main App binary"
cp "$BIN_PRIMARY" "$APP_ROOT/Contents/MacOS/Argent"
if [[ "${#BUILD_ARCHS[@]}" -gt 1 ]]; then
  BIN_INPUTS=()
  for arch in "${BUILD_ARCHS[@]}"; do
    BIN_INPUTS+=("$(bin_for_arch "$arch")")
  done
  /usr/bin/lipo -create "${BIN_INPUTS[@]}" -output "$APP_ROOT/Contents/MacOS/Argent"
fi
chmod +x "$APP_ROOT/Contents/MacOS/Argent"
# SwiftPM outputs ad-hoc signed binaries; strip the signature before install_name_tool to avoid warnings.
/usr/bin/codesign --remove-signature "$APP_ROOT/Contents/MacOS/Argent" 2>/dev/null || true

echo "🚚 Copying Audio Capture binary"
AUDIO_CAP_BIN="$ROOT_DIR/apps/argent-audio-capture/.build/release/argent-audio-capture"
if [ ! -f "$AUDIO_CAP_BIN" ] && [ -n "$PRIMARY_ARCH" ]; then
    AUDIO_CAP_BIN="$ROOT_DIR/apps/argent-audio-capture/.build/$PRIMARY_ARCH-apple-macosx/release/argent-audio-capture"
fi
if [ -f "$AUDIO_CAP_BIN" ]; then
    cp "$AUDIO_CAP_BIN" "$APP_ROOT/Contents/MacOS/argent-audio-capture"
    chmod +x "$APP_ROOT/Contents/MacOS/argent-audio-capture"
    /usr/bin/codesign --remove-signature "$APP_ROOT/Contents/MacOS/argent-audio-capture" 2>/dev/null || true
else
    echo "WARN: argent-audio-capture binary not found at $AUDIO_CAP_BIN"
fi

SPARKLE_FRAMEWORK_PRIMARY="$(sparkle_framework_for_arch "$PRIMARY_ARCH")"
if [ -d "$SPARKLE_FRAMEWORK_PRIMARY" ]; then
  echo "✨ Embedding Sparkle.framework"
  cp -R "$SPARKLE_FRAMEWORK_PRIMARY" "$APP_ROOT/Contents/Frameworks/"
  if [[ "${#BUILD_ARCHS[@]}" -gt 1 ]]; then
    OTHER_FRAMEWORKS=()
    for arch in "${BUILD_ARCHS[@]}"; do
      if [[ "$arch" == "$PRIMARY_ARCH" ]]; then
        continue
      fi
      OTHER_FRAMEWORKS+=("$(sparkle_framework_for_arch "$arch")")
    done
    merge_framework_machos "$SPARKLE_FRAMEWORK_PRIMARY" "$APP_ROOT/Contents/Frameworks/Sparkle.framework" "${OTHER_FRAMEWORKS[@]}"
  fi
  chmod -R a+rX "$APP_ROOT/Contents/Frameworks/Sparkle.framework"
fi

echo "📦 Copying Swift 6.2 compatibility libraries"
SWIFT_COMPAT_LIB="$(xcode-select -p)/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift-6.2/macosx/libswiftCompatibilitySpan.dylib"
if [ -f "$SWIFT_COMPAT_LIB" ]; then
  cp "$SWIFT_COMPAT_LIB" "$APP_ROOT/Contents/Frameworks/"
  chmod +x "$APP_ROOT/Contents/Frameworks/libswiftCompatibilitySpan.dylib"
else
  echo "WARN: Swift compatibility library not found at $SWIFT_COMPAT_LIB (continuing)" >&2
fi

echo "🖼  Copying app icon"
cp "$ROOT_DIR/apps/macos/Sources/Argent/Resources/Argent.icns" "$APP_ROOT/Contents/Resources/Argent.icns"

echo "📦 Copying device model resources"
rm -rf "$APP_ROOT/Contents/Resources/DeviceModels"
cp -R "$ROOT_DIR/apps/macos/Sources/Argent/Resources/DeviceModels" "$APP_ROOT/Contents/Resources/DeviceModels"

echo "📦 Copying workspace templates"
rm -rf "$APP_ROOT/Contents/Resources/reference"
mkdir -p "$APP_ROOT/Contents/Resources/reference"
cp -R "$ROOT_DIR/docs/reference/templates" "$APP_ROOT/Contents/Resources/reference/templates"

echo "📦 Copying model catalog"
MODEL_CATALOG_DEST="$APP_ROOT/Contents/Resources/models.generated.js"
MODEL_CATALOG_LEGACY_SCOPE="${MODEL_CATALOG_LEGACY_SCOPE:-@mariozechner}"
MODEL_CATALOG_LEGACY_PACKAGE="${MODEL_CATALOG_LEGACY_PACKAGE:-pi-ai}"
MODEL_CATALOG_CANDIDATES=(
  "$ROOT_DIR/dist/src/argent-ai/models-db.js"
  "$ROOT_DIR/node_modules/$MODEL_CATALOG_LEGACY_SCOPE/$MODEL_CATALOG_LEGACY_PACKAGE/dist/models.generated.js"
)
MODEL_CATALOG_SRC=""
for candidate in "${MODEL_CATALOG_CANDIDATES[@]}"; do
  if [ -f "$candidate" ]; then
    MODEL_CATALOG_SRC="$candidate"
    break
  fi
done
if [ -n "$MODEL_CATALOG_SRC" ]; then
  cp "$MODEL_CATALOG_SRC" "$MODEL_CATALOG_DEST"
else
  echo "WARN: model catalog missing (checked: ${MODEL_CATALOG_CANDIDATES[*]}) (continuing)" >&2
fi

echo "📦 Copying ArgentKit resources"
ARGENTKIT_BUNDLE="$(build_path_for_arch "$PRIMARY_ARCH")/$BUILD_CONFIG/ArgentKit_ArgentKit.bundle"
if [ -d "$ARGENTKIT_BUNDLE" ]; then
  rm -rf "$APP_ROOT/Contents/Resources/ArgentKit_ArgentKit.bundle"
  cp -R "$ARGENTKIT_BUNDLE" "$APP_ROOT/Contents/Resources/ArgentKit_ArgentKit.bundle"
else
  echo "WARN: ArgentKit resource bundle not found at $ARGENTKIT_BUNDLE (continuing)" >&2
fi

echo "📦 Copying Textual resources"
TEXTUAL_BUNDLE_DIR="$(build_path_for_arch "$PRIMARY_ARCH")/$BUILD_CONFIG"
TEXTUAL_BUNDLE=""
for candidate in \
  "$TEXTUAL_BUNDLE_DIR/textual_Textual.bundle" \
  "$TEXTUAL_BUNDLE_DIR/Textual_Textual.bundle"
do
  if [ -d "$candidate" ]; then
    TEXTUAL_BUNDLE="$candidate"
    break
  fi
done
if [ -z "$TEXTUAL_BUNDLE" ]; then
  TEXTUAL_BUNDLE="$(find "$BUILD_ROOT" -type d \( -name "textual_Textual.bundle" -o -name "Textual_Textual.bundle" \) -print -quit)"
fi
if [ -n "$TEXTUAL_BUNDLE" ] && [ -d "$TEXTUAL_BUNDLE" ]; then
  rm -rf "$APP_ROOT/Contents/Resources/$(basename "$TEXTUAL_BUNDLE")"
  cp -R "$TEXTUAL_BUNDLE" "$APP_ROOT/Contents/Resources/"
else
  if [[ "${ALLOW_MISSING_TEXTUAL_BUNDLE:-0}" == "1" ]]; then
    echo "WARN: Textual resource bundle not found (continuing due to ALLOW_MISSING_TEXTUAL_BUNDLE=1)" >&2
  else
    echo "ERROR: Textual resource bundle not found. Set ALLOW_MISSING_TEXTUAL_BUNDLE=1 to bypass." >&2
    exit 1
  fi
fi

echo "⏹  Stopping any running Argent"
killall -q Argent 2>/dev/null || true

echo "🔏 Signing bundle (auto-selects signing identity if SIGN_IDENTITY is unset)"
"$ROOT_DIR/scripts/codesign-mac-app.sh" "$APP_ROOT"

echo "✅ Bundle ready at $APP_ROOT"
