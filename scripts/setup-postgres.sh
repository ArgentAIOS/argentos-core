#!/usr/bin/env bash
#
# ArgentOS PostgreSQL 17 + pgvector Setup
#
# Uses port 5433 (not default 5432) to avoid conflicts with existing PG
# instances. Database: argentos. Extensions: vector (pgvector), pg_trgm.
#
# Safety:
#  - If postgresql@17 is ALREADY running for some other purpose (port != 5433),
#    we refuse to silently repurpose it. Set ARGENT_PG_REPURPOSE_EXISTING=1 to
#    consent to taking over the existing Homebrew service.
#  - When ARGENT_PG_REPURPOSE_EXISTING=1 IS set, we snapshot the existing
#    cluster via pg_dumpall to ~/.argentos/backups/ BEFORE rewriting the
#    port. If the dump fails, the takeover aborts. (See GH #278.)
#  - After applying config, we use `brew services restart` (not `start`) so a
#    port-change rewrite is picked up even when the service was already running.
#  - If we can't reach our postgres on port 5433 after restart, we diagnose
#    whether someone else holds the port and emit a clear error.
#
# Idempotent: re-running this script after a successful install is a no-op.
#
set -euo pipefail

ARGENT_PG_PORT=5433
ARGENT_PG_DB="argentos"
ARGENT_PG_USER="${USER}"
ARGENT_PG_REPURPOSE_EXISTING="${ARGENT_PG_REPURPOSE_EXISTING:-}"

echo "=== ArgentOS PostgreSQL Setup ==="
echo "Port: ${ARGENT_PG_PORT} (non-default to avoid conflicts)"
echo "Database: ${ARGENT_PG_DB}"
echo ""

# 1. Install PostgreSQL 17
if ! brew list postgresql@17 &>/dev/null; then
  echo "Installing PostgreSQL 17..."
  brew install postgresql@17
else
  echo "PostgreSQL 17 already installed"
fi

BREW_PREFIX="$(brew --prefix)"
PG_DATA="${BREW_PREFIX}/var/postgresql@17"
PG_CONF="${PG_DATA}/postgresql.conf"
PG_LOG="${BREW_PREFIX}/var/log/postgresql@17.log"
PG_BIN_DIR="${BREW_PREFIX}/opt/postgresql@17/bin"
PSQL="${PG_BIN_DIR}/psql"

# ---- Helpers ---------------------------------------------------------------

pg_service_is_running() {
  # brew services list row format:
  #   postgresql@17 started <user> <plist>
  # Match "started" or "scheduled" in the status column.
  brew services list 2>/dev/null \
    | awk '$1 == "postgresql@17" { print $2 }' \
    | grep -Eq '^(started|scheduled)$'
}

pg_configured_port() {
  # Read the active (uncommented) port directive from postgresql.conf.
  # Returns empty string if conf is missing or no explicit port line.
  if [[ -f "${PG_CONF}" ]]; then
    awk '
      /^[[:space:]]*#/ { next }
      {
        line = $0
        sub(/#.*$/, "", line)
        if (line ~ /^[[:space:]]*port[[:space:]]*=/) {
          sub(/^[[:space:]]*port[[:space:]]*=[[:space:]]*/, "", line)
          gsub(/[[:space:]].*$/, "", line)
          print line
          exit
        }
      }
    ' "${PG_CONF}" 2>/dev/null
  fi
}

# Detect whether the live cluster has user databases (anything beyond the
# default catalog dbs and ours). "unknown" if we can't enumerate.
pg_data_state() {
  local port="$1"
  local out
  if ! out="$(PGCONNECT_TIMEOUT=2 "${PSQL}" -w -h 127.0.0.1 -p "${port}" \
        -d postgres -tAc \
        "SELECT datname FROM pg_database WHERE datname NOT IN ('postgres','template0','template1','${ARGENT_PG_DB}');" \
        2>/dev/null)"; then
    echo "unknown"
    return
  fi
  if [[ -n "${out//[[:space:]]/}" ]]; then
    echo "has_data"
  else
    echo "empty"
  fi
}

port_listener_info() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true
  fi
}

# ---- 2. Detect pre-state BEFORE rewriting anything -------------------------

