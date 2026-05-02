# Rust Gateway Scheduler And Timer Boundary Plan

LANE LOCK:
Repo: ArgentAIOS/argentos-core
Local path: /Users/sem/code/argent-core-rust-spine
Target branch: dev
Forbidden repo for this task: ArgentAIOS/argentos
Reason: core gateway/kernel/Rust foundation work

## Purpose

Define the scheduler, workflow wait, timer, and rollback boundaries that must be proven before the Rust gateway/kernel path can ever become live authority.

This is a planning-only artifact. It does not promote Rust, start Rust timers, change workflow runtime ownership, or alter AOS/AppForge/dashboard contracts.

## Current Node Timer Authority

Node currently owns live time-based behavior:

- Gateway process startup in `src/gateway/server.impl.ts` starts:
  - heartbeat runner,
  - contemplation runner,
  - execution worker runner,
  - job orchestrator runner,
  - SIS runner,
  - consciousness kernel runner,
  - periodic health check timer,
  - `CronService` plus workflow schedule reconciliation.
- Cron service construction in `src/gateway/server-cron.ts` binds cron jobs to live side effects:
  - system events,
  - heartbeat wake/request/run,
  - isolated agent jobs,
  - nudge dispatch,
  - audio alerts,
  - VIP email scans,
  - Slack signal scans,
  - workflow wait resume scans.
- Cron state and timer behavior lives under `src/cron/service*.ts`.
- Workflow schedule triggers are converted into cron jobs by `src/gateway/server-methods/workflows.ts`.
- Due workflow waits are resumed by `resumeDueWorkflowWaits` in `src/infra/workflow-execution-service.ts`.

## Rust Shadow Boundary

Rust may do the following while Node remains live authority:

- Report health/readiness facts.
- Replay protocol fixtures in isolated loopback processes.
- Emit drift logs for Node-vs-Rust differences.
- Simulate scheduler decisions against copied or synthetic state.
- Count candidate due timers/runs without executing them.
- Report what it would have done using non-authoritative evidence.

Rust must not do any of the following before promotion gates pass:

- Arm live timers for existing Node cron/workflow schedules.
- Write Node cron store state.
- Mutate workflow run rows.
- Resume waiting workflow runs.
- Dispatch heartbeat, nudge, audio, channel, email, Slack, tool, or agent-run side effects.
- Create, update, remove, or run live cron jobs.
- Open channel listeners or send channel messages.
- Claim gateway authority in status/doctor output.

## Duplicate-Execution Risks

The main promotion danger is not a missing response; it is duplicate authority:

- Duplicate cron timers can run the same job twice.
- Duplicate workflow schedule reconciliation can create or fire duplicate workflowRun cron jobs.
- Duplicate wait-resume loops can resume a waiting workflow twice.
- Duplicate heartbeat/contemplation/SIS/kernel ticks can write inconsistent state or double-notify the operator.
- Duplicate channel/timer coupling can send outbound alerts more than once.
- Split-brain Node/Rust state can make rollback unclear if both processes think they own the same job lease.

## Required Ownership Model

Before Rust can run any live timer, there must be one explicit authority record that both Node and Rust honor.

Minimum fields:

- `gatewayAuthority`: `node` or `rust`
- `schedulerAuthority`: `node` or `rust`
- `workflowTimerAuthority`: `node` or `rust`
- `channelAuthority`: `node` or `rust`
- `updatedAt`
- `updatedBy`
- `reason`
- `epoch`

Rules:

- Authority changes must be monotonic by `epoch`.
- A process must refuse live timer execution when its authority field is not active.
- Shadow/canary modes must have separate names and must not be treated as authority.
- Promotion must be two-phase: prepare evidence, then activate authority.
- Rollback must be able to set every live authority field back to `node`.

## Promotion Gates For Timers

Rust scheduler/timer promotion is blocked until all gates pass:

- Node-vs-Rust due-time comparison for cron schedules with no drift.
- Node-vs-Rust workflow schedule reconciliation comparison with no duplicate job creation.
- Workflow wait-resume dry-run comparison for waiting_duration and waiting_event timeouts.
- Restart test proves Rust does not re-run completed one-shot jobs.
- Crash test proves in-progress jobs are either resumed once or marked recoverable, never duplicated.
- Rollback test proves Node can resume authority from persisted state after Rust exits.
- Channel/send tests prove no duplicate outbound delivery.
- Heartbeat/contemplation/SIS/kernel tick tests prove only one live tick loop is active.
- Status/doctor output exposes authority and last authority change.
- Operator rollback command exists and is documented.

## Fallback And Rollback Command Shape

Recommended future CLI surface:

```sh
argent gateway authority status
argent gateway authority prepare-rust --shadow-report <path>
argent gateway authority promote-rust --canary --duration 10m
argent gateway authority rollback-node --reason "operator requested rollback"
```

The first implementation should be read-only:

- `status` prints Node/Rust authority, latest parity report, and timer authority state.
- `prepare-rust` validates gates but does not switch authority.

Only after those are proven should mutating commands be implemented.

Rollback must:

- stop Rust live timer loops,
- set every live authority field to Node,
- restart or re-arm Node cron/heartbeat/workflow wait loops,
- report any ambiguous in-flight jobs/runs,
- refuse success if duplicate authority is still detected.

## First Safe Follow-Up Slice

Add a read-only scheduler authority report:

- inspect Node cron status and workflow schedule-derived jobs,
- include Rust health readiness facts,
- include latest Rust parity report freshness,
- report `schedulerAuthority=node` until a real authority record exists,
- mark missing authority record as expected/current-state, not failure,
- add tests around the report formatter.

Do not implement live Rust timers in this slice.

## Coordination Notes

- Workflows owns workflow schedule/runtime behavior. Coordinate before changing any runtime scheduling, workflow run, or wait-resume code.
- AOS owns connector exposure. Coordinate before any timer can invoke connector-backed tools through Rust.
- AppForge owns AppForge dashboard/gateway contracts. Coordinate before exposing authority controls in UI.
- Node remains live authority until all promotion gates in `ops/RUST_GATEWAY_KERNEL_TRANSITION_PLAN.md` are satisfied.
