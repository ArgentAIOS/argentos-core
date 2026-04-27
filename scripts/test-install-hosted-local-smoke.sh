#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/argent-install-hosted-local-smoke.XXXXXX")"

cleanup() {
  pkill -f "$TMP_ROOT" 2>/dev/null || true
  sleep 1
  rm -rf "$TMP_ROOT" 2>/dev/null || true
}
trap cleanup EXIT

TEST_HOME="$TMP_ROOT/home"
GIT_DIR="$TMP_ROOT/git-checkout"
BIN_DIR="$TEST_HOME/bin"
PKG_DIR="$TEST_HOME/.argentos/lib/node_modules/argentos"
mkdir -p "$TEST_HOME"

echo "==> Run isolated hosted installer smoke"
(
  cd "$ROOT_DIR"
  HOME="$TEST_HOME" \
  ARGENTOS_GIT_REMOTE="$ROOT_DIR" \
  ARGENTOS_GIT_DIR="$GIT_DIR" \
  ARGENT_INSTALL_BIN_DIR="$BIN_DIR" \
  ARGENT_INSTALL_PACKAGE_DIR="$PKG_DIR" \
  ARGENT_SKIP_APP_INSTALL=1 \
  ARGENT_NO_ONBOARD=1 \
  bash ./scripts/install-hosted.sh --install-method git --no-onboard --no-prompt
)

echo "==> Verify isolated install outputs"
test -x "$BIN_DIR/argent"
grep -F "export ARGENT_GIT_DIR=" "$BIN_DIR/argent" >/dev/null
grep -F "export ARGENT_INSTALL_PACKAGE_DIR=" "$BIN_DIR/argent" >/dev/null
test -f "$TEST_HOME/.argentos/vaults/ArgentOS Core Docs/Home.md"
"$BIN_DIR/argent" --help >/dev/null

echo "OK"
