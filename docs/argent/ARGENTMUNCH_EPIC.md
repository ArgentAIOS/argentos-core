# ArgentMunch Epic (Code Intelligence Layer)

Last updated: 2026-03-05

## Purpose

Create an ArgentOS-native code intelligence MCP service (ArgentMunch) that replaces brute-force file reading with symbol-level retrieval and shared indexing across agents.

## Outcome Targets

- 80-99% reduction in token spend for code exploration flows.
- Shared symbol index for MAO agents (no duplicate repo re-reading).
- Deterministic, auditable code-context retrieval for operator and agent workflows.

## Scope

### In Scope

- Fork and harden `jcodemunch-mcp` for ArgentOS usage.
- Multi-repo indexing for active Argent ecosystem repos.
- Shared endpoint on central infra (Dell R750).
- Git-driven reindex triggers.
- Basic freshness/health visibility.

### Out of Scope (initial)

- Full autonomous code modification loops.
- Cross-org indexing beyond approved allowlist repos.
- Any license-unclear upstream code until legal check passes.

## Phase Plan

### Phase 1: Fork + Baseline

- Fork upstream.
- Stand up local POC.
- Index `ArgentAIOS/argentos`.
- Compare token usage against current exploration baseline.

Exit criteria:

- Symbol lookup works in real tasks.
- Measurable token reduction captured.

### Phase 2: Multi-Repo + Shared Endpoint

- Add/validate multi-repo indexing.
- Deploy always-on service on R750.
- Register as default MCP endpoint for selected agents.

Exit criteria:

- 3+ agents using shared endpoint.
- No duplicate indexing per-agent.

### Phase 3: Diff Awareness + Reindex Automation

- Webhook-triggered reindex on push.
- Symbol change/freshness metadata.
- Agent-visible stale index signal.

Exit criteria:

- Push → reindex pipeline stable.
- Stale data is detectable.

### Phase 4: Unified Context Layer

- Optional doc retrieval integration (`jdocmunch` style).
- Unified response ranking (code + docs).

Exit criteria:

- One retrieval endpoint answers both code and docs context needs.

## Critical Decision Gates

1. Licensing gate:
   - Confirm fork/distribution/commercial terms before adoption.
2. Security gate:
   - Repo allowlist + auth + rate limits.
   - Secrets never indexed.
3. Reliability gate:
   - Reindex failure isolation.
   - Health checks and fallback behavior.

## Integration Notes for ArgentOS

- Register as MCP server in operator config.
- Add skill wrapper (`argentmunch`) so agents call one canonical interface.
- Add health surface line item:
  - index freshness
  - last successful index
  - indexed repos count
  - webhook status

## Initial Issue Split (recommended)

1. Epic: ArgentMunch code intelligence layer.
2. Fork + legal/licensing validation.
3. POC benchmark on `argentos` repo (token/time baseline).
4. Shared deployment on R750 with auth and health checks.
5. Webhook reindex + stale symbol signaling.
6. Optional unified context (code + docs) endpoint.

## Sprint 0 Checklist (granular)

| ID   | Work Item                                                              | Owner    | Estimate | Acceptance Test                                                         |
| ---- | ---------------------------------------------------------------------- | -------- | -------- | ----------------------------------------------------------------------- |
| AM-1 | Fork `jcodemunch-mcp` into Argent org + confirm license posture        | Platform | 0.5d     | Fork exists, license decision recorded in repo README                   |
| AM-2 | Local Docker POC indexing `ArgentAIOS/argentos`                        | Core     | 1d       | Query by symbol returns exact file + line for 10 sampled symbols        |
| AM-3 | Baseline token benchmark vs current brute-force code reading           | Ops      | 0.5d     | Report shows token delta on 3 repeated code-exploration scenarios       |
| AM-4 | Multi-repo config (`argentos`, `argent-docs`, `argent-marketplace`)    | Core     | 1d       | Cross-repo query resolves symbols from all configured repos             |
| AM-5 | AuthN/AuthZ + repo allowlist hardening                                 | Security | 1d       | Unauthorized repo query rejected with explicit policy error             |
| AM-6 | Health endpoints (`/health`, `/index/status`) and freshness timestamps | Platform | 0.5d     | Health reflects index age and returns non-200 on stale threshold breach |
| AM-7 | GitHub webhook reindex trigger on push                                 | Platform | 1d       | Push to test repo triggers reindex and updates freshness metadata       |
| AM-8 | ArgentOS integration as MCP + skill wrapper (`argentmunch`)            | Core     | 1d       | Agent can call one tool and retrieve symbol references end-to-end       |

## Operator Rollout Notes

- Keep MVP local-first until AM-1 through AM-4 are green.
- Do not route production agent traffic until AM-5 and AM-6 are complete.
- Promote to R750 only after webhook reindex reliability is validated for 48h.
