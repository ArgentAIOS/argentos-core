# Contracted Dispatch v1 - Operator Runbook

Status: Ready  
Updated: 2026-03-01 (America/Chicago)

## Purpose

This runbook validates Contracted Dispatch v1 end-to-end:

1. Contract lifecycle persistence
2. Fail-closed per-run tool grants
3. Timeout/heartbeat enforcement
4. Queryable contract history

## Preflight

1. Start services:
   - `argent gateway start`
   - `pnpm --dir dashboard dev` (or your normal dashboard start path)
2. Ensure PostgreSQL/Redis are running for normal runtime validation.
3. Ensure you can access chat + family tool in the dashboard.

## Automated Validation Gates

1. Contract core + family contracted tests:
   - `pnpm test -- src/infra/dispatch-contracts.test.ts src/agents/tools/family-tool.dispatch-contracted.test.ts`
2. Secrets prerequisite tests:
   - `pnpm test -- src/infra/service-keys.policy.test.ts src/config/config.env-vars.test.ts`
3. Build gates:
   - `pnpm build`
   - `pnpm --dir dashboard build`

Expected result: all commands pass.

## Manual Operator Prompts

Use these prompts in chat.

1. Create a valid contracted dispatch:
   - `Use family with action="dispatch_contracted", mode="family", id="forge", task="Fix dashboard TypeScript regression and report changed files", task_id="task-cd1", timeout_ms=60000, heartbeat_interval_ms=5000, toolsAllow=["read","write"].`
   - Expect:
     - `ok: true`
     - `contract_id` present
     - `contract_status: "started"`

2. Query contract by ID:
   - `Use family with action="contract_history", contract_id="<the contract_id above>", include_events=true, limit=50.`
   - Expect:
     - single contract returned
     - ordered events by time (`contract_created`, then later states)

3. Query filtered contract list:
   - `Use family with action="contract_history", task_id="task-cd1", target_agent_id="forge", include_events=true, limit=20.`
   - Expect:
     - filtered list for `task-cd1` and `forge`
     - `eventsByContract` populated

4. Reproduce blocked incident class (think-tank external write):
   - `Use family with action="dispatch_contracted", mode="family", id="elon", task="Comment on Atera ticket #55335", toolsAllow=["atera_ticket"].`
   - Expect:
     - `ok: false`
     - error contains `violates think-tank policy`
     - no contract is created

5. Reproduce blocked strict sub-agent unsafe grant:
   - `Use family with action="dispatch_contracted", mode="subagent", task="Run task", toolsAllow=["read","write"].`
   - Expect:
     - `ok: false`
     - error contains `violates strict subagent policy`

## Timeout and Heartbeat Behavior

The contract monitor auto-fails active contracts when:

1. `now > expires_at` (timeout)
2. status is `heartbeat` and heartbeat is stale beyond threshold

Validation is covered in `src/infra/dispatch-contracts.test.ts`.

## Troubleshooting

1. If macOS keychain prompts disappear:
   - restart gateway and retry a secrets read/write path.
2. If tests fail with local keychain warnings:
   - warnings are expected in some local test environments; assert on pass/fail, not warning text.
3. If `contract_history` returns none:
   - confirm the dispatch call used `dispatch_contracted` (plain `dispatch` does not create contracts).

## Rollback

If needed, revert CD v1 commits in reverse order and restart services:

1. `ae5150197` - heartbeat/timeout monitors
2. `b65f95f99` - contract history query
3. `7e984824e` - fail-closed grant enforcement
4. `5501804f1` - dispatch_contracted action
5. `64161c31b` - contract storage layer
6. `97a41c22c` - plan/tracker docs
