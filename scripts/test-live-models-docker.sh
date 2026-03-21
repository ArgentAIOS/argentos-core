#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_NAME="${ARGENT_IMAGE:-${CLAWDBOT_IMAGE:-argentos:local}}"
CONFIG_DIR="${ARGENT_CONFIG_DIR:-${CLAWDBOT_CONFIG_DIR:-$HOME/.argentos}}"
WORKSPACE_DIR="${ARGENT_WORKSPACE_DIR:-${CLAWDBOT_WORKSPACE_DIR:-$HOME/.argentos/workspace}}"
PROFILE_FILE="${ARGENT_PROFILE_FILE:-${CLAWDBOT_PROFILE_FILE:-$HOME/.profile}}"

PROFILE_MOUNT=()
if [[ -f "$PROFILE_FILE" ]]; then
  PROFILE_MOUNT=(-v "$PROFILE_FILE":/home/node/.profile:ro)
fi

echo "==> Build image: $IMAGE_NAME"
docker build -t "$IMAGE_NAME" -f "$ROOT_DIR/Dockerfile" "$ROOT_DIR"

echo "==> Run live model tests (profile keys)"
docker run --rm -t \
  --entrypoint bash \
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  -e HOME=/home/node \
  -e NODE_OPTIONS=--disable-warning=ExperimentalWarning \
  -e ARGENT_LIVE_TEST=1 \
  -e ARGENT_LIVE_MODELS="${ARGENT_LIVE_MODELS:-${CLAWDBOT_LIVE_MODELS:-all}}" \
  -e ARGENT_LIVE_PROVIDERS="${ARGENT_LIVE_PROVIDERS:-${CLAWDBOT_LIVE_PROVIDERS:-}}" \
  -e ARGENT_LIVE_MODEL_TIMEOUT_MS="${ARGENT_LIVE_MODEL_TIMEOUT_MS:-${CLAWDBOT_LIVE_MODEL_TIMEOUT_MS:-}}" \
  -e ARGENT_LIVE_REQUIRE_PROFILE_KEYS="${ARGENT_LIVE_REQUIRE_PROFILE_KEYS:-${CLAWDBOT_LIVE_REQUIRE_PROFILE_KEYS:-}}" \
  -v "$CONFIG_DIR":/home/node/.argentos \
  -v "$WORKSPACE_DIR":/home/node/.argentos/workspace \
  "${PROFILE_MOUNT[@]}" \
  "$IMAGE_NAME" \
  -lc "set -euo pipefail; [ -f \"$HOME/.profile\" ] && source \"$HOME/.profile\" || true; cd /app && pnpm test:live"
