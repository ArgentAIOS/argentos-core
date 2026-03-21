#!/usr/bin/env bash
set -euo pipefail

# Build a USB-transferable ArgentOS installer kit for a fresh Mac.
#
# Output layout:
#   dist/usb-installer/ArgentOS-USB-<version>-<timestamp>/
#     INSTALL_ON_NEW_MAC.sh
#     README.txt
#     CHECKSUMS.txt
#     assets/
#       argent-<version>-darwin-<arch>.tar.gz
#       ArgentOS-<version>.dmg                 (optional)
#
# Usage:
#   scripts/make-mac-usb-installer.sh [output_dir]
#
# Env:
#   BUILD_RUNTIME=1|0   Build runtime tarball via scripts/make-release.sh (default: 1)
#   BUILD_DMG=1|0       Build DMG via scripts/package-standalone-app.sh (default: 1)
#   INCLUDE_EXISTING_DMG=1|0  Include existing dist DMG if present (default: 1)

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(cd "$ROOT_DIR" && node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0")"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
DEFAULT_OUT="$ROOT_DIR/dist/usb-installer/ArgentOS-USB-${VERSION}-${TIMESTAMP}"
OUT_DIR="${1:-$DEFAULT_OUT}"
ASSETS_DIR="$OUT_DIR/assets"

BUILD_RUNTIME="${BUILD_RUNTIME:-1}"
BUILD_DMG="${BUILD_DMG:-1}"
INCLUDE_EXISTING_DMG="${INCLUDE_EXISTING_DMG:-1}"

log() { printf "\n==> %s\n" "$1"; }
warn() { printf "WARN: %s\n" "$1" >&2; }
err() { printf "ERROR: %s\n" "$1" >&2; }

if [[ "$(uname -s)" != "Darwin" ]]; then
  err "This script must run on macOS."
  exit 1
fi

release_dir="$ROOT_DIR/dist/release"

if [[ "$BUILD_RUNTIME" == "1" ]]; then
  log "Building runtime tarball (scripts/make-release.sh)"
  "$ROOT_DIR/scripts/make-release.sh" "$release_dir"
else
  log "Skipping runtime tarball build (BUILD_RUNTIME=0)"
fi

runtime_tgz="$(ls -1t "$release_dir"/argent-"$VERSION"-darwin-*.tar.gz 2>/dev/null | head -n1 || true)"
if [[ -z "$runtime_tgz" || ! -f "$runtime_tgz" ]]; then
  err "Runtime tarball not found in $release_dir. Run scripts/make-release.sh first or set BUILD_RUNTIME=1."
  exit 1
fi
mkdir -p "$ASSETS_DIR"
cp "$runtime_tgz" "$ASSETS_DIR/"

if [[ "$BUILD_DMG" == "1" ]]; then
  log "Building DMG (scripts/package-standalone-app.sh)"
  "$ROOT_DIR/scripts/package-standalone-app.sh"
fi

if [[ "$INCLUDE_EXISTING_DMG" == "1" ]]; then
  dmg_path="$(
    ls -1t \
      "$ROOT_DIR/dist/ArgentOS-${VERSION}.dmg" \
      "$ROOT_DIR/dist/Argent-${VERSION}.dmg" \
      "$ROOT_DIR/dist/ArgentOS-${VERSION}"*.dmg \
      "$ROOT_DIR/dist/Argent-${VERSION}"*.dmg \
      2>/dev/null | head -n1 || true
  )"
  if [[ -n "$dmg_path" && -f "$dmg_path" ]]; then
    log "Including DMG asset"
    cp "$dmg_path" "$ASSETS_DIR/"
  else
    warn "No existing DMG found in dist/ (kit will still install CLI/Gateway via tarball)."
  fi
fi

log "Writing INSTALL_ON_NEW_MAC.sh"
cat > "$OUT_DIR/INSTALL_ON_NEW_MAC.sh" <<'INSTALLER'
#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
ASSETS_DIR="$ROOT_DIR/assets"
CHECKSUM_FILE="$ROOT_DIR/CHECKSUMS.txt"
STAGING_DIR="$HOME/argentos-usb-install"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "ERROR: macOS only installer." >&2
  exit 1
fi

if [[ -f "$CHECKSUM_FILE" ]]; then
  echo "Verifying kit checksums..."
  # macOS shasum needs a real filename and relative paths; use a temp copy with normalized path.
  CHECKSUM_FILE_TMP="$(mktemp)"
  sed 's|  \./|  |g' "$CHECKSUM_FILE" > "$CHECKSUM_FILE_TMP"
  (
    cd "$ROOT_DIR"
    shasum -a 256 -c "$CHECKSUM_FILE_TMP"
  )
  rm -f "$CHECKSUM_FILE_TMP"
