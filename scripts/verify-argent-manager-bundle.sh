#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_PATH="${1:-$ROOT_DIR/dist/Argent.app}"

if [[ ! -d "$APP_PATH" ]]; then
  echo "ERROR: App bundle not found: $APP_PATH" >&2
  exit 1
fi

RUNTIME_DIR="$APP_PATH/Contents/Resources/argent-runtime"
NODE_BIN="$RUNTIME_DIR/bin/node"
AGENT_SCRIPT="$RUNTIME_DIR/argent.mjs"

if [[ ! -d "$RUNTIME_DIR" ]]; then
  echo "ERROR: Missing embedded runtime: $RUNTIME_DIR" >&2
  exit 1
fi
if [[ ! -x "$NODE_BIN" ]]; then
  echo "ERROR: Missing embedded node binary: $NODE_BIN" >&2
  exit 1
fi
if [[ ! -f "$AGENT_SCRIPT" ]]; then
  echo "ERROR: Missing embedded CLI entrypoint: $AGENT_SCRIPT" >&2
  exit 1
fi

echo "Verifying static runtime dependency closure..."
"$NODE_BIN" "$ROOT_DIR/scripts/verify-runtime-deps.mjs" "$RUNTIME_DIR"

echo "Running smoke tests in isolated HOME..."
TMP_HOME="$(mktemp -d)"
trap 'rm -rf "$TMP_HOME"' EXIT
mkdir -p "$TMP_HOME"

run_smoke() {
  local subcmd="$1"
  HOME="$TMP_HOME" "$NODE_BIN" "$AGENT_SCRIPT" $subcmd >/dev/null
}

run_smoke "--help"
run_smoke "onboard --help"
run_smoke "daemon --help"
run_smoke "cs --help"

# Validate a known runtime import that previously failed during setup.
HOME="$TMP_HOME" "$NODE_BIN" -e 'import("json5").catch((e)=>{console.error(e);process.exit(1);})'

echo "Embedded app bundle verification passed: $APP_PATH"
