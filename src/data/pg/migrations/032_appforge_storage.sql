-- ArgentOS PG migration: AppForge durable bases, tables, and records.
-- Core AppForge storage source of truth for gateway-backed Airtable-like data.

CREATE TABLE IF NOT EXISTS appforge_bases (
  id              TEXT PRIMARY KEY,
  app_id          TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  active_table_id TEXT,
  revision        INTEGER NOT NULL DEFAULT 0,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appforge_bases_app
  ON appforge_bases(app_id);

CREATE INDEX IF NOT EXISTS idx_appforge_bases_updated
  ON appforge_bases(updated_at);

CREATE TABLE IF NOT EXISTS appforge_tables (
  id         TEXT PRIMARY KEY,
  base_id    TEXT NOT NULL REFERENCES appforge_bases(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  fields     JSONB NOT NULL DEFAULT '[]',
  revision   INTEGER NOT NULL DEFAULT 0,
  position   INTEGER NOT NULL DEFAULT 0,
  metadata   JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appforge_tables_base
  ON appforge_tables(base_id);

CREATE INDEX IF NOT EXISTS idx_appforge_tables_base_position
  ON appforge_tables(base_id, position);

CREATE TABLE IF NOT EXISTS appforge_records (
  id         TEXT PRIMARY KEY,
  base_id    TEXT NOT NULL REFERENCES appforge_bases(id) ON DELETE CASCADE,
  table_id   TEXT NOT NULL REFERENCES appforge_tables(id) ON DELETE CASCADE,
  "values"   JSONB NOT NULL DEFAULT '{}',
  revision   INTEGER NOT NULL DEFAULT 0,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appforge_records_table
  ON appforge_records(table_id);

CREATE INDEX IF NOT EXISTS idx_appforge_records_base_table
  ON appforge_records(base_id, table_id);

CREATE INDEX IF NOT EXISTS idx_appforge_records_table_updated
  ON appforge_records(table_id, updated_at);

CREATE TABLE IF NOT EXISTS appforge_idempotency_keys (
  idempotency_key TEXT PRIMARY KEY,
  operation       TEXT NOT NULL,
  resource_type   TEXT NOT NULL,
  resource_id     TEXT NOT NULL,
  response        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appforge_idempotency_resource
  ON appforge_idempotency_keys(resource_type, resource_id);

CREATE INDEX IF NOT EXISTS idx_appforge_idempotency_created
  ON appforge_idempotency_keys(created_at);
