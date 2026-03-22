#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Skipping local installer smoke: macOS only" >&2
  exit 0
fi

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/argent-install-local-smoke.XXXXXX")"
trap 'rm -rf "$TMP_ROOT"' EXIT

STATE_DIR="$TMP_ROOT/state"
WORKSPACE_DIR="$TMP_ROOT/workspace"
BIN_DIR="$TMP_ROOT/bin"
APP_DEST="$TMP_ROOT/Applications/Argent.app"
LAUNCH_AGENTS_DIR="$TMP_ROOT/LaunchAgents"

echo "==> Run isolated macOS installer smoke"
(
  cd "$ROOT_DIR"
  ARGENT_STATE_DIR="$STATE_DIR" \
  ARGENT_WORKSPACE_DIR="$WORKSPACE_DIR" \
  ARGENT_BIN_DIR="$BIN_DIR" \
  ARGENT_APP_DEST="$APP_DEST" \
  ARGENT_LAUNCH_AGENTS_DIR="$LAUNCH_AGENTS_DIR" \
  ARGENT_SKIP_PROFILE_PATH=1 \
  ARGENT_SKIP_APP_INSTALL=1 \
  ARGENT_SKIP_DASHBOARD_DEPS=1 \
  ARGENT_SKIP_LAUNCH_AGENTS=1 \
  ARGENT_SKIP_SERVICE_START=1 \
  ARGENT_INSTALL_NOTEBOOKLM_TOOLS=0 \
  ARGENT_INSTALL_STEIPETE_TOOLS=0 \
  ARGENT_FULL_STACK_INSTALL=0 \
  bash ./install.sh
)

echo "==> Verify isolated install outputs"
test -f "$STATE_DIR/argent.json"
test -d "$WORKSPACE_DIR/memory/journal"
test -x "$BIN_DIR/argent"
test -L "$BIN_DIR/argentos"
test ! -e "$LAUNCH_AGENTS_DIR/ai.argent.gateway.plist"
test ! -e "$LAUNCH_AGENTS_DIR/ai.argent.dashboard-ui.plist"
test ! -e "$LAUNCH_AGENTS_DIR/ai.argent.dashboard-api.plist"
node -e 'const fs=require("fs"); const cfg=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const token=cfg?.gateway?.auth?.token; if (typeof token !== "string" || token.trim().length === 0) { process.exit(1); }' "$STATE_DIR/argent.json"

"$BIN_DIR/argent" --help >/dev/null

echo "OK"