SERVICE_WAS_RUNNING=0
PRE_PORT=""
if pg_service_is_running; then
  SERVICE_WAS_RUNNING=1
  PRE_PORT="$(pg_configured_port || true)"
  echo "Detected postgresql@17 already running (configured port: ${PRE_PORT:-default 5432})"

  # If the running service is on a port that ISN'T already ours, we are about
  # to repurpose someone else's database. Demand explicit consent if there's
  # any chance of user data (or if we can't tell).
  if [[ "${PRE_PORT}" != "${ARGENT_PG_PORT}" ]]; then
    probe_port="${PRE_PORT:-5432}"
    data_state="$(pg_data_state "${probe_port}")"
    if [[ "${data_state}" != "empty" ]]; then
      if [[ -z "${ARGENT_PG_REPURPOSE_EXISTING}" ]]; then
        cat >&2 <<EOF

============================================================
REFUSING TO REPURPOSE EXISTING postgresql@17

A Homebrew postgresql@17 service is already running on port
${probe_port}, and ArgentOS Core wants to reconfigure it to
listen on ${ARGENT_PG_PORT} instead.

Detected data state on port ${probe_port}: ${data_state}
  (has_data = user databases present; unknown = couldn't
   enumerate, possibly because auth is required)

Reconfiguring will restart that service. Any application
currently pointed at port ${probe_port} will need to be
updated to use port ${ARGENT_PG_PORT}.

Options:
  1) Stop the other use of postgresql@17 first, then re-run
     the installer (recommended for fresh installs).
  2) Set ARGENT_PG_REPURPOSE_EXISTING=1 to explicitly opt
     in to taking over this Homebrew service, then re-run.

