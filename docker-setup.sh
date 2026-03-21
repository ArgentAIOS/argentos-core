#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"
EXTRA_COMPOSE_FILE="$ROOT_DIR/docker-compose.extra.yml"
IMAGE_NAME="${ARGENT_IMAGE:-${OPENCLAW_IMAGE:-argentos:local}}"
EXTRA_MOUNTS="${ARGENT_EXTRA_MOUNTS:-${OPENCLAW_EXTRA_MOUNTS:-}}"
HOME_VOLUME_NAME="${ARGENT_HOME_VOLUME:-${OPENCLAW_HOME_VOLUME:-}}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing dependency: $1" >&2
    exit 1
  fi
}

require_cmd docker
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose not available (try: docker compose version)" >&2
  exit 1
fi

ARGENT_CONFIG_DIR="${ARGENT_CONFIG_DIR:-${OPENCLAW_CONFIG_DIR:-$HOME/.argentos}}"
ARGENT_WORKSPACE_DIR="${ARGENT_WORKSPACE_DIR:-${OPENCLAW_WORKSPACE_DIR:-$HOME/.argentos/workspace}}"

mkdir -p "$ARGENT_CONFIG_DIR"
mkdir -p "$ARGENT_WORKSPACE_DIR"

export ARGENT_CONFIG_DIR
export ARGENT_WORKSPACE_DIR
export ARGENT_GATEWAY_PORT="${ARGENT_GATEWAY_PORT:-${OPENCLAW_GATEWAY_PORT:-18789}}"
export ARGENT_BRIDGE_PORT="${ARGENT_BRIDGE_PORT:-${OPENCLAW_BRIDGE_PORT:-18790}}"
export ARGENT_GATEWAY_BIND="${ARGENT_GATEWAY_BIND:-${OPENCLAW_GATEWAY_BIND:-lan}}"
export ARGENT_IMAGE="$IMAGE_NAME"
export ARGENT_DOCKER_APT_PACKAGES="${ARGENT_DOCKER_APT_PACKAGES:-${OPENCLAW_DOCKER_APT_PACKAGES:-}}"
export ARGENT_EXTRA_MOUNTS="$EXTRA_MOUNTS"
export ARGENT_HOME_VOLUME="$HOME_VOLUME_NAME"

if [[ -z "${ARGENT_GATEWAY_TOKEN:-${OPENCLAW_GATEWAY_TOKEN:-}}" ]]; then
  if command -v openssl >/dev/null 2>&1; then
    ARGENT_GATEWAY_TOKEN="$(openssl rand -hex 32)"
  else
    ARGENT_GATEWAY_TOKEN="$(python3 - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
)"
  fi
else
  ARGENT_GATEWAY_TOKEN="${ARGENT_GATEWAY_TOKEN:-${OPENCLAW_GATEWAY_TOKEN}}"
fi
export ARGENT_GATEWAY_TOKEN

COMPOSE_FILES=("$COMPOSE_FILE")
COMPOSE_ARGS=()

write_extra_compose() {
  local home_volume="$1"
  shift
  local -a mounts=("$@")
  local mount

  cat >"$EXTRA_COMPOSE_FILE" <<'YAML'
services:
  argent-gateway:
    volumes:
YAML

  if [[ -n "$home_volume" ]]; then
    printf '      - %s:/home/node\n' "$home_volume" >>"$EXTRA_COMPOSE_FILE"
    printf '      - %s:/home/node/.argentos\n' "$ARGENT_CONFIG_DIR" >>"$EXTRA_COMPOSE_FILE"
    printf '      - %s:/home/node/.argentos/workspace\n' "$ARGENT_WORKSPACE_DIR" >>"$EXTRA_COMPOSE_FILE"
  fi

  for mount in "${mounts[@]}"; do
    printf '      - %s\n' "$mount" >>"$EXTRA_COMPOSE_FILE"
  done

  cat >>"$EXTRA_COMPOSE_FILE" <<'YAML'
  argent-cli:
    volumes:
YAML

  if [[ -n "$home_volume" ]]; then
    printf '      - %s:/home/node\n' "$home_volume" >>"$EXTRA_COMPOSE_FILE"
    printf '      - %s:/home/node/.argentos\n' "$ARGENT_CONFIG_DIR" >>"$EXTRA_COMPOSE_FILE"
    printf '      - %s:/home/node/.argentos/workspace\n' "$ARGENT_WORKSPACE_DIR" >>"$EXTRA_COMPOSE_FILE"
  fi

  for mount in "${mounts[@]}"; do
    printf '      - %s\n' "$mount" >>"$EXTRA_COMPOSE_FILE"
  done

  if [[ -n "$home_volume" && "$home_volume" != *"/"* ]]; then
    cat >>"$EXTRA_COMPOSE_FILE" <<YAML
volumes:
  ${home_volume}:
YAML
  fi
}

