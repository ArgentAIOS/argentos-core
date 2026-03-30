#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
TSX_LOADER="${ROOT_DIR}/node_modules/tsx/dist/loader.mjs"
TS_SCRIPT="${ROOT_DIR}/scripts/ensure-pg-tables.ts"

if [[ -z "${NODE_BIN}" ]]; then
  echo "Node.js is required to ensure PostgreSQL tables." >&2
  exit 1
fi

if [[ -f "${TSX_LOADER}" ]]; then
  exec "${NODE_BIN}" --import "${TSX_LOADER}" "${TS_SCRIPT}"
fi

if command -v pnpm >/dev/null 2>&1; then
  exec pnpm --dir "${ROOT_DIR}" exec tsx "${TS_SCRIPT}"
fi

echo "Unable to locate tsx runtime. Run pnpm install in ${ROOT_DIR} and retry." >&2
exit 1
