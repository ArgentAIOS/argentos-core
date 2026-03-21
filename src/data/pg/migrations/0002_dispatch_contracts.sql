-- Contracted Dispatch v1 persistence
-- Source-of-truth audit tables for contracted task execution lifecycle.

CREATE TABLE IF NOT EXISTS dispatch_contracts (
  contract_id TEXT PRIMARY KEY,
  task_id TEXT,
  task TEXT NOT NULL,
  target_agent_id TEXT NOT NULL,
  dispatched_by TEXT NOT NULL,
  tool_grant_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  timeout_ms INTEGER NOT NULL,
  heartbeat_interval_ms INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  failure_reason TEXT,
  result_summary TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS dispatch_contract_events (
  id BIGSERIAL PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES dispatch_contracts(contract_id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  event_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_dispatch_contracts_status
  ON dispatch_contracts (status);

CREATE INDEX IF NOT EXISTS idx_dispatch_contracts_target_agent
  ON dispatch_contracts (target_agent_id);

CREATE INDEX IF NOT EXISTS idx_dispatch_contracts_task
  ON dispatch_contracts (task_id);

CREATE INDEX IF NOT EXISTS idx_dispatch_contracts_created
  ON dispatch_contracts (created_at);

CREATE INDEX IF NOT EXISTS idx_dispatch_contract_events_contract
  ON dispatch_contract_events (contract_id);

CREATE INDEX IF NOT EXISTS idx_dispatch_contract_events_time
  ON dispatch_contract_events (event_at);

