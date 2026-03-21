# Contracted Dispatch v1 - Tracker

Status: Active  
Last Updated: 2026-03-01 (America/Chicago)

## Scope Guard

- Active scope: CD v1 only.
- Parking lot for out-of-scope work: `docs/argent/CD_V1_PARKING_LOT.md` (create only if needed).

## Phase Checklist

- [x] Phase 0 - Lock + Tracker + Baseline
- [x] Phase 1 - Contract Data Layer
- [x] Phase 2 - `family.dispatch_contracted`
- [x] Phase 3 - Per-run Tool Grant Enforcement
- [x] Phase 4 - Heartbeat + Timeout Enforcement
- [x] Phase 5 - Observability + History Query
- [x] Phase 6 - E2E Validation + Ops Docs

## Baseline Snapshot

Date: 2026-03-01

| Command                                                                                                                     | Result |
| --------------------------------------------------------------------------------------------------------------------------- | ------ |
| `pnpm test -- src/infra/service-keys.policy.test.ts src/config/config.env-vars.test.ts src/agents/tools/web-search.test.ts` | PASS   |
| `pnpm build`                                                                                                                | PASS   |
| `pnpm --dir dashboard build`                                                                                                | PASS   |
| `launchctl kickstart -k gui/$(id -u)/ai.argent.gateway`                                                                     | PASS   |
| `launchctl kickstart -k gui/$(id -u)/ai.argent.dashboard-api`                                                               | PASS   |

Notes:

- Service-key policy/audit API routes are live and auth-gated (`401` without auth).
- Legacy `config.env` auto-import remains disabled by default unless `ARGENT_ALLOW_CONFIG_ENV_VARS=1`.

## Blocker Protocol

If blocked for >20 minutes:

1. Record blocker in this file.
2. List exactly 2-3 resolution options.
3. Stop phase advancement until decision.

## Progress Log

- 2026-03-01: Phase 0 completed. Plan/tracker committed structure created and baseline captured.
- 2026-03-01: Phase 1 completed.
  - Added `src/infra/dispatch-contracts.ts` (contract + lifecycle event persistence module).
  - Added `src/data/pg/migrations/0002_dispatch_contracts.sql` and schema entries in `src/data/pg/schema.ts`.
  - Added unit tests in `src/infra/dispatch-contracts.test.ts`.
  - Validation:
    - `pnpm test -- src/infra/dispatch-contracts.test.ts` => PASS
    - `pnpm build` => PASS
    - Live PG create/event/read/delete cycle => PASS
- 2026-03-01: Phase 2 completed.
  - Added `family.dispatch_contracted` action in `src/agents/tools/family-tool.ts`.
  - Added tests in `src/agents/tools/family-tool.dispatch-contracted.test.ts`.
  - Validation:
    - `pnpm test -- src/agents/tools/family-tool.dispatch-contracted.test.ts src/agents/tools/family-tool.dispatch-routing.test.ts` => PASS
    - `pnpm build` => PASS
- 2026-03-01: Phase 3 completed.
  - Enforced fail-closed tool grant checks in `dispatch_contracted` for strict sub-agent and think-tank routing.
  - Added negative tests proving blocked unsafe grants.
  - Validation:
    - `pnpm test -- src/agents/tools/family-tool.dispatch-contracted.test.ts src/agents/tools/family-tool.dispatch-routing.test.ts` => PASS
    - `pnpm build` => PASS
- 2026-03-01: Phase 4 completed.
  - Added in-process contract monitors (timeout + heartbeat) in `src/infra/dispatch-contracts.ts`.
  - Added `recordDispatchContractHeartbeat(...)` helper and monitor lifecycle cleanup for terminal statuses.
  - Added tests for timeout and missed-heartbeat auto-failure in `src/infra/dispatch-contracts.test.ts`.
  - Validation:
    - `pnpm test -- src/infra/dispatch-contracts.test.ts src/agents/tools/family-tool.dispatch-contracted.test.ts` => PASS
    - `pnpm test -- src/infra/service-keys.policy.test.ts src/config/config.env-vars.test.ts` => PASS
    - `pnpm build` => PASS
- 2026-03-01: Phase 5 completed.
  - Added `contract_history` action in `src/agents/tools/family-tool.ts`.
  - Added contract filters: `contract_id`, `task_id`, `target_agent_id`, `contract_status`, `limit`.
  - Added optional ordered lifecycle retrieval via `include_events=true`.
  - Added tests for filtering and ordered history payloads in `src/agents/tools/family-tool.dispatch-contracted.test.ts`.
  - Validation:
    - `pnpm test -- src/agents/tools/family-tool.dispatch-contracted.test.ts src/infra/dispatch-contracts.test.ts` => PASS
    - `pnpm build` => PASS
- 2026-03-01: Phase 6 completed.
  - Added operator runbook at `docs/argent/CD_V1_RUNBOOK.md`.
  - Added explicit incident-class regression test for blocked think-tank external write grant in `src/agents/tools/family-tool.dispatch-contracted.test.ts`.
  - Updated docs index with runbook link in `docs/argent/INDEX.md`.
  - Validation:
    - `pnpm test -- src/agents/tools/family-tool.dispatch-contracted.test.ts src/infra/dispatch-contracts.test.ts` => PASS
    - `pnpm build` => PASS
    - `pnpm --dir dashboard build` => PASS
