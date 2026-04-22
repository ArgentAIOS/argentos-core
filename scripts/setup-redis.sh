#!/usr/bin/env bash
#
# ArgentOS Redis Setup
#
# Uses port 6380 (not default 6379) to avoid conflicts with existing Redis instances.
# Used for: agent state, presence TTLs, inter-agent Streams, dashboard pub/sub, cache.
#
set -euo pipefail

ARGENT_REDIS_PORT=6380
ARGENT_REDIS_CONF_DIR="${HOME}/.argentos/redis"
ARGENT_REDIS_CONF="${ARGENT_REDIS_CONF_DIR}/redis.conf"
ARGENT_REDIS_DATA="${HOME}/.argentos/redis/data"
ARGENT_REDIS_LOG="${HOME}/.argentos/logs/redis.log"

echo "=== ArgentOS Redis Setup ==="
echo "Port: ${ARGENT_REDIS_PORT} (non-default to avoid conflicts)"
echo ""

# 1. Install Redis
if ! brew list redis &>/dev/null; then
  echo "Installing Redis..."
  brew install redis
else
  echo "Redis already installed"
fi

# 2. Create ArgentOS Redis config
mkdir -p "${ARGENT_REDIS_CONF_DIR}"
mkdir -p "${ARGENT_REDIS_DATA}"
mkdir -p "$(dirname "${ARGENT_REDIS_LOG}")"

cat > "${ARGENT_REDIS_CONF}" << EOF
# ArgentOS Redis Configuration
# Port 6380 (non-default to avoid conflicts)

port ${ARGENT_REDIS_PORT}
bind 127.0.0.1
protected-mode yes
daemonize no

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

echo "Config written to: ${ARGENT_REDIS_CONF}"

# 3. Create LaunchAgent for auto-start
mkdir -p "${HOME}/Library/LaunchAgents"
PLIST_PATH="${HOME}/Library/LaunchAgents/ai.argent.redis.plist"
REDIS_SERVER="$(brew --prefix)/bin/redis-server"

cat > "${PLIST_PATH}" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>ai.argent.redis</string>
    <key>ProgramArguments</key>
    <array>
        <string>${REDIS_SERVER}</string>
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

echo "LaunchAgent written to: ${PLIST_PATH}"

# 4. Start Redis
echo "Starting Redis on port ${ARGENT_REDIS_PORT}..."
launchctl unload "${PLIST_PATH}" 2>/dev/null || true
launchctl load "${PLIST_PATH}"
sleep 1

# 5. Verify
REDIS_CLI="$(brew --prefix)/bin/redis-cli"
if "${REDIS_CLI}" -p "${ARGENT_REDIS_PORT}" ping 2>/dev/null | grep -q "PONG"; then
  echo "Redis: OK (PONG)"
else
  echo "Redis: FAILED to start — check ${ARGENT_REDIS_LOG}"
  exit 1
fi

echo ""
echo "=== Redis Info ==="
"${REDIS_CLI}" -p "${ARGENT_REDIS_PORT}" info server 2>/dev/null | grep -E "redis_version|tcp_port|uptime"
echo ""
echo "Config: ${ARGENT_REDIS_CONF}"
echo "Data:   ${ARGENT_REDIS_DATA}"
echo "Log:    ${ARGENT_REDIS_LOG}"
echo ""
echo "Done."
