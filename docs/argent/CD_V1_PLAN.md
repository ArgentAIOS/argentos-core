# Contracted Dispatch v1 - Execution Plan

Status: In Progress  
Owner: Codex + Jason  
Started: 2026-03-01  
Branch: `codex/pg17-cutover-migration`

## Objective

Deliver Contracted Dispatch v1 end-to-end with hard enforcement, auditability, and no partial completion.

## Scope Lock

- In scope: CD v1 only until all phases below are complete.
- Out of scope: unrelated refactors, UI polish outside CD v1, non-P0 requests.
- Interrupt rule: only P0 production breakages can preempt this plan.

## Delivery Contract

1. WIP limit is 1 phase at a time.
2. No phase advancement without passing exit criteria.
3. Each phase ends in code + tests + commit.
4. Completion is declared only when all DoD checks are green.

## Phases

### Phase 0 - Lock + Tracker + Baseline

Deliverables:

- `CD_V1_PLAN.md` and `CD_V1_TRACKER.md` committed.
- Baseline validation snapshot recorded in tracker.
  Exit criteria:
- Docs committed.
- Baseline command set has pass/fail status recorded.

### Phase 1 - Contract Data Layer

Deliverables:

- `dispatch_contracts` persistence module and schema/migration.
- Lifecycle event persistence for all statuses.
  Exit criteria:
- Unit tests for CRUD/lifecycle pass.
- Migration path validated locally.

### Phase 2 - `family.dispatch_contracted`

Deliverables:

- New family tool action for contracted dispatch.
- Response includes `contract_id`, status, and expiry metadata.
  Exit criteria:
- Integration test for dispatch creation passes.

### Phase 3 - Per-run Tool Grant Enforcement

Deliverables:

- Hard allowlist enforcement from `tool_grant_snapshot`.
- Unauthorized tool calls denied and audited.
  Exit criteria:
- Negative test confirms blocked tool use.

### Phase 4 - Heartbeat + Timeout Enforcement

Deliverables:

- Contract heartbeat and timeout monitors.
- Automatic transitions to failed/cancelled on violations.
  Exit criteria:
- Timeout and missed-heartbeat tests pass.

### Phase 5 - Observability + History Query

Deliverables:

- `contract_history` query path.
- Ordered lifecycle retrieval from source of truth.
  Exit criteria:
- Query tests pass for ordering and filtering.

### Phase 6 - E2E Validation + Ops Docs

Deliverables:

- Reproduction test for unauthorized external-write incident class.
- Operator runbook and validation prompts.
  Exit criteria:
- E2E scenario passes.
- `pnpm build` and dashboard build pass.

## Definition of Done

- All phases completed and committed.
- Contract lifecycle is persisted and queryable.
- Unauthorized tool call outside grant is impossible in tests.
- Timeout and heartbeat enforcement verified.
- Build/test gates pass.
- Runbook docs committed.
