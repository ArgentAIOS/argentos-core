#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/argent-install-hosted-local-smoke.XXXXXX")"
trap 'rm -rf "$TMP_ROOT"' EXIT

PKG_DIR="$TMP_ROOT/pkg"
NPM_PREFIX="$TMP_ROOT/npm-global"
mkdir -p "$PKG_DIR"

echo "==> Pack local npm artifact"
(
  cd "$ROOT_DIR"
  npm pack --ignore-scripts --pack-destination "$PKG_DIR" >/dev/null
)
PACKAGE_TGZ="$(find "$PKG_DIR" -maxdepth 1 -name '*.tgz' | head -n1)"
test -f "$PACKAGE_TGZ"

echo "==> Run isolated hosted installer smoke"
(
  cd "$ROOT_DIR"
  ARGENT_INSTALL_PACKAGE_SPEC="$PACKAGE_TGZ" \
  ARGENT_INSTALL_NPM_PREFIX="$NPM_PREFIX" \
  ARGENT_NO_ONBOARD=1 \
  bash ./scripts/install-hosted.sh --install-method npm --no-onboard --no-prompt
)

echo "==> Verify isolated install outputs"
test -x "$NPM_PREFIX/bin/argent"
"$NPM_PREFIX/bin/argent" --help >/dev/null

echo "OK"
