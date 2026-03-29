#!/usr/bin/env bash
#
# ArgentOS PostgreSQL 17 + pgvector Setup
#
# Uses port 5433 (not default 5432) to avoid conflicts with existing PG instances.
# Database: argentos
# Extensions: vector (pgvector), pg_trgm (fuzzy text)
#
set -euo pipefail

ARGENT_PG_PORT=5433
ARGENT_PG_DB="argentos"
ARGENT_PG_USER="${USER}"

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

# 2. Configure to use port 5433
PG_DATA="$(brew --prefix)/var/postgresql@17"
PG_CONF="${PG_DATA}/postgresql.conf"

if [ -f "${PG_CONF}" ]; then
  if grep -q "^port = ${ARGENT_PG_PORT}" "${PG_CONF}"; then
    echo "Port already set to ${ARGENT_PG_PORT}"
  else
    echo "Setting port to ${ARGENT_PG_PORT}..."
    sed -i '' "s/^#*port = .*/port = ${ARGENT_PG_PORT}/" "${PG_CONF}"
  fi
else
  echo "Initializing database cluster..."
  "$(brew --prefix)/opt/postgresql@17/bin/initdb" -D "${PG_DATA}"
  sed -i '' "s/^#*port = .*/port = ${ARGENT_PG_PORT}/" "${PG_CONF}"
fi

# 3. Start PostgreSQL
echo "Starting PostgreSQL 17 on port ${ARGENT_PG_PORT}..."
brew services start postgresql@17 2>/dev/null || true
sleep 2

# 4. Install pgvector extension
if ! brew list pgvector &>/dev/null; then
  echo "Installing pgvector..."
  brew install pgvector
else
  echo "pgvector already installed"
fi

# 5. Create database and extensions
PSQL="$(brew --prefix)/opt/postgresql@17/bin/psql"
PSQL_ARGS=(-P pager=off -p "${ARGENT_PG_PORT}")

echo "Creating database '${ARGENT_PG_DB}'..."
"${PSQL}" "${PSQL_ARGS[@]}" -d postgres -c "CREATE DATABASE ${ARGENT_PG_DB};" 2>/dev/null || echo "Database already exists"

echo "Enabling extensions..."
"${PSQL}" "${PSQL_ARGS[@]}" -d "${ARGENT_PG_DB}" -c "CREATE EXTENSION IF NOT EXISTS vector;"
"${PSQL}" "${PSQL_ARGS[@]}" -d "${ARGENT_PG_DB}" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"

# 6. Verify
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
