#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# ArgentOS Archive Builder
#
# Produces: dist/release/argent-<version>-darwin-<arch>.tar.gz
#
# This is the DMG-free alternative for distribution.
# Extracts to an `argentos/` directory. Run ./install.sh inside it.
#
# Usage:
#   scripts/make-archive.sh [output_dir]
#
# Env vars (all optional):
#   SKIP_BUILD       Skip `pnpm build` if 1 (default: 0)
#   SKIP_UI_BUILD    Skip dashboard build if 1 (default: 0)
#   NODE_VERSION     Node.js version to bundle (default: 22.22.0)
#   NODE_ARCH        arm64 | x86_64 (default: current arch)
# ============================================================================

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT_DIR="${1:-$ROOT_DIR/dist/release}"
ARCH="$(uname -m)"

VERSION="$(cd "$ROOT_DIR" && node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0")"
TARBALL_NAME="argent-${VERSION}-darwin-${ARCH}.tar.gz"
RUNTIME_DIR="$ROOT_DIR/dist/argent-runtime"

# Colors
BOLD='\033[1m'
CYAN='\033[0;36m'
GREEN='\033[0;32m'
RESET='\033[0m'

echo ""
printf "${BOLD}=== ArgentOS Archive Builder ===${RESET}\n"
echo "  Version:  ${VERSION}"
echo "  Arch:     ${ARCH}"
echo "  Output:   ${OUTPUT_DIR}/${TARBALL_NAME}"
echo ""

# ---------- Step 1: Build the runtime bundle ----------
printf "${CYAN}[1/5]${RESET} Building runtime bundle...\n"
"$ROOT_DIR/scripts/bundle-runtime.sh" "$RUNTIME_DIR"
echo ""

# ---------- Step 2: Copy installer into bundle ----------
printf "${CYAN}[2/5]${RESET} Adding install.sh to bundle...\n"
cp "$ROOT_DIR/install.sh" "$RUNTIME_DIR/install.sh"
chmod +x "$RUNTIME_DIR/install.sh"
echo "  Copied install.sh"

# ---------- Step 3: Bundle ArgentOS.app (Swift menu bar) ----------
printf "${CYAN}[3/5]${RESET} Bundling ArgentOS.app...\n"
APP_SRC="/Applications/ArgentOS.app"
if [[ -d "$APP_SRC" ]]; then
  mkdir -p "$RUNTIME_DIR/app"
  rsync -a "$APP_SRC" "$RUNTIME_DIR/app/"
  echo "  Bundled: $APP_SRC"
else
  echo "  WARN: ArgentOS.app not found at $APP_SRC — skipping"
fi
echo ""

# ---------- Step 4: Create tarball ----------
printf "${CYAN}[4/5]${RESET} Creating tarball...\n"
mkdir -p "$OUTPUT_DIR"

STAGING_DIR="$(mktemp -d)"
mv "$RUNTIME_DIR" "$STAGING_DIR/argentos"

tar czf "$OUTPUT_DIR/$TARBALL_NAME" -C "$STAGING_DIR" argentos

# Restore for potential reuse
mv "$STAGING_DIR/argentos" "$RUNTIME_DIR"
rm -rf "$STAGING_DIR"

TARBALL_PATH="$OUTPUT_DIR/$TARBALL_NAME"
TARBALL_SIZE="$(du -sh "$TARBALL_PATH" | awk '{print $1}')"
TARBALL_SHA256="$(shasum -a 256 "$TARBALL_PATH" | awk '{print $1}')"

echo "  Created: $TARBALL_PATH"

# ---------- Step 4: Summary ----------
echo ""
printf "${CYAN}[5/5]${RESET} Done!\n"
printf "${BOLD}============================================${RESET}\n"
echo "  File:     $TARBALL_PATH"
echo "  Size:     $TARBALL_SIZE"
echo "  SHA256:   $TARBALL_SHA256"
echo ""
printf "${GREEN}To install on any Mac:${RESET}\n"
echo "  tar xzf ${TARBALL_NAME}"
echo "  cd argentos"
echo "  bash install.sh"
echo ""
