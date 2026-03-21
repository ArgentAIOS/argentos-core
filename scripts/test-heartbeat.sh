#!/usr/bin/env bash
# test-heartbeat.sh — Force a heartbeat run and watch the results
#
# Usage:
#   ./scripts/test-heartbeat.sh              # Run full heartbeat
#   ./scripts/test-heartbeat.sh --task email  # Force a specific task (filters prompt)
#   ./scripts/test-heartbeat.sh --watch       # Watch the progress file live
#   ./scripts/test-heartbeat.sh --ground-truth # Test ground truth collection only
#
set -euo pipefail

GATEWAY_PORT="${ARGENT_GATEWAY_PORT:-18789}"
GATEWAY_TOKEN="${ARGENT_GATEWAY_TOKEN:-}"
if [[ -z "$GATEWAY_TOKEN" ]] && command -v jq &>/dev/null; then
  GATEWAY_TOKEN="$(jq -r '.gateway.auth.token // empty' ~/.argentos/argent.json 2>/dev/null || true)"
fi
GATEWAY_URL="http://localhost:${GATEWAY_PORT}"
PROGRESS_FILE="${HOME}/argent/memory/heartbeat-progress.json"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

case "${1:-}" in
  --watch)
    echo -e "${CYAN}Watching heartbeat progress...${NC}"
    echo -e "${YELLOW}File: ${PROGRESS_FILE}${NC}"
    echo "---"
    if command -v jq &>/dev/null; then
      watch -n 2 "cat '$PROGRESS_FILE' 2>/dev/null | jq '.tasks | to_entries[] | {task: .key, status: .value.status, attempts: .value.attempts, result: .value.lastResult}' 2>/dev/null || echo 'No progress file yet'"
    else
      watch -n 2 "cat '$PROGRESS_FILE' 2>/dev/null || echo 'No progress file yet'"
    fi
    exit 0
    ;;
  --ground-truth)
    echo -e "${CYAN}Testing ground truth collection...${NC}"

    EMAIL_KEY="${MOLTYVERSE_EMAIL_API_KEY:-}"
    MOLTY_KEY="${MOLTYVERSE_API_KEY:-}"

    if [[ -z "$EMAIL_KEY" ]]; then
      # Try to read from argent.json
      EMAIL_KEY=$(jq -r '.env.vars.MOLTYVERSE_EMAIL_API_KEY // empty' ~/.argentos/argent.json 2>/dev/null || true)
    fi
    if [[ -z "$MOLTY_KEY" ]]; then
      MOLTY_KEY=$(jq -r '.env.vars.MOLTYVERSE_API_KEY // empty' ~/.argentos/argent.json 2>/dev/null || true)
    fi

    echo -e "\n${YELLOW}Email ground truth:${NC}"
    if [[ -n "$EMAIL_KEY" ]]; then
      RESULT=$(curl -s -H "Authorization: Bearer ${EMAIL_KEY}" "https://api.moltyverse.email/api/messages" 2>/dev/null)
      TOTAL=$(echo "$RESULT" | jq '.messages | length' 2>/dev/null || echo "?")
      UNREAD=$(echo "$RESULT" | jq '[.messages[] | select(.read == false and .direction == "inbound")] | length' 2>/dev/null || echo "?")
      echo -e "  Total messages: ${TOTAL}"
      echo -e "  Unread inbound: ${GREEN}${UNREAD}${NC}"
      if [[ "$UNREAD" != "0" && "$UNREAD" != "?" ]]; then
        echo -e "  ${YELLOW}Unread from:${NC}"
        echo "$RESULT" | jq -r '.messages[] | select(.read == false and .direction == "inbound") | "    - \(.from): \"\(.subject)\""' 2>/dev/null || true
      fi
    else
      echo -e "  ${RED}No MOLTYVERSE_EMAIL_API_KEY found${NC}"
    fi

    echo -e "\n${YELLOW}Moltyverse social ground truth:${NC}"
    if [[ -n "$MOLTY_KEY" ]]; then
      NOTIFS=$(curl -s -H "Authorization: Bearer ${MOLTY_KEY}" "https://api.moltyverse.app/api/v1/notifications" 2>/dev/null)
      TOTAL_N=$(echo "$NOTIFS" | jq '.notifications | length' 2>/dev/null || echo "?")
      UNREAD_N=$(echo "$NOTIFS" | jq '[.notifications[] | select(.read == false)] | length' 2>/dev/null || echo "?")
      echo -e "  Total notifications: ${TOTAL_N}"
      echo -e "  Unread: ${GREEN}${UNREAD_N}${NC}"

      POSTS=$(curl -s -H "Authorization: Bearer ${MOLTY_KEY}" "https://api.moltyverse.app/api/v1/posts?author=me&limit=5" 2>/dev/null)
      TOTAL_P=$(echo "$POSTS" | jq '.posts | length' 2>/dev/null || echo "?")
      echo -e "  Recent posts: ${TOTAL_P}"
    else
      echo -e "  ${RED}No MOLTYVERSE_API_KEY found${NC}"
    fi

    echo -e "\n${GREEN}Done.${NC}"
    exit 0
    ;;
  --progress)
    echo -e "${CYAN}Current heartbeat progress:${NC}"
    if [[ -f "$PROGRESS_FILE" ]]; then
      if command -v jq &>/dev/null; then
        jq '{ cycleCount, lastCycleAt: (.lastCycleAt | . / 1000 | strftime("%Y-%m-%d %H:%M:%S UTC")), tasks: (.tasks | to_entries | map({key: .key, status: .value.status, attempts: .value.attempts, result: .value.lastResult}) | from_entries) }' "$PROGRESS_FILE"
      else
        cat "$PROGRESS_FILE"
      fi
    else
      echo -e "${YELLOW}No progress file yet.${NC}"
    fi
    exit 0
    ;;
