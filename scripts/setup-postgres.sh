#!/usr/bin/env bash
#
# ArgentOS PostgreSQL 17 + pgvector setup
#
# Uses port 5433 (not default 5432) to avoid conflicts with existing PG instances.
# Database: argentos
# Extensions: vector (pgvector), pg_trgm (fuzzy text)
#
set -euo pipefail

ARGENT_PG_PORT="${ARGENT_PG_PORT:-5433}"
ARGENT_PG_DB="${ARGENT_PG_DB:-argentos}"
ARGENT_PG_USER="${ARGENT_PG_USER:-${SUDO_USER:-${USER:-argent}}}"

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

configure_linux_postgres_auth() {
  local hba="$1"
  local marker="# ArgentOS local socket auth"

  if grep -Fq "$marker" "$hba" 2>/dev/null; then
    return 0
  fi

  run_root tee -a "$hba" >/dev/null <<EOF

$marker
local   all             ${ARGENT_PG_USER}                                peer
EOF
}

setup_macos() {
  log "=== ArgentOS PostgreSQL Setup (macOS) ==="
  log "Port: ${ARGENT_PG_PORT} (non-default to avoid conflicts)"
  log "Database: ${ARGENT_PG_DB}"
  log ""

  if ! brew list postgresql@17 &>/dev/null; then
    log "Installing PostgreSQL 17..."
    brew install postgresql@17
  else
    log "PostgreSQL 17 already installed"
  fi

  local pg_data
  pg_data="$(brew --prefix)/var/postgresql@17"
  local pg_conf="${pg_data}/postgresql.conf"

  if [[ -f "${pg_conf}" ]]; then
    if grep -q "^port = ${ARGENT_PG_PORT}" "${pg_conf}"; then
      log "Port already set to ${ARGENT_PG_PORT}"
    else
      log "Setting port to ${ARGENT_PG_PORT}..."
      sed -i '' "s/^#*port = .*/port = ${ARGENT_PG_PORT}/" "${pg_conf}"
    fi
  else
    log "Initializing database cluster..."
    "$(brew --prefix)/opt/postgresql@17/bin/initdb" -D "${pg_data}"
    sed -i '' "s/^#*port = .*/port = ${ARGENT_PG_PORT}/" "${pg_conf}"
  fi

  log "Starting PostgreSQL 17 on port ${ARGENT_PG_PORT}..."
  brew services start postgresql@17 >/dev/null 2>&1 || true
  sleep 2

  if ! brew list pgvector &>/dev/null; then
    log "Installing pgvector..."
    brew install pgvector
  else
    log "pgvector already installed"
  fi

  local psql
  psql="$(brew --prefix)/opt/postgresql@17/bin/psql"
  local psql_args=(-P pager=off -p "${ARGENT_PG_PORT}")

  log "Creating database '${ARGENT_PG_DB}'..."
  "${psql}" "${psql_args[@]}" -d postgres -c "CREATE DATABASE ${ARGENT_PG_DB};" 2>/dev/null || true

  log "Enabling extensions..."
  "${psql}" "${psql_args[@]}" -d "${ARGENT_PG_DB}" -c "CREATE EXTENSION IF NOT EXISTS vector;"
  "${psql}" "${psql_args[@]}" -d "${ARGENT_PG_DB}" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"

  log ""
  log "=== Verification ==="
  "${psql}" "${psql_args[@]}" -d "${ARGENT_PG_DB}" -c "SELECT version();" -t
  "${psql}" "${psql_args[@]}" -d "${ARGENT_PG_DB}" -c "SELECT '[1,2,3]'::vector;" -t >/dev/null
  log "pgvector: OK"
  log ""
  log "=== Connection String ==="
  log "postgres://localhost:${ARGENT_PG_PORT}/${ARGENT_PG_DB}"
  log ""
}

setup_linux() {
  if ! command -v apt-get >/dev/null 2>&1; then
    log "Unsupported Linux distribution: apt-get is required for the Ubuntu MVP."
    exit 1
  fi

  log "=== ArgentOS PostgreSQL Setup (Linux) ==="
  log "Port: ${ARGENT_PG_PORT} (non-default to avoid conflicts)"
  log "Database: ${ARGENT_PG_DB}"
  log "Role: ${ARGENT_PG_USER}"
  log ""

  local codename="bookworm"
  if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    source /etc/os-release
    codename="${VERSION_CODENAME:-$codename}"
  fi

  run_root apt-get update -y
  run_root apt-get install -y --no-install-recommends ca-certificates curl gnupg lsb-release

  if [[ ! -f /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc ]]; then
    run_root install -d -m 0755 /usr/share/postgresql-common/pgdg
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      | run_root tee /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc >/dev/null
  fi

  local repo_path="/etc/apt/sources.list.d/pgdg.list"
  if ! run_root test -f "$repo_path" || ! run_root grep -Fq "apt.postgresql.org" "$repo_path"; then
    printf 'deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt %s-pgdg main\n' "$codename" \
      | run_root tee "$repo_path" >/dev/null
  fi

  run_root apt-get update -y
  run_root apt-get install -y --no-install-recommends postgresql-17 postgresql-client-17 postgresql-17-pgvector

  local pg_conf="/etc/postgresql/17/main/postgresql.conf"
  local pg_hba="/etc/postgresql/17/main/pg_hba.conf"

  if ! run_root test -f "$pg_conf"; then
    log "Expected PostgreSQL config not found at $pg_conf"
    exit 1
  fi

  run_root sed -i "s/^#\\?port = .*/port = ${ARGENT_PG_PORT}/" "$pg_conf"
  configure_linux_postgres_auth "$pg_hba"

  if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files >/dev/null 2>&1; then
    run_root systemctl enable postgresql >/dev/null 2>&1 || true
    run_root systemctl restart postgresql
  else
    run_root pg_ctlcluster 17 main restart
  fi
  sleep 2

  run_root -u postgres psql -P pager=off -p "${ARGENT_PG_PORT}" -d postgres \
    -c "CREATE ROLE \"${ARGENT_PG_USER}\" WITH LOGIN SUPERUSER;" 2>/dev/null || true
  run_root -u postgres psql -P pager=off -p "${ARGENT_PG_PORT}" -d postgres \
    -c "CREATE DATABASE ${ARGENT_PG_DB} OWNER \"${ARGENT_PG_USER}\";" 2>/dev/null || true

  local user_psql=(psql -P pager=off -p "${ARGENT_PG_PORT}" -d "${ARGENT_PG_DB}")
  "${user_psql[@]}" -c "CREATE EXTENSION IF NOT EXISTS vector;"
  "${user_psql[@]}" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"

  log ""
  log "=== Verification ==="
  "${user_psql[@]}" -c "SELECT version();" -t
  "${user_psql[@]}" -c "SELECT '[1,2,3]'::vector;" -t >/dev/null
  log "pgvector: OK"
  log ""
  log "=== Connection String ==="
  log "postgresql://${ARGENT_PG_USER}@/${ARGENT_PG_DB}?host=/var/run/postgresql&port=${ARGENT_PG_PORT}"
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

log "Done."
