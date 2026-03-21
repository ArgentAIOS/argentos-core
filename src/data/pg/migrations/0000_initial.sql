-- ArgentOS Initial PostgreSQL Migration
-- Requires: PostgreSQL 17+, pgvector extension, pg_trgm extension
-- Port: 5433 (non-default, see ARGENT_PG_PORT)
--
-- This migration creates all tables, then alters embedding columns
-- from TEXT to vector(768), adds HNSW indexes, GIN FTS indexes,
-- and enables RLS policies.

-- ────────────────────────────────────────────────────────────────────
-- Extensions
-- ────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ────────────────────────────────────────────────────────────────────
-- Alter embedding columns: TEXT → vector(768)
-- (Drizzle defines them as TEXT; we fix the actual column type here)
-- ────────────────────────────────────────────────────────────────────

ALTER TABLE resources       ALTER COLUMN embedding TYPE vector(768) USING embedding::vector(768);
ALTER TABLE memory_items    ALTER COLUMN embedding TYPE vector(768) USING embedding::vector(768);
ALTER TABLE memory_categories ALTER COLUMN embedding TYPE vector(768) USING embedding::vector(768);
ALTER TABLE entities        ALTER COLUMN embedding TYPE vector(768) USING embedding::vector(768);
ALTER TABLE lessons         ALTER COLUMN embedding TYPE vector(768) USING embedding::vector(768);
ALTER TABLE shared_knowledge ALTER COLUMN embedding TYPE vector(768) USING embedding::vector(768);

-- ────────────────────────────────────────────────────────────────────
-- HNSW Vector Indexes (cosine similarity)
-- ────────────────────────────────────────────────────────────────────

CREATE INDEX idx_items_embedding ON memory_items
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_entities_embedding ON entities
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_categories_embedding ON memory_categories
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_lessons_embedding ON lessons
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_shared_knowledge_embedding ON shared_knowledge
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ────────────────────────────────────────────────────────────────────
-- GIN Indexes: Full-Text Search (replacing SQLite FTS5)
-- ────────────────────────────────────────────────────────────────────

CREATE INDEX idx_items_fts ON memory_items
  USING gin (to_tsvector('english',
    summary || ' ' || COALESCE(reflection, '') || ' ' || COALESCE(lesson, '')
  ));

CREATE INDEX idx_lessons_fts ON lessons
  USING gin (to_tsvector('english',
    context || ' ' || action || ' ' || outcome || ' ' || lesson || ' ' || COALESCE(correction, '')
  ));

CREATE INDEX idx_tasks_fts ON tasks
  USING gin (to_tsvector('english',
    title || ' ' || COALESCE(description, '')
  ));

CREATE INDEX idx_observations_fts ON observations
  USING gin (to_tsvector('english',
    COALESCE(summary, '') || ' ' || COALESCE(output, '')
  ));

CREATE INDEX idx_categories_fts ON memory_categories
  USING gin (to_tsvector('english',
    name || ' ' || COALESCE(description, '') || ' ' || COALESCE(summary, '')
  ));

CREATE INDEX idx_shared_knowledge_fts ON shared_knowledge
  USING gin (to_tsvector('english',
    title || ' ' || content
  ));

-- ────────────────────────────────────────────────────────────────────
-- GIN Index: JSONB extra field on memory_items
-- ────────────────────────────────────────────────────────────────────

CREATE INDEX idx_items_extra ON memory_items USING gin (extra);

-- ────────────────────────────────────────────────────────────────────
-- pg_trgm indexes for fuzzy text search
-- ────────────────────────────────────────────────────────────────────

CREATE INDEX idx_entities_name_trgm ON entities USING gin (name gin_trgm_ops);
CREATE INDEX idx_items_summary_trgm ON memory_items USING gin (summary gin_trgm_ops);

-- ────────────────────────────────────────────────────────────────────
-- Row-Level Security (RLS) — multi-agent isolation
-- ────────────────────────────────────────────────────────────────────
-- Each connection sets: SELECT set_config('app.agent_id', '<id>', false)
-- See pg-client.ts setAgentContext()

-- Enable RLS on all agent-scoped tables
ALTER TABLE resources         ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE entities          ENABLE ROW LEVEL SECURITY;
ALTER TABLE reflections       ENABLE ROW LEVEL SECURITY;
ALTER TABLE lessons           ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_feedback    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE observations      ENABLE ROW LEVEL SECURITY;

-- Policy: Agent sees own data
CREATE POLICY agent_own_resources ON resources
  USING (agent_id = current_setting('app.agent_id', true));

CREATE POLICY agent_own_items ON memory_items
  USING (agent_id = current_setting('app.agent_id', true));

CREATE POLICY agent_own_categories ON memory_categories
  USING (agent_id = current_setting('app.agent_id', true));

CREATE POLICY agent_own_entities ON entities
  USING (agent_id = current_setting('app.agent_id', true));

CREATE POLICY agent_own_reflections ON reflections
  USING (agent_id = current_setting('app.agent_id', true));

CREATE POLICY agent_own_lessons ON lessons
  USING (agent_id = current_setting('app.agent_id', true));

CREATE POLICY agent_own_feedback ON model_feedback
  USING (agent_id = current_setting('app.agent_id', true));

CREATE POLICY agent_own_sessions ON sessions
  USING (agent_id = current_setting('app.agent_id', true));

CREATE POLICY agent_own_observations ON observations
  USING (agent_id = current_setting('app.agent_id', true));

-- Policy: Family-visible data (visibility = 'family' or 'public')
CREATE POLICY family_shared_items ON memory_items
  FOR SELECT USING (visibility IN ('family', 'public'));

CREATE POLICY family_shared_entities ON entities
  FOR SELECT USING (visibility IN ('family', 'public'));

CREATE POLICY family_shared_lessons ON lessons
  FOR SELECT USING (visibility IN ('family', 'public'));

CREATE POLICY family_shared_resources ON resources
  FOR SELECT USING (visibility IN ('family', 'public'));

-- Policy: Team-visible data (visibility = 'team')
-- Agents on the same team can see team-scoped data
CREATE POLICY team_shared_items ON memory_items
  FOR SELECT USING (
    visibility = 'team' AND agent_id IN (
      SELECT tm.session_key FROM team_members tm
      WHERE tm.team_id IN (
        SELECT tm2.team_id FROM team_members tm2
        WHERE tm2.session_key = current_setting('app.agent_id', true)
      )
    )
  );

-- Shared knowledge is always readable by all agents (no RLS needed)
-- It already has source_agent_id for provenance tracking