Aborting PostgreSQL setup. (See GH #109.)
============================================================
EOF
        exit 2
      fi
      echo "ARGENT_PG_REPURPOSE_EXISTING=1 set; proceeding to reconfigure."

      # ---- 2b. Snapshot existing cluster BEFORE reconfigure (GH #278) ----
      # User has consented to repurpose someone else's postgres@17. Before
      # we rewrite the port and restart the service, dump everything to a
      # known location so they can recover if something goes wrong. If the
      # dump fails (any non-zero exit), abort the takeover — we will not
      # proceed without a snapshot.
      PG_BACKUP_DIR="${HOME}/.argentos/backups"
      if ! mkdir -p "${PG_BACKUP_DIR}"; then
        echo "ERROR: could not create backup directory ${PG_BACKUP_DIR}" >&2
        exit 3
      fi
      PG_BACKUP_FILE="${PG_BACKUP_DIR}/postgres-pre-takeover-$(date +%Y%m%d-%H%M%S).sql"
      PG_DUMPALL="${PG_BIN_DIR}/pg_dumpall"

      echo "Snapshotting postgresql@17 (port ${probe_port}) -> ${PG_BACKUP_FILE}"
      # -w: never prompt for a password — fail fast if auth is required so
      #     we surface a clear error instead of hanging the installer.
      if ! "${PG_DUMPALL}" -h 127.0.0.1 -p "${probe_port}" -w \
            -f "${PG_BACKUP_FILE}"; then
        cat >&2 <<EOF

============================================================
ERROR: pg_dumpall failed before postgresql@17 takeover

ArgentOS Core was about to reconfigure the existing
postgresql@17 service (port ${probe_port} -> ${ARGENT_PG_PORT}),
but could not snapshot the current cluster via pg_dumpall.

Aborting the takeover — we will NOT reconfigure the port
without a recoverable snapshot. (See GH #278.)

Possible causes:
  - Authentication required. pg_dumpall was invoked with -w
    (no password prompt). Set up ~/.pgpass for
    127.0.0.1:${probe_port} (or export PGPASSWORD) and re-run.
  - The dump partially wrote to:
      ${PG_BACKUP_FILE}
    Inspect / delete that file before retrying.
============================================================
EOF
        exit 3
      fi
      echo "Pre-takeover snapshot written: ${PG_BACKUP_FILE}"
    fi
  fi
fi

# ---- 3. Configure port + initialize cluster if absent ----------------------

PORT_REWRITTEN=0
if [ -f "${PG_CONF}" ]; then
  if grep -Eq "^[[:space:]]*port[[:space:]]*=[[:space:]]*${ARGENT_PG_PORT}([[:space:]]|\$|#)" "${PG_CONF}"; then
    echo "Port already set to ${ARGENT_PG_PORT}"
  else
    echo "Setting port to ${ARGENT_PG_PORT}..."
    sed -E -i '' "s/^[[:space:]]*#?[[:space:]]*port[[:space:]]*=.*/port = ${ARGENT_PG_PORT}/" "${PG_CONF}"
    PORT_REWRITTEN=1
  fi
else
  echo "Initializing database cluster..."
  "${PG_BIN_DIR}/initdb" -D "${PG_DATA}"
  sed -E -i '' "s/^[[:space:]]*#?[[:space:]]*port[[:space:]]*=.*/port = ${ARGENT_PG_PORT}/" "${PG_CONF}"
  PORT_REWRITTEN=1
fi

# ---- 4. Start or RESTART (start is a no-op when already running) ----------

if [[ "${SERVICE_WAS_RUNNING}" -eq 1 ]]; then
  if [[ "${PORT_REWRITTEN}" -eq 1 ]]; then
    echo "Restarting PostgreSQL 17 to apply config (was already running)..."
    brew services restart postgresql@17 2>/dev/null || true
  else
    echo "PostgreSQL 17 already running with desired config; no restart needed"
  fi
else
  echo "Starting PostgreSQL 17 on port ${ARGENT_PG_PORT}..."
  brew services start postgresql@17 2>/dev/null || true
fi

# ---- 5. Wait for PostgreSQL to accept connections on OUR port -------------

wait_for_pg_port() {
  local port="$1"
  local i
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    if "${PSQL}" -h 127.0.0.1 -p "${port}" -d postgres -c "SELECT 1;" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

if ! wait_for_pg_port "${ARGENT_PG_PORT}"; then
  echo "" >&2
  listener_info="$(port_listener_info "${ARGENT_PG_PORT}")"
  if [[ -n "${listener_info}" ]]; then
    cat >&2 <<EOF
============================================================
ERROR: Port ${ARGENT_PG_PORT} is held by another process

ArgentOS Core couldn't connect to PostgreSQL on port
${ARGENT_PG_PORT}, but something IS listening there:

${listener_info}

Free port ${ARGENT_PG_PORT} (stop that process) and re-run
the installer, or change Argent's PG port. (See GH #109.)
============================================================
EOF
  else
    log_tail="(log file ${PG_LOG} not found)"
    if [[ -f "${PG_LOG}" ]]; then
      log_tail="$(tail -n 30 "${PG_LOG}" 2>/dev/null || true)"
    fi
    cat >&2 <<EOF
============================================================
ERROR: PostgreSQL 17 did not come up on port ${ARGENT_PG_PORT}

Common causes:
  - 'brew services restart postgresql@17' did not pick up
    the config change. Try:
      brew services stop postgresql@17
      brew services start postgresql@17
    then re-run this installer.
  - The Homebrew config at:
      ${PG_CONF}
    does not contain 'port = ${ARGENT_PG_PORT}'.

Last lines of PostgreSQL log:
${log_tail}
============================================================
EOF
  fi
  exit 1
fi

# ---- 6. Install pgvector --------------------------------------------------

if ! brew list pgvector &>/dev/null; then
  echo "Installing pgvector..."
  brew install pgvector
else
  echo "pgvector already installed"
fi

# ---- 7. Create database + enable extensions --------------------------------

PSQL_ARGS=(-P pager=off -p "${ARGENT_PG_PORT}")

echo "Creating database '${ARGENT_PG_DB}'..."
"${PSQL}" "${PSQL_ARGS[@]}" -d postgres -c "CREATE DATABASE ${ARGENT_PG_DB};" 2>/dev/null || echo "Database already exists"

echo "Enabling extensions..."
"${PSQL}" "${PSQL_ARGS[@]}" -d "${ARGENT_PG_DB}" -c "CREATE EXTENSION IF NOT EXISTS vector;"
"${PSQL}" "${PSQL_ARGS[@]}" -d "${ARGENT_PG_DB}" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"

# ---- 8. Verify ------------------------------------------------------------

echo ""
echo "=== Verification ==="
"${PSQL}" "${PSQL_ARGS[@]}" -d "${ARGENT_PG_DB}" -c "SELECT version();" -t
"${PSQL}" "${PSQL_ARGS[@]}" -d "${ARGENT_PG_DB}" -c "SELECT '[1,2,3]'::vector;" -t && echo "pgvector: OK" || echo "pgvector: FAILED"

echo ""
echo "=== Connection String ==="
echo "postgres://localhost:${ARGENT_PG_PORT}/${ARGENT_PG_DB}"
echo ""
echo "Add to ~/.argentos/argent.json:"
echo '  "storage": {'
echo '    "backend": "dual",'
echo '    "readFrom": "sqlite",'
echo '    "writeTo": ["sqlite", "postgres"],'
echo "    \"postgres\": { \"connectionString\": \"postgres://localhost:${ARGENT_PG_PORT}/${ARGENT_PG_DB}\" },"
echo '    "redis": { "host": "127.0.0.1", "port": 6380 }'
echo '  }'
echo ""
echo "Done."