esac

# Force a heartbeat via the gateway's wake endpoint
echo -e "${CYAN}Forcing heartbeat run...${NC}"

# The gateway exposes requestHeartbeatNow via WebSocket
# We can trigger it by sending a system command through the gateway API
AUTH_HEADER=()
if [[ -n "$GATEWAY_TOKEN" ]]; then
  AUTH_HEADER=(-H "Authorization: Bearer ${GATEWAY_TOKEN}")
else
  echo -e "${YELLOW}No gateway token found in ARGENT_GATEWAY_TOKEN or ~/.argentos/argent.json.${NC}"
  echo -e "${YELLOW}Continuing without Authorization header (will fail if gateway auth is enabled).${NC}"
fi

RESPONSE=$(curl -s -X POST "${GATEWAY_URL}/api/heartbeat/trigger" \
  "${AUTH_HEADER[@]}" \
  -H "Content-Type: application/json" \
  -d '{"reason": "manual-test"}' 2>/dev/null || echo "FETCH_FAILED")

if [[ "$RESPONSE" == "FETCH_FAILED" ]]; then
  echo -e "${YELLOW}No /api/heartbeat/trigger endpoint. Trying WebSocket wake...${NC}"
  # Fallback: just show the current state and tell user to wait
  echo -e "${YELLOW}The gateway doesn't have a direct trigger endpoint yet.${NC}"
  echo -e "The heartbeat will run on its normal schedule (check argent.json 'every' setting)."
  echo -e "\nUse ${CYAN}--progress${NC} to check current state, or ${CYAN}--watch${NC} to watch live."
else
  echo -e "${GREEN}Trigger response: ${RESPONSE}${NC}"
fi

echo ""
echo -e "${CYAN}Heartbeat progress:${NC}"
if [[ -f "$PROGRESS_FILE" ]]; then
  if command -v jq &>/dev/null; then
    jq '.tasks | to_entries[] | "\(.key): \(.value.status) (attempts: \(.value.attempts))"' "$PROGRESS_FILE" | tr -d '"'
  else
    cat "$PROGRESS_FILE"
  fi
else
  echo -e "${YELLOW}No progress file yet — first heartbeat hasn't run.${NC}"
fi
