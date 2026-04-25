#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
RUST_DIR="$ROOT_DIR/rust"
STATE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/argent-execd-lease-soak.XXXXXX")"
PORT="${ARGENT_EXECD_LEASE_SOAK_PORT:-18829}"
ADDR="127.0.0.1:${PORT}"
LOG="$STATE_DIR/soak.log"

cleanup() {
  if [[ -n "${PID:-}" ]]; then
    kill "$PID" >/dev/null 2>&1 || true
  fi
  rm -rf "$STATE_DIR"
}
trap cleanup EXIT

wait_for_health() {
  for _ in $(seq 1 50); do
    if curl -fsS "http://$ADDR/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.1
  done
  echo "argent-execd did not become healthy on $ADDR" >&2
  return 1
}

post_json() {
  local path="$1"
  local json="$2"
  curl --http1.1 --max-time 5 -fsS -X POST "http://$ADDR$path" \
    -H 'Content-Type: application/json' \
    --data "$json"
}

(
  cd "$RUST_DIR"
  ARGENT_EXECD_BIND="$ADDR" \
    ARGENT_EXECD_STATE_DIR="$STATE_DIR" \
    ARGENT_EXECD_DEFAULT_LEASE_MS=120 \
    ARGENT_EXECD_TICK_INTERVAL_MS=10000 \
    cargo run -p argent-execd >"$LOG" 2>&1
) &
PID="$!"

wait_for_health

post_json "/v1/lanes/request" '{"lane":"operator","priority":90,"reason":"interactive","leaseMs":120}' >/dev/null
post_json "/v1/lanes/request" '{"lane":"background","priority":20,"reason":"reconcile","leaseMs":120}' >/dev/null

post_json "/v1/executive/tick" '{"count":1}' >/dev/null
STATE1="$(curl -fsS "http://$ADDR/v1/executive/state")"
echo "$STATE1" | grep -q '"active_lane": "operator"'

sleep 0.2
post_json "/v1/executive/tick" '{"count":1}' >/dev/null
STATE2="$(curl -fsS "http://$ADDR/v1/executive/state")"
echo "$STATE2" | grep -q '"active_lane": "background"'
echo "$STATE2" | grep -q '"last_outcome": "lease_expired"'

JOURNAL="$(curl -fsS "http://$ADDR/v1/executive/journal?limit=20")"
echo "$JOURNAL" | grep -q '"lane_released"'
echo "$JOURNAL" | grep -q '"lease_expired"'
echo "$JOURNAL" | grep -q '"lane_activated"'

post_json "/v1/executive/shutdown" '{"reason":"lease-soak"}' >/dev/null
wait "$PID" || true
unset PID

echo "argent-execd lease soak passed on $ADDR"
