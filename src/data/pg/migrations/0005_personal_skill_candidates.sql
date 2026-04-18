CREATE TABLE IF NOT EXISTS personal_skill_candidates (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  operator_id TEXT,
  profile_id TEXT,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  trigger_patterns JSONB NOT NULL DEFAULT '[]'::jsonb,
  procedure_outline TEXT,
  related_tools JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_memory_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_episode_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_task_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_lesson_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_count INTEGER NOT NULL DEFAULT 0,
  recurrence_count INTEGER NOT NULL DEFAULT 1,
  confidence REAL NOT NULL DEFAULT 0.5,
  state TEXT NOT NULL DEFAULT 'candidate',
  last_reviewed_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_personal_skill_candidates_agent
  ON personal_skill_candidates(agent_id);

CREATE INDEX IF NOT EXISTS idx_personal_skill_candidates_state
  ON personal_skill_candidates(state);

CREATE INDEX IF NOT EXISTS idx_personal_skill_candidates_confidence
  ON personal_skill_candidates(confidence);

CREATE INDEX IF NOT EXISTS idx_personal_skill_candidates_updated
  ON personal_skill_candidates(updated_at DESC);
