#!/usr/bin/env bash
set -euo pipefail

# Compatibility shim.
# Single source of truth is scripts/install-hosted.sh.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_INSTALL_SH="$SCRIPT_DIR/install-hosted.sh"

if [[ ! -x "$ROOT_INSTALL_SH" ]]; then
  echo "ERROR: install-hosted.sh not found at $ROOT_INSTALL_SH" >&2
  exit 1
fi

exec "$ROOT_INSTALL_SH" "$@"
