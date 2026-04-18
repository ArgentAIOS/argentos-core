CREATE TABLE IF NOT EXISTS personal_skill_reviews (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  actor_type TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_personal_skill_reviews_candidate
  ON personal_skill_reviews(candidate_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_personal_skill_reviews_agent
  ON personal_skill_reviews(agent_id, created_at DESC);
