# Rust Gateway Shadow Parity Sprint 2

LANE LOCK:
Repo: ArgentAIOS/argentos-core
Local path: /Users/sem/code/argent-core-rust-spine
Target branch: dev
Forbidden repo for this task: ArgentAIOS/argentos
Reason: core gateway/kernel/Rust foundation work

## Review Status

Draft for operator review. Do not implement until approved.

## Goal

Turn the Sprint 1 promotion-readiness scaffolding into stronger, broader evidence without changing live authority. Sprint 2 should reduce mock-only parity, introduce smoke-gate structure for dashboard/client behavior, and prepare rollback dry-run design while Node remains the live gateway.

## Guardrails

- Node remains live gateway, scheduler, workflow, channel, session, and run authority.
- Rust remains shadow-only.
- No live traffic takeover.
- No Rust timers, workflow execution, channel sends, or connector-backed tool authority.
- Coordinate with Workflows before touching workflow runtime, scheduler, cron, or wait-resume behavior.
- Coordinate with AOS before changing connector registration/exposure.
- Coordinate with AppForge before changing dashboard/API assumptions.
- Keep unsafe fixtures blocked unless an isolated canary harness and rollback plan exist.

## Current Baseline

- Latest parity smoke: 15 passed, 0 failed, 3 skipped.
- Promotion readiness: false.
- Warnings: 11.
- Clean protocol evidence: `connect-v3-token`, `rpc-health`, `rpc-system-presence`, `rpc-config-schema`.
- Mock-only non-evidence: status, commands, models, channels, connectors, sessions, cron status/list, node list, tools.
- Unsupported: `workflows.list`.
- Unsafe blocked: `chat.send`, `cron.add`, `workflows.run`.

## Sprint 2 Tasks

### Task 1: Real Parity Evidence Expansion

Convert the safest mock-compatible fixtures into schema-compatible evidence where Rust can truthfully satisfy client-facing shape contracts.

Candidate fixtures:

- `rpc-status`
- `rpc-commands-list`
- `rpc-models-list`
- `rpc-cron-status`
- `rpc-cron-list`
- `rpc-node-list`

Acceptance:

- Add payload validators before relabeling any fixture.
- Do not relabel channel, connector, session, or tool/plugin surfaces until their live ownership story is clearer.
- Parity smoke remains non-strict and passes.

### Task 2: Dashboard Smoke Gate Skeleton

Create a read-only dashboard smoke-gate artifact and, if feasible without API changes, a script/harness that records whether dashboard-critical gateway methods are covered.

Acceptance:

- No dashboard API contract changes without AppForge coordination.
- Gate starts as `not-run` or `blocked` until it has real browser evidence.
- Readiness summary points to the gate status.

### Task 3: Client/Swift Smoke Gate Skeleton

Create a client smoke-gate plan for Swift/mobile assumptions around connect, health, status, presence, and auth handling.

Acceptance:

- No Swift app changes required in this sprint unless an existing harness is found.
- Gate status remains `not-run` until executable smoke exists.
- Handoff clearly states required Swift/app-owner follow-up.

### Task 4: Auth/Token Parity Matrix

Inventory Node auth/token/role/scope behavior versus current Rust token handling.

Acceptance:

- Produce a matrix covering token auth, password auth if applicable, roles/scopes, local-only assumptions, and failure responses.
- Add read-only parity fixtures only for safe failed-auth cases.
- Do not weaken Node auth or Rust auth.

### Task 5: Rollback Dry-Run Spec

Turn the rollback/fallback design into a concrete dry-run command spec.

Acceptance:

- Specify exact output for `argent gateway authority rollback-node --dry-run --reason <reason>`.
- List required authority record fields.
- No mutating rollback implementation yet.

### Task 6: Workflow/Scheduler Canary Design

Create a design for isolated workflow and schedule canary fixtures that can safely unblock `cron.add` and `workflows.run` evidence later.

Acceptance:

- Coordinate with Workflows before implementation.
- Must include duplicate-run prevention expectations.
- Must keep live workflow state untouched.

### Task 7: Readiness Summary v2

Expand `rust-gateway-readiness-summary.json` to include task-level evidence links and gate owners.

Acceptance:

- JSON remains stable and machine-readable.
- Include owner lane, status, blocker reason, and next command or artifact for each gate.

### Task 8: Sprint 2 Handoff Packet

Write a concise handoff once Sprint 2 work is complete.

Acceptance:

- Include changed files, bus messages, latest smoke evidence, remaining blockers, and next tasks.
- State clearly that Rust is still not live authority unless promotion gates are genuinely satisfied.

## Proposed Execution Order

1. Task 4: Auth/token parity matrix.
2. Task 1: Real parity evidence expansion for safest read-only fixtures.
3. Task 7: Readiness summary v2.
4. Task 2: Dashboard smoke gate skeleton.
5. Task 3: Client/Swift smoke gate skeleton.
6. Task 5: Rollback dry-run spec.
7. Task 6: Workflow/scheduler canary design.
8. Task 8: Sprint 2 handoff packet.

## Verification Plan

Required before claiming Sprint 2 progress:

```sh
git remote get-url origin
pwd
git rev-parse --abbrev-ref HEAD
pnpm check:repo-lane
pnpm vitest run <targeted tests>
pnpm oxfmt --check <touched ts files>
pnpm oxlint --type-aware <touched ts files>
pnpm rust-gateway:parity:report -- --startup-timeout-ms 60000 --request-timeout-ms 3000 --json-summary
git diff --check
```

If Rust files are touched:

```sh
rustfmt --check <touched rust files>
cargo test --manifest-path rust/Cargo.toml -p argentd
```

## Review Questions

1. Should Sprint 2 prioritize real parity evidence first, or dashboard/client smoke-gate skeletons first?
2. Should rollback dry-run stay design-only in Sprint 2, or may it become a read-only command if the spec is straightforward?
3. Should auth failed-case fixtures be included now, or kept as a separate auth-focused sprint?
