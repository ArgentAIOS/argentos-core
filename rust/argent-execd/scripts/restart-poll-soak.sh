#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
RUST_DIR="$ROOT_DIR/rust"
BIN_PATH="$RUST_DIR/target/debug/argent-execd"
STATE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/argent-execd-restart-poll-soak.XXXXXX")"
PORT_BASE="${ARGENT_EXECD_RESTART_POLL_SOAK_PORT:-18839}"
CYCLES="${ARGENT_EXECD_RESTART_POLL_SOAK_CYCLES:-3}"
TICKS_PER_CYCLE="${ARGENT_EXECD_RESTART_POLL_SOAK_TICKS:-3}"
LOG_DIR="$STATE_DIR/logs"
mkdir -p "$LOG_DIR"

cleanup() {
  if [[ -n "${PID:-}" ]]; then
    kill "$PID" >/dev/null 2>&1 || true
  fi
  rm -rf "$STATE_DIR"
}
trap cleanup EXIT

on_term() {
  exit 0
}
trap on_term TERM INT

start_daemon() {
  local addr="$1"
  local log_file="$2"
  (
    trap '' TERM INT
    ARGENT_EXECD_BIND="$addr" \
      ARGENT_EXECD_STATE_DIR="$STATE_DIR" \
      ARGENT_EXECD_TICK_INTERVAL_MS=10000 \
      ARGENT_EXECD_DEFAULT_LEASE_MS=8000 \
      "$BIN_PATH" >"$log_file" 2>&1
  ) &
  LAST_PID="$!"
}

wait_for_health() {
  local addr="$1"
  for _ in $(seq 1 60); do
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

for cycle in $(seq 1 "$CYCLES"); do
  port=$((PORT_BASE + cycle - 1))
  addr="127.0.0.1:${port}"
  log_file="$LOG_DIR/cycle-${cycle}.log"
  start_daemon "$addr" "$log_file"
  PID="$LAST_PID"
  wait_for_health "$addr"

  if [[ "$cycle" -eq 1 ]]; then
    post_json "$addr" "/v1/lanes/request" '{"lane":"operator","priority":95,"reason":"restart-poll-soak","leaseMs":8000}' >/dev/null
  fi

  for _ in $(seq 1 "$TICKS_PER_CYCLE"); do
    post_json "$addr" "/v1/executive/tick" '{"count":1}' >/dev/null
    health="$(curl -fsS "http://$addr/health")"
    metrics="$(curl -fsS "http://$addr/v1/executive/metrics")"
    state="$(curl -fsS "http://$addr/v1/executive/state")"
    timeline="$(curl -fsS "http://$addr/v1/executive/timeline?limit=10")"
    echo "$health" | grep -q '"status":"ok"'
    echo "$metrics" | grep -Eq '"activeLane"\s*:\s*"operator"'
    echo "$state" | grep -Eq '"active_lane"\s*:\s*"operator"'
    echo "$timeline" | grep -Eq '"lane_activated"'
  done

  post_json "$addr" "/v1/executive/shutdown" "{\"reason\":\"restart-poll-soak-cycle-${cycle}\"}" >/dev/null
  wait_for_exit "$PID"
  wait "$PID" || true
  unset PID
done

echo "argent-execd restart+poll soak passed for ${CYCLES} cycles"
