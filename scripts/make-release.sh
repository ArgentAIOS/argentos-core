#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# ArgentOS Release Packager
#
# Creates a distributable tarball: argent-{version}-darwin-{arch}.tar.gz
#
# Usage:
#   scripts/make-release.sh [output_dir]
#
# The tarball extracts to an `argentos/` directory containing:
#   bin/node, dist/, dashboard/, argent.mjs, install.sh, ...
#
# End user flow:
#   tar xzf argent-2026.2.4-darwin-arm64.tar.gz
#   cd argentos
#   bash install.sh
# ============================================================================

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT_DIR="${1:-$ROOT_DIR/dist/release}"
ARCH="$(uname -m)"

# Read version from package.json
VERSION="$(cd "$ROOT_DIR" && node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0")"

TARBALL_NAME="argent-${VERSION}-darwin-${ARCH}.tar.gz"
RUNTIME_DIR="$ROOT_DIR/dist/argent-runtime"

echo "=== ArgentOS Release Packager ==="
echo "  Version:  ${VERSION}"
echo "  Arch:     ${ARCH}"
echo "  Output:   ${OUTPUT_DIR}/${TARBALL_NAME}"
echo ""

# ---------- Step 1: Build the runtime bundle ----------
echo "[1/4] Building runtime bundle..."
"$ROOT_DIR/scripts/bundle-runtime.sh" "$RUNTIME_DIR"
echo ""

# ---------- Step 2: Copy installer into bundle ----------
echo "[2/4] Adding installer script..."
cp "$ROOT_DIR/install.sh" "$RUNTIME_DIR/install.sh"
chmod +x "$RUNTIME_DIR/install.sh"
echo "  Copied install.sh"

# ---------- Step 3: Create tarball ----------
echo "[3/4] Creating tarball..."
mkdir -p "$OUTPUT_DIR"

# Use a temp directory so the tarball extracts to argentos/
STAGING_DIR="$(mktemp -d)"
# Move runtime dir into staging as argentos/
mv "$RUNTIME_DIR" "$STAGING_DIR/argentos"

tar czf "$OUTPUT_DIR/$TARBALL_NAME" -C "$STAGING_DIR" argentos

# Move runtime dir back for potential reuse
mv "$STAGING_DIR/argentos" "$RUNTIME_DIR"
rm -rf "$STAGING_DIR"

echo "  Created: $OUTPUT_DIR/$TARBALL_NAME"

# ---------- Step 4: Print summary ----------
echo ""
echo "[4/4] Release summary"
echo "============================================"

TARBALL_PATH="$OUTPUT_DIR/$TARBALL_NAME"
TARBALL_SIZE="$(du -sh "$TARBALL_PATH" | awk '{print $1}')"
TARBALL_SHA256="$(shasum -a 256 "$TARBALL_PATH" | awk '{print $1}')"

echo "  File:     $TARBALL_PATH"
echo "  Size:     $TARBALL_SIZE"
echo "  SHA256:   $TARBALL_SHA256"
echo ""
echo "To install on a fresh Mac:"
echo "  tar xzf $TARBALL_NAME"
echo "  cd argentos"
echo "  bash install.sh"
echo ""
