ALTER TABLE personal_skill_candidates
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'operator',
  ADD COLUMN IF NOT EXISTS preconditions JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS execution_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS expected_outcomes JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS supersedes_candidate_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS superseded_by_candidate_id TEXT;

CREATE INDEX IF NOT EXISTS idx_personal_skill_candidates_scope
  ON personal_skill_candidates(scope);
