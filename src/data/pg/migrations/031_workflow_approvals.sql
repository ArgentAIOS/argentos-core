-- ArgentOS PG migration: Workflow approval audit records
-- Durable operator approvals for workflow gate nodes and unsafe side effects.

CREATE TABLE IF NOT EXISTS workflow_approvals (
  id                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  run_id                  TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  workflow_id             TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  node_id                 TEXT NOT NULL,
  workflow_name           TEXT,
  node_label              TEXT,
  message                 TEXT NOT NULL,
  side_effect_class       TEXT,
  previous_output_preview JSONB,
  approve_action          JSONB DEFAULT '{}',
  deny_action             JSONB DEFAULT '{}',
  timeout_at              TIMESTAMPTZ,
  timeout_action          TEXT DEFAULT 'deny'
    CHECK (timeout_action IN ('approve','deny')),
  status                  TEXT DEFAULT 'pending'
    CHECK (status IN ('pending','approved','denied','edited','escalated','timed_out')),
  requested_at            TIMESTAMPTZ DEFAULT NOW(),
  resolved_at             TIMESTAMPTZ,
  resolved_by             TEXT,
  resolution_note         TEXT,
  notification_status     TEXT DEFAULT 'pending',
  notification_error      TEXT,
  metadata                JSONB DEFAULT '{}',
  UNIQUE (run_id, node_id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_approvals_pending
  ON workflow_approvals(status, requested_at DESC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_workflow_approvals_run
  ON workflow_approvals(run_id);

CREATE INDEX IF NOT EXISTS idx_workflow_approvals_workflow
  ON workflow_approvals(workflow_id, requested_at DESC);
