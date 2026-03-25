-- ArgentOS PG migration: knowledge observations truth layer
-- Adds governed synthesized beliefs with explicit evidence and supersession history.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS knowledge_observations (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  kind TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT,
  canonical_key TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail TEXT,
  confidence REAL NOT NULL DEFAULT 0.5,
  confidence_components JSONB NOT NULL DEFAULT '{}'::jsonb,
  freshness REAL NOT NULL DEFAULT 1.0,
  revalidation_due_at TIMESTAMPTZ,
  support_count INTEGER NOT NULL DEFAULT 0,
  source_diversity INTEGER NOT NULL DEFAULT 0,
  contradiction_weight REAL NOT NULL DEFAULT 0,
  operator_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'active',
  first_supported_at TIMESTAMPTZ,
  last_supported_at TIMESTAMPTZ,
  last_contradicted_at TIMESTAMPTZ,
  supersedes_observation_id TEXT REFERENCES knowledge_observations(id) ON DELETE SET NULL,
  embedding vector(768),
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  visibility TEXT NOT NULL DEFAULT 'private',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS knowledge_observation_evidence (
  id TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL REFERENCES knowledge_observations(id) ON DELETE CASCADE,
  stance TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  excerpt TEXT,
  item_id TEXT REFERENCES memory_items(id) ON DELETE SET NULL,
  lesson_id TEXT REFERENCES lessons(id) ON DELETE SET NULL,
  reflection_id TEXT REFERENCES reflections(id) ON DELETE SET NULL,
  entity_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
  source_created_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_obs_agent_kind_status
  ON knowledge_observations (agent_id, kind, status);

CREATE INDEX IF NOT EXISTS idx_knowledge_obs_agent_subject_status
  ON knowledge_observations (agent_id, subject_type, subject_id, status);

CREATE INDEX IF NOT EXISTS idx_knowledge_obs_agent_canonical
  ON knowledge_observations (agent_id, canonical_key);

CREATE INDEX IF NOT EXISTS idx_knowledge_obs_agent_revalidation_due
  ON knowledge_observations (agent_id, revalidation_due_at);

CREATE INDEX IF NOT EXISTS idx_knowledge_obs_agent_last_supported
  ON knowledge_observations (agent_id, last_supported_at);

CREATE INDEX IF NOT EXISTS idx_knowledge_obs_agent_confidence_freshness
  ON knowledge_observations (agent_id, confidence DESC, freshness DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_obs_active_canonical_unique
  ON knowledge_observations (agent_id, canonical_key)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_knowledge_obs_embedding
  ON knowledge_observations
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_knowledge_obs_fts
  ON knowledge_observations
  USING gin (
    to_tsvector(
      'english',
      summary || ' ' || COALESCE(detail, '') || ' ' || translate(COALESCE(tags::text, ''), '[]\"', '    ')
    )
  );

CREATE INDEX IF NOT EXISTS idx_knowledge_obs_evidence_observation
  ON knowledge_observation_evidence (observation_id);

CREATE INDEX IF NOT EXISTS idx_knowledge_obs_evidence_stance
  ON knowledge_observation_evidence (stance);

CREATE INDEX IF NOT EXISTS idx_knowledge_obs_evidence_item
  ON knowledge_observation_evidence (item_id);

CREATE INDEX IF NOT EXISTS idx_knowledge_obs_evidence_lesson
  ON knowledge_observation_evidence (lesson_id);

CREATE INDEX IF NOT EXISTS idx_knowledge_obs_evidence_reflection
  ON knowledge_observation_evidence (reflection_id);

CREATE INDEX IF NOT EXISTS idx_knowledge_obs_evidence_entity
  ON knowledge_observation_evidence (entity_id);

ALTER TABLE knowledge_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_observation_evidence ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_own_knowledge_observations ON knowledge_observations
  USING (agent_id = current_setting('app.agent_id', true));

CREATE POLICY family_shared_knowledge_observations ON knowledge_observations
  FOR SELECT USING (visibility IN ('family', 'public'));

CREATE POLICY team_shared_knowledge_observations ON knowledge_observations
  FOR SELECT USING (
    visibility = 'team' AND agent_id IN (
      SELECT tm.session_key FROM team_members tm
      WHERE tm.team_id IN (
        SELECT tm2.team_id FROM team_members tm2
        WHERE tm2.session_key = current_setting('app.agent_id', true)
      )
    )
  );

CREATE POLICY agent_visible_knowledge_observation_evidence ON knowledge_observation_evidence
  USING (
    EXISTS (
      SELECT 1
      FROM knowledge_observations ko
      WHERE ko.id = observation_id
        AND (
          ko.agent_id = current_setting('app.agent_id', true)
          OR ko.visibility IN ('family', 'public')
          OR (
            ko.visibility = 'team'
            AND ko.agent_id IN (
              SELECT tm.session_key FROM team_members tm
              WHERE tm.team_id IN (
                SELECT tm2.team_id FROM team_members tm2
                WHERE tm2.session_key = current_setting('app.agent_id', true)
              )
            )
          )
        )
    )
  );