VALID_MOUNTS=()
if [[ -n "$EXTRA_MOUNTS" ]]; then
  IFS=',' read -r -a mounts <<<"$EXTRA_MOUNTS"
  for mount in "${mounts[@]}"; do
    mount="${mount#"${mount%%[![:space:]]*}"}"
    mount="${mount%"${mount##*[![:space:]]}"}"
    if [[ -n "$mount" ]]; then
      VALID_MOUNTS+=("$mount")
    fi
  done
fi

if [[ -n "$HOME_VOLUME_NAME" || ${#VALID_MOUNTS[@]} -gt 0 ]]; then
  write_extra_compose "$HOME_VOLUME_NAME" "${VALID_MOUNTS[@]}"
  COMPOSE_FILES+=("$EXTRA_COMPOSE_FILE")
fi
for compose_file in "${COMPOSE_FILES[@]}"; do
  COMPOSE_ARGS+=("-f" "$compose_file")
done
COMPOSE_HINT="docker compose"
for compose_file in "${COMPOSE_FILES[@]}"; do
  COMPOSE_HINT+=" -f ${compose_file}"
done

ENV_FILE="$ROOT_DIR/.env"
upsert_env() {
  local file="$1"
  shift
  local -a keys=("$@")
  local tmp
  tmp="$(mktemp)"
  declare -A seen=()

  if [[ -f "$file" ]]; then
    while IFS= read -r line || [[ -n "$line" ]]; do
      local key="${line%%=*}"
      local replaced=false
      for k in "${keys[@]}"; do
        if [[ "$key" == "$k" ]]; then
          printf '%s=%s\n' "$k" "${!k-}" >>"$tmp"
          seen["$k"]=1
          replaced=true
          break
        fi
      done
      if [[ "$replaced" == false ]]; then
        printf '%s\n' "$line" >>"$tmp"
      fi
    done <"$file"
  fi

  for k in "${keys[@]}"; do
    if [[ -z "${seen[$k]:-}" ]]; then
      printf '%s=%s\n' "$k" "${!k-}" >>"$tmp"
    fi
  done

  mv "$tmp" "$file"
}

upsert_env "$ENV_FILE" \
  ARGENT_CONFIG_DIR \
  ARGENT_WORKSPACE_DIR \
  ARGENT_GATEWAY_PORT \
  ARGENT_BRIDGE_PORT \
  ARGENT_GATEWAY_BIND \
  ARGENT_GATEWAY_TOKEN \
  ARGENT_IMAGE \
  ARGENT_EXTRA_MOUNTS \
  ARGENT_HOME_VOLUME \
  ARGENT_DOCKER_APT_PACKAGES

echo "==> Building Docker image: $IMAGE_NAME"
docker build \
  --build-arg "ARGENT_DOCKER_APT_PACKAGES=${ARGENT_DOCKER_APT_PACKAGES}" \
  -t "$IMAGE_NAME" \
  -f "$ROOT_DIR/Dockerfile" \
  "$ROOT_DIR"

echo ""
echo "==> Onboarding (interactive)"
echo "When prompted:"
echo "  - Gateway bind: lan"
echo "  - Gateway auth: token"
echo "  - Gateway token: $ARGENT_GATEWAY_TOKEN"
echo "  - Tailscale exposure: Off"
echo "  - Install Gateway daemon: No"
echo ""
docker compose "${COMPOSE_ARGS[@]}" run --rm argent-cli onboard --no-install-daemon

echo ""
echo "==> Provider setup (optional)"
echo "WhatsApp (QR):"
echo "  ${COMPOSE_HINT} run --rm argent-cli channels login"
echo "Telegram (bot token):"
echo "  ${COMPOSE_HINT} run --rm argent-cli channels add --channel telegram --token <token>"
echo "Discord (bot token):"
echo "  ${COMPOSE_HINT} run --rm argent-cli channels add --channel discord --token <token>"
echo "Docs: https://docs.argentos.ai/channels"

echo ""
echo "==> Starting gateway"
docker compose "${COMPOSE_ARGS[@]}" up -d argent-gateway

echo ""
echo "Gateway running with host port mapping."
echo "Access from tailnet devices via the host's tailnet IP."
echo "Config: $ARGENT_CONFIG_DIR"
echo "Workspace: $ARGENT_WORKSPACE_DIR"
echo "Token: $ARGENT_GATEWAY_TOKEN"
echo ""
echo "Commands:"
echo "  ${COMPOSE_HINT} logs -f argent-gateway"
echo "  ${COMPOSE_HINT} exec argent-gateway node dist/index.js health --token \"$ARGENT_GATEWAY_TOKEN\""
