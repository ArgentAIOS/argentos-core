#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
RUST_DIR="$ROOT_DIR/rust"
STATE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/argent-execd-smoke.XXXXXX")"
PORT1="${ARGENT_EXECD_SMOKE_PORT:-18819}"
PORT2="$((PORT1 + 1))"
ADDR1="127.0.0.1:${PORT1}"
ADDR2="127.0.0.1:${PORT2}"
LOG1="$STATE_DIR/run-1.log"
LOG2="$STATE_DIR/run-2.log"

cleanup() {
  if [[ -n "${PID1:-}" ]]; then
    kill "$PID1" >/dev/null 2>&1 || true
  fi
  if [[ -n "${PID2:-}" ]]; then
    kill "$PID2" >/dev/null 2>&1 || true
  fi
  rm -rf "$STATE_DIR"
}
trap cleanup EXIT

start_daemon() {
  local addr="$1"
  local log_file="$2"
  (
    cd "$RUST_DIR"
    ARGENT_EXECD_BIND="$addr" \
      ARGENT_EXECD_STATE_DIR="$STATE_DIR" \
      cargo run -p argent-execd >"$log_file" 2>&1
  ) &
  LAST_PID="$!"
}

wait_for_health() {
  local addr="$1"
  for _ in $(seq 1 50); do
    if curl -fsS "http://$addr/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.1
  done
  echo "argent-execd did not become healthy on $addr" >&2
  return 1
}

post_json() {
  local addr="$1"
  local path="$2"
  local json="$3"
  curl --http1.1 --max-time 5 -fsS -X POST "http://$addr$path" \
    -H 'Content-Type: application/json' \
    --data "$json"
}

post_empty() {
  local addr="$1"
  local path="$2"
  curl --http1.1 --max-time 5 -fsS -X POST "http://$addr$path"
}

wait_for_exit() {
  local pid="$1"
  for _ in $(seq 1 50); do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.1
  done
  echo "process $pid did not exit cleanly" >&2
  return 1
}

start_daemon "$ADDR1" "$LOG1"
PID1="$LAST_PID"
wait_for_health "$ADDR1"

curl --http1.1 --max-time 5 -fsS \
  "http://$ADDR1/v1/lanes/request?lane=operator&priority=95&reason=smoke&leaseMs=8000" \
  -X POST >/dev/null
post_empty "$ADDR1" "/v1/executive/tick" >/dev/null

STATE1="$(curl -fsS "http://$ADDR1/v1/executive/state")"
echo "$STATE1" | grep -q '"active_lane": "operator"'

post_empty "$ADDR1" "/v1/executive/shutdown" >/dev/null
wait_for_exit "$PID1"
wait "$PID1" || true
unset PID1

start_daemon "$ADDR2" "$LOG2"
PID2="$LAST_PID"
wait_for_health "$ADDR2"

STATE2="$(curl -fsS "http://$ADDR2/v1/executive/state")"
echo "$STATE2" | grep -q '"active_lane": "operator"'

JOURNAL="$(curl -fsS "http://$ADDR2/v1/executive/journal?limit=10")"
echo "$JOURNAL" | grep -q '"recovered"'

READINESS="$(curl -fsS "http://$ADDR2/v1/executive/readiness")"
echo "$READINESS" | grep -q '"kernelShadow"'
echo "$READINESS" | grep -q '"authority": "shadow"'
echo "$READINESS" | grep -q '"status": "fail-closed"'
echo "$READINESS" | grep -q '"wakefulness": "active"'
echo "$READINESS" | grep -q '"focus": "smoke"'
echo "$READINESS" | grep -q '"reflectionQueue"'
echo "$READINESS" | grep -q '"restartRecovery"'
echo "$READINESS" | grep -q '"status": "recovered"'
echo "$READINESS" | grep -q '"authoritySwitchAllowed": false'
echo "$READINESS" | grep -q '"gateway": "node"'
echo "$READINESS" | grep -q '"executive": "shadow-only"'

post_empty "$ADDR2" "/v1/executive/shutdown" >/dev/null
wait_for_exit "$PID2"
wait "$PID2" || true
unset PID2

echo "argent-execd restart+kernelShadow smoke passed on $ADDR1 -> $ADDR2"