fi

runtime_tgz="$(ls -1 "$ASSETS_DIR"/argent-*-darwin-*.tar.gz 2>/dev/null | head -n1 || true)"
if [[ -z "$runtime_tgz" ]]; then
  echo "ERROR: runtime tarball missing in $ASSETS_DIR" >&2
  exit 1
fi

mkdir -p "$STAGING_DIR"
rm -rf "$STAGING_DIR/argentos"

echo "Extracting runtime bundle..."
tar xzf "$runtime_tgz" -C "$STAGING_DIR"

if [[ ! -x "$STAGING_DIR/argentos/install.sh" ]]; then
  echo "ERROR: install.sh not found after extraction." >&2
  exit 1
fi

echo "Running ArgentOS installer..."
ARGENT_FULL_STACK_INSTALL="${ARGENT_FULL_STACK_INSTALL:-1}"
ARGENT_INSTALL_STEIPETE_TOOLS="${ARGENT_INSTALL_STEIPETE_TOOLS:-1}"
ARGENT_PULL_OLLAMA_MODELS="${ARGENT_PULL_OLLAMA_MODELS:-1}"
ARGENT_OLLAMA_MODELS="${ARGENT_OLLAMA_MODELS:-qwen3:30b-a3b,qwen3:1.7b}"
(
  cd "$STAGING_DIR/argentos"
  ARGENT_FULL_STACK_INSTALL="$ARGENT_FULL_STACK_INSTALL" \
  ARGENT_INSTALL_STEIPETE_TOOLS="$ARGENT_INSTALL_STEIPETE_TOOLS" \
  ARGENT_PULL_OLLAMA_MODELS="$ARGENT_PULL_OLLAMA_MODELS" \
  ARGENT_OLLAMA_MODELS="$ARGENT_OLLAMA_MODELS" \
  bash ./install.sh
)

dmg_path="$(
  ls -1 \
    "$ASSETS_DIR"/ArgentOS-*.dmg \
    "$ASSETS_DIR"/Argent-*.dmg \
    2>/dev/null | head -n1 || true
)"
if [[ -n "$dmg_path" ]]; then
  echo "Optional: installing Argent.app from DMG..."
  open "$dmg_path"
  echo "Drag Argent.app to /Applications if you want the menu-bar app on this Mac."
fi

echo ""
echo "ArgentOS install complete."
echo "Dashboard: http://localhost:9242"
echo "CLI: argent --help"
echo "Gateway: argent gateway status"
INSTALLER
chmod +x "$OUT_DIR/INSTALL_ON_NEW_MAC.sh"

log "Writing README.txt"
cat > "$OUT_DIR/README.txt" <<'README'
ArgentOS USB Installer Kit

1) Copy this folder to the target Mac (or run directly from USB).
2) On the target Mac:

   chmod +x ./INSTALL_ON_NEW_MAC.sh
   ./INSTALL_ON_NEW_MAC.sh

What this installs:
- ArgentOS CLI wrapper at ~/bin/argent
- Gateway LaunchAgent (ai.argent.gateway)
- Dashboard API server on port 9242
- Full stack provisioning by default:
  - PostgreSQL 17 + pgvector (port 5433)
  - Redis (port 6380)
  - Ollama + model checks/pulls
  - Core CLI utilities + steipete toolchain

Provisioning controls (optional):
- ARGENT_FULL_STACK_INSTALL=0              # skip PG/Redis/Ollama/tool provisioning
- ARGENT_INSTALL_STEIPETE_TOOLS=0          # skip steipete/tap CLI installs
- ARGENT_PULL_OLLAMA_MODELS=0              # skip ollama model pull
- ARGENT_OLLAMA_MODELS="qwen3:30b-a3b"     # override required model list

Optional:
- If a DMG is included, the script opens it so you can install Argent.app.

If migrating existing state from another Mac:
- Restore ~/.argentos and your workspace after install.
- Then run: argent doctor && argent gateway restart
README

log "Generating CHECKSUMS.txt"
(
  cd "$OUT_DIR"
  find . -type f \( -name "*.sh" -o -name "*.txt" -o -name "*.tgz" -o -name "*.tar.gz" -o -name "*.dmg" \) \
    ! -name "CHECKSUMS.txt" \
    -print0 | sort -z | xargs -0 shasum -a 256 > CHECKSUMS.txt
)

log "USB installer kit ready"
printf "Output: %s\n" "$OUT_DIR"
printf "Assets:\n"
ls -lh "$ASSETS_DIR"
