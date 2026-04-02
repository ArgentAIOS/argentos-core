#!/usr/bin/env bash
#
# ArgentOS Redis setup
#
# Uses port 6380 (not default 6379) to avoid conflicts with existing Redis instances.
# Used for: agent state, presence TTLs, inter-agent Streams, dashboard pub/sub, cache.
#
set -euo pipefail

ARGENT_REDIS_PORT="${ARGENT_REDIS_PORT:-6380}"
ARGENT_REDIS_CONF_DIR="${HOME}/.argentos/redis"
ARGENT_REDIS_CONF="${ARGENT_REDIS_CONF_DIR}/redis.conf"
ARGENT_REDIS_DATA="${HOME}/.argentos/redis/data"
ARGENT_REDIS_LOG="${HOME}/.argentos/logs/redis.log"

log() {
  printf '%s\n' "$1"
}

run_root() {
  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

write_redis_config() {
  mkdir -p "${ARGENT_REDIS_CONF_DIR}"
  mkdir -p "${ARGENT_REDIS_DATA}"
  mkdir -p "$(dirname "${ARGENT_REDIS_LOG}")"

  cat > "${ARGENT_REDIS_CONF}" <<EOF
# ArgentOS Redis Configuration
# Port 6380 (non-default to avoid conflicts)

port ${ARGENT_REDIS_PORT}
bind 127.0.0.1
protected-mode yes
daemonize no
pidfile ${ARGENT_REDIS_CONF_DIR}/redis.pid

# Persistence — append-only file for crash recovery
appendonly yes
appendfilename "argentos.aof"
dir ${ARGENT_REDIS_DATA}

# Memory limit — 256MB should be plenty for agent state + cache
maxmemory 256mb
maxmemory-policy allkeys-lru

# Logging
loglevel notice
logfile ${ARGENT_REDIS_LOG}

# Stream consumer group retention
stream-node-max-bytes 4096
stream-node-max-entries 100
EOF
}

setup_macos() {
  log "=== ArgentOS Redis Setup (macOS) ==="
  log "Port: ${ARGENT_REDIS_PORT} (non-default to avoid conflicts)"
  log ""

  if ! brew list redis &>/dev/null; then
    log "Installing Redis..."
    brew install redis
  else
    log "Redis already installed"
  fi

  write_redis_config
  log "Config written to: ${ARGENT_REDIS_CONF}"

  local plist_path="${HOME}/Library/LaunchAgents/ai.argent.redis.plist"
  local redis_server
  redis_server="$(brew --prefix)/bin/redis-server"

  cat > "${plist_path}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>ai.argent.redis</string>
    <key>ProgramArguments</key>
    <array>
        <string>${redis_server}</string>
        <string>${ARGENT_REDIS_CONF}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardErrorPath</key>
    <string>${ARGENT_REDIS_LOG}</string>
</dict>
</plist>
EOF

  log "LaunchAgent written to: ${plist_path}"
  launchctl unload "${plist_path}" 2>/dev/null || true
  launchctl load "${plist_path}"
}

setup_linux() {
  if ! command -v apt-get >/dev/null 2>&1; then
    log "Unsupported Linux distribution: apt-get is required for the Ubuntu MVP."
    exit 1
  fi

  log "=== ArgentOS Redis Setup (Linux) ==="
  log "Port: ${ARGENT_REDIS_PORT} (non-default to avoid conflicts)"
  log ""

  run_root apt-get update -y
  run_root apt-get install -y --no-install-recommends redis-server

  write_redis_config
  log "Config written to: ${ARGENT_REDIS_CONF}"

  local unit_dir="${HOME}/.config/systemd/user"
  local unit_path="${unit_dir}/argent-redis.service"
  mkdir -p "${unit_dir}"
  cat > "${unit_path}" <<EOF
[Unit]
Description=ArgentOS Redis
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/bin/redis-server ${ARGENT_REDIS_CONF}
ExecStop=/usr/bin/redis-cli -p ${ARGENT_REDIS_PORT} shutdown
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF

  if command -v systemctl >/dev/null 2>&1 && systemctl --user status >/dev/null 2>&1; then
    systemctl --user daemon-reload
    systemctl --user enable --now argent-redis.service
  else
    pkill -f "redis-server .*${ARGENT_REDIS_CONF}" 2>/dev/null || true
    /usr/bin/redis-server "${ARGENT_REDIS_CONF}" --daemonize yes
  fi
}

verify_redis() {
  local redis_cli
  if command -v redis-cli >/dev/null 2>&1; then
    redis_cli="$(command -v redis-cli)"
  elif [[ "$(uname -s)" == "Darwin" ]]; then
    redis_cli="$(brew --prefix)/bin/redis-cli"
  else
    redis_cli="/usr/bin/redis-cli"
  fi

  sleep 1
  if "${redis_cli}" -p "${ARGENT_REDIS_PORT}" ping 2>/dev/null | grep -q "PONG"; then
    log "Redis: OK (PONG)"
  else
    log "Redis: FAILED to start — check ${ARGENT_REDIS_LOG}"
    exit 1
  fi

  log ""
  log "=== Redis Info ==="
  "${redis_cli}" -p "${ARGENT_REDIS_PORT}" info server 2>/dev/null | grep -E "redis_version|tcp_port|uptime" || true
  log ""
  log "Config: ${ARGENT_REDIS_CONF}"
  log "Data:   ${ARGENT_REDIS_DATA}"
  log "Log:    ${ARGENT_REDIS_LOG}"
  log ""
}

case "$(uname -s)" in
  Darwin)
    setup_macos
    ;;
  Linux)
    setup_linux
    ;;
  *)
    log "Unsupported OS: $(uname -s)"
    exit 1
    ;;
esac

verify_redis
log "Done."
