-- ArgentOS PG migration: Workflows — DAG definition, run history, step execution
-- Core workflow engine tables for visual multi-agent pipeline builder.

-- ────────────────────────────────────────────────────────────────────
-- Workflow definition (the DAG)
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS workflows (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name            TEXT NOT NULL,
  description     TEXT,
  owner_agent_id  TEXT DEFAULT 'argent',
  department_id   TEXT,                           -- BUSINESS: Intent constraint inheritance (null in Core)
  version         INTEGER DEFAULT 1,              -- Incremented on save
  is_active       BOOLEAN DEFAULT true,

  -- The graph
  nodes           JSONB NOT NULL DEFAULT '[]',    -- TriggerNode | AgentNode | ActionNode | GateNode | OutputNode
  edges           JSONB NOT NULL DEFAULT '[]',    -- { id, source, target, sourceHandle?, targetHandle?, condition? }
  canvas_layout   JSONB DEFAULT '{}',             -- React Flow viewport, positions (UI-only)

  -- Execution defaults
  default_on_error    JSONB DEFAULT '{"strategy":"fail","notifyOnError":true}',
  error_workflow_id   TEXT REFERENCES workflows(id),
  max_run_duration_ms INTEGER DEFAULT 3600000,    -- 1 hour
  max_run_cost_usd    NUMERIC(10,4),
  monthly_budget_usd  NUMERIC(10,4),              -- BUSINESS: per-workflow billing cap (null in Core)

  -- Trigger config (denormalized for indexing)
  trigger_type    TEXT,
  trigger_config  JSONB,
  next_fire_at    TIMESTAMPTZ,                    -- For cron triggers

  -- BUSINESS: Deployment stage (Core workflows are always "live")
  deployment_stage TEXT DEFAULT 'live'
    CHECK (deployment_stage IN ('simulate','shadow','limited_live','live')),

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflows_trigger
  ON workflows(trigger_type) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_workflows_next_fire
  ON workflows(next_fire_at) WHERE is_active = true AND trigger_type = 'cron';
CREATE INDEX IF NOT EXISTS idx_workflows_owner
  ON workflows(owner_agent_id);
CREATE INDEX IF NOT EXISTS idx_workflows_active
  ON workflows(is_active) WHERE is_active = true;

-- ────────────────────────────────────────────────────────────────────
-- Version history
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS workflow_versions (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workflow_id   TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  version       INTEGER NOT NULL,
  nodes         JSONB NOT NULL,
  edges         JSONB NOT NULL,
  canvas_layout JSONB,
  changed_by    TEXT,                             -- agent ID or 'operator'
  change_summary TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (workflow_id, version)
);

CREATE INDEX IF NOT EXISTS idx_workflow_versions_workflow
  ON workflow_versions(workflow_id, version DESC);

-- ────────────────────────────────────────────────────────────────────
-- Execution runs
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS workflow_runs (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workflow_id       TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  workflow_version  INTEGER NOT NULL,             -- Which version ran
  status            TEXT DEFAULT 'created'
    CHECK (status IN ('created','running','waiting_approval','waiting_event',
                      'waiting_duration','completed','failed','cancelled')),
  trigger_type      TEXT NOT NULL,
  trigger_payload   JSONB,

  -- Progress
  current_node_id   TEXT,
  variables         JSONB DEFAULT '{}',           -- Accumulated workflow variables

  -- Cost
  total_tokens_used INTEGER DEFAULT 0,
  total_cost_usd    NUMERIC(10,4) DEFAULT 0,

  -- Timing
  started_at        TIMESTAMPTZ DEFAULT NOW(),
  ended_at          TIMESTAMPTZ,
  error             TEXT,
  metadata          JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_wfruns_active
  ON workflow_runs(status) WHERE status NOT IN ('completed','failed','cancelled');
CREATE INDEX IF NOT EXISTS idx_wfruns_workflow
  ON workflow_runs(workflow_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_wfruns_created
  ON workflow_runs(started_at DESC);

-- ────────────────────────────────────────────────────────────────────
-- Step execution within a run
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS workflow_step_runs (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  run_id          TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  node_id         TEXT NOT NULL,                  -- Matches node.id in workflow.nodes
  node_kind       TEXT NOT NULL,                  -- "trigger" | "agent" | "action" | "gate" | "output"

  -- Execution
  status          TEXT DEFAULT 'pending'
    CHECK (status IN ('pending','queued','running','completed','failed','retrying','skipped')),
  agent_id        TEXT,
  task_id         TEXT,                           -- Links to tasks table (agent steps)
  idempotency_key TEXT UNIQUE,                    -- wfrun:{runId}:step:{nodeId}:attempt:{n}

  -- Data
  input_context   JSONB,                          -- PipelineContext snapshot
  output_items    JSONB,                          -- ItemSet
  variables_set   JSONB DEFAULT '{}',             -- Variables this step added/modified

  -- Cost
  tokens_used     INTEGER DEFAULT 0,
  cost_usd        NUMERIC(10,4) DEFAULT 0,
  model_used      TEXT,

  -- Timing
  started_at      TIMESTAMPTZ,
  ended_at        TIMESTAMPTZ,
  duration_ms     INTEGER,
  retry_count     INTEGER DEFAULT 0,
  error           TEXT,

  -- BUSINESS: Approval (for gate:approval nodes — null in Core)
  approval_status TEXT
    CHECK (approval_status IN ('pending','approved','denied','edited','escalated','timed_out')),
  approved_by     TEXT,
  approval_note   TEXT,
  edited_output   JSONB                           -- If approver edited before approving
);

CREATE INDEX IF NOT EXISTS idx_stepruns_run
  ON workflow_step_runs(run_id, started_at);
CREATE INDEX IF NOT EXISTS idx_stepruns_active
  ON workflow_step_runs(status) WHERE status IN ('running','pending','queued','retrying');
CREATE INDEX IF NOT EXISTS idx_stepruns_idempotency
  ON workflow_step_runs(idempotency_key) WHERE idempotency_key IS NOT NULL;
