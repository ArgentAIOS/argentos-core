# Rust Gateway Promotion Readiness Handoff

LANE LOCK:
Repo: ArgentAIOS/argentos-core
Local path: /Users/sem/code/argent-core-rust-spine
Target branch: dev
Forbidden repo for this task: ArgentAIOS/argentos
Reason: core gateway/kernel/Rust foundation work

## Status

Rust is ready for a promotion-readiness handoff.

Rust is not ready for live gateway promotion.

Node remains the live gateway, scheduler, workflow, channel, session, and run authority. Rust remains shadow-only.

## What Is Proven

- The current architecture inventory, parity matrix, shadow-mode contract, promotion gates, and implementation slices are captured in `ops/RUST_GATEWAY_KERNEL_TRANSITION_PLAN.md`.
- The parity fixture policy and fixture list are captured in `ops/RUST_GATEWAY_PROTOCOL_PARITY_FIXTURES.md`.
- The Sprint 1 ledger is captured in `ops/RUST_GATEWAY_SHADOW_PARITY_SPRINT_1.md`.
- The scheduler/timer/rollback boundary is captured in `ops/RUST_GATEWAY_SCHEDULER_TIMER_BOUNDARY_PLAN.md`.
- `pnpm rust-gateway:parity:report` starts isolated loopback Node and Rust services and writes:
  - `rust-gateway-parity-report.json`
  - `rust-gateway-parity-report.md`
  - `rust-gateway-readiness-summary.json`
  - `rust-gateway-shadow-drift.jsonl`
- `rust-gateway-readiness-summary.json` now includes explicit gate statuses such as `isolated-parity-report`, `promotion-cleanliness`, `dashboard-smoke`, `workflow-run-smoke`, `rollback-to-node`, `restart-recovery`, and `duplicate-prevention`.
- Clean protocol evidence validates known payload shapes for `connect`, `health`, `system-presence`, and `config.schema`; it is not just an envelope `ok=true` check.
- `argent status` exposes Rust shadow health, latest parity report freshness, and scheduler authority.
- `argent gateway authority status` is a read-only authority surface. It does not switch authority.

## Latest Smoke Shape

Recent isolated smoke evidence:

- Passed: 15
- Failed: 0
- Skipped: 3
- Promotion ready: false
- Promotion blockers: 0 in the replay engine
- Warnings: 11
- Gate status: isolated parity report passed; clean protocol evidence passed; promotion cleanliness blocked; dashboard/Swift/restart/rollback/duplicate-prevention gates not run; workflow and schedule smoke gates blocked behind unsafe-fixture policy.

The warnings matter. Mock-compatible results are not promotion evidence, unsupported surfaces still need owners, and unsafe fixtures remain intentionally blocked.

## Current Authority

| Surface | Live Authority | Rust Status |
| --- | --- | --- |
| Gateway HTTP/WebSocket authority | Node | Shadow-only |
| Scheduler/timers | Node | Shadow-only |
| Workflow schedule reconciliation | Node | Shadow-only |
| Workflow wait resume | Node | Shadow-only |
| Channels/inbound/outbound sends | Node | Shadow-only |
| Agent/session/run dispatch | Node | Shadow-only |
| AOS connector exposure | Node/current TS surfaces | No ownership |
| Dashboard/AppForge APIs | Node/current TS surfaces | No ownership |

## Not Promotion-Ready Yet

Before Rust can be live authority, these gates still need evidence:

- Auth/token role/scope parity.
- Full HTTP endpoint parity.
- Full WebSocket/RPC compatibility.
- Dashboard smoke against Rust canary.
- Swift app smoke against Rust canary.
- Workflow run smoke against Rust canary.
- Schedule/reminder/timer smoke against Rust canary.
- Restart/recovery tests.
- Database/state migration safety.
- Operator rollback to Node.
- No silent data loss.
- No duplicate timers, channels, workflow runs, session runs, or outbound sends.

## Readiness Percentages

These are handoff estimates, not release claims:

- Transition plan and guardrails: 80%
- Shadow observability and parity harness: 70%
- Read-only status/doctor/operator evidence: 65%
- Rust gateway live behavioral parity: 30%
- Promotion/rollback safety: 20%
- Live Rust authority readiness: 0%

## Recommended Next Slices

1. Add a read-only authority file/status resolver if the project wants a durable on-disk authority record preview.
2. Expand parity fixtures from mock-compatible to real comparison evidence for auth, session lifecycle, tools/plugins, workflows, and channel-adjacent surfaces.
3. Add isolated dashboard smoke using Node and Rust shadow endpoints.
4. Add isolated Swift/client protocol smoke if the Swift app harness is available.
5. Add a non-mutating rollback dry-run command:
   - `argent gateway authority rollback-node --dry-run --reason <reason>`
6. Only after dry-run evidence exists, design mutating rollback with explicit operator confirmation and tests.

## Commands For The Next Thread

```sh
git remote get-url origin
pwd
git rev-parse --abbrev-ref HEAD
pnpm check:repo-lane
pnpm rust-gateway:parity:report -- --json-summary
argent gateway authority status --json
argent status
```

## Coordination Notes

- Coordinate with Workflows before touching scheduler, workflow schedule reconciliation, workflow wait resume, or workflow runtime files.
- Coordinate with AOS before changing connector registration/exposure or connector-backed tool execution.
- Coordinate with AppForge before adding dashboard controls or changing gateway API assumptions.
- Keep Rust work in `/Users/sem/code/argent-core-rust-spine` and keep it away from the workflow/docpanel fix branch.
