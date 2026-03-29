#!/usr/bin/env bash
# ensure-pg-tables.sh — Create all ArgentOS PG tables if they don't exist.
# Safe to run multiple times (uses CREATE TABLE IF NOT EXISTS).
# Does NOT rename, alter, or drop any existing tables.
set -euo pipefail

PG_PORT="${ARGENT_PG_PORT:-5433}"
PG_DB="${ARGENT_PG_DB:-argentos}"
CONN="postgres://localhost:${PG_PORT}/${PG_DB}"

echo "Ensuring ArgentOS PostgreSQL tables exist (port ${PG_PORT}, db ${PG_DB})..."

psql "$CONN" -v ON_ERROR_STOP=0 <<'SQL'

-- Extensions (idempotent)
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Core tables
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT,
  profile TEXT,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS resources (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL DEFAULT 'argent',
  type TEXT,
  uri TEXT,
  title TEXT,
  summary TEXT,
  embedding TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS memory_items (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL DEFAULT 'argent',
  resource_id TEXT,
  memory_type TEXT,
  summary TEXT,
  embedding TEXT,
  happened_at TIMESTAMPTZ,
  content_hash TEXT,
  reinforcement_count INTEGER DEFAULT 0,
  last_reinforced_at TIMESTAMPTZ,
  extra JSONB DEFAULT '{}',
  emotional_valence REAL,
  emotional_arousal REAL,
  mood_at_capture TEXT,
  significance INTEGER,
  reflection TEXT,
  lesson TEXT,
  visibility TEXT DEFAULT 'private',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS memory_categories (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL DEFAULT 'argent',
  name TEXT,
  description TEXT,
  embedding TEXT,
  parent_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS category_items (
  category_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  PRIMARY KEY (category_id, item_id)
);

CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL DEFAULT 'argent',
  name TEXT,
  entity_type TEXT,
  summary TEXT,
  embedding TEXT,
  metadata JSONB DEFAULT '{}',
  bond_strength REAL DEFAULT 0,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS item_entities (
  item_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  PRIMARY KEY (item_id, entity_id)
);

CREATE TABLE IF NOT EXISTS reflections (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL DEFAULT 'argent',
  trigger_type TEXT,
  trigger_id TEXT,
  content TEXT,
  embedding TEXT,
  insight_type TEXT,
  confidence REAL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL DEFAULT 'argent',
  content TEXT,
  embedding TEXT,
  source_type TEXT,
  source_id TEXT,
  confidence REAL DEFAULT 0.5,
  application_count INTEGER DEFAULT 0,
  last_applied_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS model_feedback (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL DEFAULT 'argent',
  model_id TEXT,
  session_id TEXT,
  rating INTEGER,
  feedback TEXT,
  context JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shared_knowledge (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL DEFAULT 'argent',
  title TEXT,
  content TEXT,
  embedding TEXT,
  source TEXT,
  source_type TEXT,
  citation TEXT,
  metadata JSONB DEFAULT '{}',
  visibility TEXT DEFAULT 'private',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS knowledge_collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  owner_agent_id TEXT NOT NULL DEFAULT 'argent',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS knowledge_collection_grants (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  can_read BOOLEAN DEFAULT TRUE,
  can_write BOOLEAN DEFAULT FALSE,
  is_owner BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS knowledge_observations (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL DEFAULT 'argent',
  collection_id TEXT,
  observation_type TEXT,
  content TEXT,
  embedding TEXT,
  source TEXT,
  confidence REAL DEFAULT 0.5,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS knowledge_observation_evidence (
  id TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL,
  evidence_type TEXT,
  content TEXT,
  source TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL DEFAULT 'argent',
  session_type TEXT,
  title TEXT,
  metadata JSONB DEFAULT '{}',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  agent_id TEXT NOT NULL DEFAULT 'argent',
  observation_type TEXT,
  content TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS team_members (
  team_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  role TEXT DEFAULT 'member',
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (team_id, agent_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL DEFAULT 'argent',
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'todo',
  priority TEXT DEFAULT 'medium',
  source TEXT,
  assignee TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  due_at TIMESTAMPTZ,
  session_id TEXT,
  channel_id TEXT,
  parent_task_id TEXT,
  depends_on TEXT[],
  team_id TEXT,
  project_id TEXT,
  metadata JSONB DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS dispatch_contracts (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL DEFAULT 'argent',
  contract_type TEXT,
  title TEXT,
  description TEXT,
  status TEXT DEFAULT 'pending',
  priority TEXT DEFAULT 'medium',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS dispatch_contract_events (
  id SERIAL PRIMARY KEY,
  contract_id TEXT NOT NULL,
  event_type TEXT,
  payload JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS service_keys (
  id TEXT PRIMARY KEY,
  variable TEXT NOT NULL UNIQUE,
  encrypted_value TEXT,
  name TEXT,
  service TEXT,
  category TEXT,
  enabled BOOLEAN DEFAULT TRUE,
  allowed_roles TEXT[] DEFAULT '{}',
  allowed_agents TEXT[] DEFAULT '{}',
  allowed_teams TEXT[] DEFAULT '{}',
  deny_all BOOLEAN DEFAULT FALSE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_credentials (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL DEFAULT 'argent',
  provider TEXT NOT NULL,
  credential_type TEXT DEFAULT 'api_key',
  encrypted_value TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Job tables
CREATE TABLE IF NOT EXISTS job_templates (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL DEFAULT 'argent',
  title TEXT NOT NULL,
  description TEXT,
  cron_expression TEXT,
  enabled BOOLEAN DEFAULT TRUE,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_assignments (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_runs (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  result JSONB DEFAULT '{}',
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_events (
  id SERIAL PRIMARY KEY,
  template_id TEXT,
  run_id TEXT,
  agent_id TEXT,
  event_type TEXT,
  payload JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Workflow tables
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL DEFAULT 'argent',
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'draft',
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workflow_versions (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  graph JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  version_id TEXT,
  status TEXT DEFAULT 'pending',
  input JSONB DEFAULT '{}',
  output JSONB DEFAULT '{}',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workflow_step_runs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  node_type TEXT,
  status TEXT DEFAULT 'pending',
  input JSONB DEFAULT '{}',
  output JSONB DEFAULT '{}',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

SQL

echo "Done. All tables ensured."
