#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/argent-install-cli-local-smoke.XXXXXX")"
trap 'rm -rf "$TMP_ROOT"' EXIT

PREFIX="$TMP_ROOT/prefix"
PKG_DIR="$TMP_ROOT/pkg"
LOG_FILE="$TMP_ROOT/install.log"
mkdir -p "$PKG_DIR"

echo "==> Pack local npm artifact"
(
  cd "$ROOT_DIR"
  npm pack --ignore-scripts --pack-destination "$PKG_DIR" >/dev/null
)
PACKAGE_TGZ="$(find "$PKG_DIR" -maxdepth 1 -name '*.tgz' | head -n1)"
test -f "$PACKAGE_TGZ"

echo "==> Run isolated CLI installer smoke"
(
  cd "$ROOT_DIR"
  ARGENT_NODE_BIN="$(command -v node)" \
  ARGENT_INSTALL_SOURCE_TGZ="$PACKAGE_TGZ" \
  bash ./install-cli.sh --prefix "$PREFIX" --json --no-onboard --set-npm-prefix
) | tee "$LOG_FILE"

echo "==> Verify isolated install outputs"
test -x "$PREFIX/bin/argent"
test -L "$PREFIX/bin/argentos"
test -x "$PREFIX/runtime/bin/argent"
grep -q '"event":"done"' "$LOG_FILE"
"$PREFIX/bin/argent" --help >/dev/null

echo "OK"
