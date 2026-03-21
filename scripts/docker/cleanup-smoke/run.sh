#!/usr/bin/env bash
set -euo pipefail

cd /repo

export ARGENT_STATE_DIR="/tmp/argent-test"
export ARGENT_CONFIG_PATH="${ARGENT_STATE_DIR}/argent.json"

echo "==> Build"
pnpm build

echo "==> Seed state"
mkdir -p "${ARGENT_STATE_DIR}/credentials"
mkdir -p "${ARGENT_STATE_DIR}/agents/main/sessions"
echo '{}' >"${ARGENT_CONFIG_PATH}"
echo 'creds' >"${ARGENT_STATE_DIR}/credentials/marker.txt"
echo 'session' >"${ARGENT_STATE_DIR}/agents/main/sessions/sessions.json"

echo "==> Reset (config+creds+sessions)"
pnpm argent reset --scope config+creds+sessions --yes --non-interactive

test ! -f "${ARGENT_CONFIG_PATH}"
test ! -d "${ARGENT_STATE_DIR}/credentials"
test ! -d "${ARGENT_STATE_DIR}/agents/main/sessions"

echo "==> Recreate minimal config"
mkdir -p "${ARGENT_STATE_DIR}/credentials"
echo '{}' >"${ARGENT_CONFIG_PATH}"

echo "==> Uninstall (state only)"
pnpm argent uninstall --state --yes --non-interactive

test ! -d "${ARGENT_STATE_DIR}"

echo "OK"
