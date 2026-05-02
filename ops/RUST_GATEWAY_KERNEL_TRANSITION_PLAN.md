# Rust Gateway / Kernel Transition Plan

LANE LOCK:
Repo: ArgentAIOS/argentos-core
Local path: /Users/sem/code/argent-core-rust-spine
Target branch: dev
Forbidden repo for this task: ArgentAIOS/argentos
Reason: pure core gateway/kernel/Rust foundation work

## Purpose

Move Argent toward a stable Rust gateway/kernel architecture without destabilizing the current TypeScript/Node gateway. The TypeScript gateway remains the live authority until protocol parity, observability, fallback, restart recovery, and duplicate-work prevention are proven.

This plan treats the Rust path as shadow-only. Rust may observe, mirror, validate, and report drift. It must not own live operator-visible traffic, timers, workflow runs, channel sends, session state, tool execution, or dashboard authority until the promotion gates below are satisfied.

## Current Architecture

### TypeScript / Node Gateway Responsibilities

The live gateway is `src/gateway/server.impl.ts`, exposed through `startGatewayServer`. It owns:

- WebSocket transport on the configured gateway port, normally `18789`.
- Protocol negotiation, `connect.challenge`, `connect`, request/response frames, event broadcasts, close behavior, and payload-size limits.
- Gateway method registration and authorization through `src/gateway/server-methods.ts` and `src/gateway/server-methods-list.ts`.
- Operator/node role separation and scopes for read, write, approvals, pairing, and admin methods.
- Live RPC surfaces for health, status, logs, channels, config, wizard, update, sessions, chat, send, agent runs, nodes, pairing, devices, exec approvals, tools, skills, providers, terminal, browser, AppForge, jobs, copilot, workflows, cron, TTS, voicewake, AEVP, SpecForge, and intent.
- Plugin and channel gateway method expansion via `loadGatewayPlugins` and `listChannelPlugins`.
- Channel lifecycle through `createChannelManager`, including WhatsApp, Telegram, Discord, Slack, Signal, iMessage, Feishu, and other plugin-backed adapters.
- Cron and scheduled work through `buildGatewayCronService`, `src/cron/**`, `cron.*` methods, and workflow schedule reconciliation.
- Workflow runtime entrypoints through `src/gateway/server-methods/workflows.ts` and `src/infra/workflow-*`.
- Kernel and autonomous wakefulness through `startConsciousnessKernel`, `startHeartbeatRunner`, `startContemplationRunner`, `startSisRunner`, and job orchestration.
- Dashboard/control UI, browser control, canvas host, gateway discovery, health timers, maintenance timers, config reload, Tailscale exposure, sidecars, plugin services, Redis/dashboard state, and update checks.

### Rust Gateway Responsibilities

The Rust gateway scaffold is `rust/argentd`.

Current implemented status:

- Shadow-only daemon.
- Default bind: `127.0.0.1:18799`.
- HTTP `GET /health`.
- HTTP `POST /v1/connect` for a temporary connect payload parity seam.
- WebSocket upgrade, `connect.challenge`, `connect`, protocol/token checks, and request/response frames.
- In-memory hub for presence, health, queued system events, heartbeat events, and client writers.
- Maintenance loop for tick, health, and heartbeat event broadcasts.
- Broad mock/parity responses for many gateway methods, including health/status/presence, models, nodes, sessions, connectors, family, agents, commands, channels logout/status, config, copilot, contemplation, exec approvals, cron, device pairing, knowledge, jobs, skills, wizard, update, SpecForge, browser, intent, TTS, chat, send, agent, execution worker, tools, providers, usage, voicewake, terminal, wake, and system events.

Current non-goals:

- No live gateway takeover.
- No durable live session ownership.
- No channel delivery authority.
- No model/provider/tool execution authority.
- No live workflow, cron, dashboard, or plugin registry authority.
- No database writes.
- No claim that mock payload parity equals behavioral parity.

### Kernel / Executive Responsibilities

The TypeScript kernel is under `src/infra/consciousness-kernel*.ts`.

Current TypeScript kernel responsibilities:

- Shadow/self-state kernel snapshot and authority resolution.
- Focus, lane, wakefulness, and scheduler authority modeling.
- Durable self-state continuity.
- Inner-loop/executive state used for status and inspection.
- Suppression/coordination hooks for autonomous contemplation and SIS when scheduler authority is active.
- Integration with heartbeat, contemplation, SIS, and job orchestration.

The Rust executive scaffold is `rust/argent-execd`.

Current implemented status:

- Shadow-only daemon.
- Default bind: `127.0.0.1:18809`.
- Durable executive state snapshot.
- Append-only continuity journal.
- Scheduler/tick loop.
- Lane request, activation, release, lease expiry, and restart recovery.
- HTTP control/inspection routes:
  - `GET /health`
  - `GET /v1/executive/state`
  - `GET /v1/executive/metrics`
  - `GET /v1/executive/timeline?limit=<n>`
  - `GET /v1/executive/journal?limit=<n>`
  - `POST /v1/lanes/request`
  - `POST /v1/lanes/release`
  - `POST /v1/executive/tick`
  - `POST /v1/executive/shutdown`
- TypeScript read-only client and contract validation:
  - `src/infra/executive-shadow-client.ts`
  - `src/infra/executive-shadow-contract.ts`
  - `src/commands/status.executive-shadow.ts`
  - `src/infra/executive-shadow-kernel-inspector.ts`
  - protocol schema generation through `scripts/executive-shadow-protocol-gen.ts`

Current non-goals:

- No prompt logic port.
- No model/provider logic port.
- No tool-policy port.
- No dashboard/product behavior port.
- No gateway shell ownership.
- No live kernel authority.

### Shared State / Database Boundaries

Live TypeScript currently touches:

- Config and profile files through `src/config/**`.
- Session stores through `src/config/sessions.ts` and gateway session utilities.
- SQLite-style data surfaces under `src/data/**`, including dashboard, memo, sessions, jobs, and search.
- Postgres schema and workflow tables in `src/data/pg/schema.ts` and migrations.
- Redis/dashboard state through `src/data/redis-client.ts` and `src/data/redis-agent-state.ts`.
- Cron/job persistence through `src/cron/**`.
- Workflow persistence through `src/infra/workflow-*` and PG tables for workflows, versions, runs, step runs, and approvals.
- Plugin and channel auth/config state through `src/plugins/**`, `src/channels/**`, channel extension directories, and service-key helpers.

Rust boundaries today:

- `argentd` is in-memory only for gateway shadow behavior.
- `argent-execd` persists only its own shadow executive state under `~/.argentos/runtime/argent-execd-shadow` or `ARGENT_EXECD_STATE_DIR`.
- Rust must not write TypeScript-owned config, sessions, workflow tables, cron state, channel auth, plugin state, or dashboard state until explicit migration gates exist.

### Dashboard / Swift Integration Points

Dashboard:

- `dashboard/src/hooks/useGateway.ts` opens a WebSocket to `ws://<host>:18789`, sends `connect` with protocol version `3`, token credentials, subscriptions, and assumes Node gateway semantics.
- Dashboard widgets and stores call many gateway methods directly, especially Workflows, Cron, AppForge, config, health, logs, terminal, browser, channels, and sessions.
- `dashboard/api-server.cjs` exposes service-panel definitions for `Rust Gateway Shadow` (`argentd`, `18799`) and `Rust Executive Shadow` (`argent-execd`, `18809`).

Swift apps:

- Shared protocol models live in `apps/shared/ArgentKit/Sources/ArgentProtocol/GatewayModels.swift`.
- `apps/shared/ArgentKit/Sources/ArgentKit/GatewayChannel.swift` assumes WebSocket gateway frames, `connect.challenge`, `connect`, protocol version `3`, request/response frames, and event subscriptions.
- iOS/macOS default to gateway port `18789` in multiple connection and settings surfaces.
- Swift app call sites assume Node gateway method payloads for config, voicewake, chat, cron, channels, pairing, node mode, approvals, and activity/event streams.

## Parity Matrix

| Surface                     | Node Live Status                                                                                 | Rust Gateway Status                                                                      | Rust Executive Status                                 | Drift / Gap                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------- |
| HTTP endpoints              | Live health, OpenAI/OpenResponses/tools endpoints, control UI, browser/control sidecars          | `GET /health`, `POST /v1/connect`; no live HTTP API parity                               | Executive HTTP control/inspection only                | Need endpoint inventory and black-box parity tests.                   |
| WebSocket/RPC protocol      | Live protocol v3, auth, connect, req/res, event broadcast, close semantics                       | WebSocket scaffold with connect, token/protocol checks, many mocked method responses     | No WS                                                 | Need golden WS compatibility tests against Node and Rust.             |
| Auth/token handling         | Configured gateway auth, operator/node roles, scopes, CLI/dashboard token flow                   | `ARGENTD_AUTH_TOKEN` string check only; no role/scope authorization parity               | No auth on local shadow HTTP                          | Need auth matrix, role/scope parity, and local-only threat model.     |
| Session lifecycle           | Live session stores, previews, compaction, patch/reset/delete/search                             | Mock session list/preview/resolve/search/patch/reset/delete responses                    | No session ownership                                  | Rust must not own sessions before migration plan.                     |
| Agent run dispatch          | `agent`, `agent.wait`, chat/send/run context, tools, events                                      | Mock agent/send/chat payloads                                                            | No model/tool dispatch                                | Need read-only comparison of request envelopes before live execution. |
| Tool/plugin registration    | Plugin registry and channel plugin gateway methods are live                                      | Static/mocked Rust responses; no dynamic plugin load                                     | No plugin awareness                                   | Need plugin method inventory and registration parity fixtures.        |
| AOS connector exposure      | `connectors.catalog`, workflow connector command/capabilities, `tools.status` connector metadata | Mock `connectors.catalog`; no manifest discovery                                         | No AOS awareness                                      | Coordinate with AOS before changing connector exposure.               |
| Workflows                   | Live create/update/run/cancel/resume/approval/import/template/capability APIs                    | No meaningful workflow authority; many workflow methods absent                           | No workflow ownership                                 | Coordinate with Workflows before scheduler/runtime surfaces.          |
| Schedules/reminders/timers  | Gateway cron service, workflow schedule reconciliation, heartbeat wake, reminders/jobs           | Mock `cron.*` responses/events; no persistent timers                                     | Executive tick/lane lease only                        | Major duplicate-timer risk.                                           |
| Channel adapters            | Live channel plugins, auth, send, receive, typing, reactions, logging                            | Mock channel status/logout only                                                          | No channel awareness                                  | Rust promotion must prevent duplicate channel listeners/sends.        |
| Dashboard APIs              | Dashboard assumes Node WS and payloads                                                           | No dashboard authority; only service-panel launch                                        | No dashboard authority                                | Dashboard smoke tests required before canary.                         |
| Health/status/doctor output | `argent status`, `doctor`, daemon status, health probes; executive shadow already visible        | Rust gateway service appears in dashboard only; missing CLI status line before this lane | Executive shadow status and kernel inspection visible | Add Rust gateway shadow readiness/status.                             |
| Logs/observability          | Node subsystem logs, health snapshots, diagnostic heartbeat, status/doctor                       | Minimal stdout and health JSON                                                           | Journal, metrics, timeline                            | Need unified shadow report and drift logs.                            |
| Crash/restart recovery      | LaunchAgent/service restart, restart sentinel, runtime cleanup                                   | No durable gateway state; process restart only                                           | Restart recovery tested by snapshot+journal           | Need gateway crash/reconnect tests and executive longer soak.         |
| Config loading              | Node config is source of truth                                                                   | Env-only bind/token                                                                      | Env-only bind/state/tick/lease                        | Rust cannot load/write live config yet.                               |
| State persistence           | Node owns config/sessions/workflows/cron/plugin/channel data                                     | None                                                                                     | Shadow executive-only snapshot/journal                | Migration safety and single-writer rules missing.                     |

## Shadow Mode Contract

### Rust Should Observe

- Health and reachability of Node gateway and Rust shadow services.
- Protocol version, connect handshake shape, close/error behavior, and auth mismatch behavior.
- Read-only request/response shape for safe methods such as `health`, `status`, `system-presence`, `models.list`, `channels.status`, `connectors.catalog`, `sessions.list`, `cron.status`, `workflows.list`, and `tools.status`.
- Event shape for safe synthetic events: `health`, `heartbeat`, `cron`, `node.pair.*`, `device.pair.*`, `exec.approval.*`, `terminal`, and `shutdown`.
- Executive/kernel lane and scheduler-state summaries when both TypeScript kernel and `argent-execd` are available.
- Timer inventory, but not timer execution, until duplicate-timer prevention is proven.

### Rust May Mirror

- Read-only health/status/presence probes.
- Golden protocol fixtures captured from Node and replayed against Rust.
- Synthetic non-mutating WebSocket request frames.
- Synthetic mutating-looking frames only when explicitly marked `__shadowReplay` and routed to a Rust-only daemon with no live side effects.
- Executive lane requests/ticks only inside Rust shadow state directories.

### Rust Must Not Mirror Yet

- Live chat/send/agent/tool execution.
- Channel inbound listeners or outbound sends.
- Workflow run, resume, approval, event emission, or AppForge event emission.
- Cron add/update/remove/run against live state.
- Session patch/reset/delete/compact.
- Config writes, plugin installs/updates, auth changes, token rotation/revocation.
- Dashboard writes or Swift app live control traffic.

### State Drift Checks

Track differences as structured shadow drift records:

- `nodeReachable`, `rustGatewayReachable`, `rustExecutiveReachable`.
- protocol version compatibility.
- method support: supported/missing/mock/live-equivalent.
- response schema compatibility for golden fixtures.
- event schema compatibility.
- TypeScript kernel active lane vs `argent-execd` active lane.
- timer inventory count and IDs, without executing timers.
- restart recovery markers for Rust executive.

### Kernel Decisions Compared

Compare only read-only decisions at first:

- active lane.
- effective focus/current focus.
- scheduler authority active/inactive.
- last executive event summary.
- pending lane count/priority.
- tick count and next tick due time.

Do not let Rust decisions suppress TypeScript behavior until the promotion gates pass.

### Ignored / Non-Mirrored Surfaces

- Live model/provider dispatch.
- Tool side effects.
- External network writes.
- Channel sends/replies/reactions.
- Workflow execution side effects.
- AppForge data writes.
- AOS connector live writes.
- Dashboard config changes.
- Pairing/token mutations.

### Shadow-Mode Failure Definition

Shadow mode fails when any of these occur:

- Rust service writes or mutates live Node-owned state without an explicit canary flag.
- Rust service sends external channel traffic.
- Rust service starts a duplicate live timer, workflow run, channel listener, or agent run.
- Rust protocol response claims success for a live behavior it does not actually implement.
- Drift logger cannot distinguish mock parity from live parity.
- Restart recovery loses Rust executive state or replays duplicate lane/timer decisions.
- Operator status reports Rust readiness as healthy while required probes are unreachable or unvalidated.

### Logged But Not User-Facing

- Expected mock-vs-live payload differences during early fixture replay.
- Unsupported method drift for surfaces not in the current slice.
- Rust shadow daemon unavailable when not enabled by the operator.
- Slow Rust shadow probes under the configured timeout.
- Synthetic replay-only events.

## Promotion Gates

Rust cannot become live gateway/kernel authority until all gates below are satisfied and recorded in a promotion readiness report.

- Protocol parity tests:
  - Node and Rust accept/reject the same connect frames.
  - Node and Rust agree on request/response frame envelope shape.
  - Node and Rust agree on event envelope shape and sequence rules.
- RPC compatibility tests:
  - Golden fixtures for read methods pass.
  - Golden fixtures for write methods are either live-equivalent in an isolated sandbox or explicitly blocked.
  - Unknown method and auth errors match Node semantics.
- Dashboard smoke tests:
  - Dashboard connects to Rust canary endpoint in opt-in mode.
  - Status, logs, channels, sessions, workflows list, cron status, and terminal/browser read surfaces are smoke-tested.
- Swift app smoke tests:
  - iOS/macOS connect, reconnect, auth failure, protocol mismatch, request timeout, and core read methods work against canary.
- Workflow run smoke tests:
  - Manual workflow run in isolated state.
  - Approval wait/resume in isolated state.
  - AppForge event path only after AppForge coordination.
- Schedule/reminder smoke tests:
  - Cron list/status parity.
  - Isolated add/update/remove/run.
  - Restart does not duplicate timers.
  - Node fallback disables Rust timers cleanly.
- Restart/recovery tests:
  - Gateway restart preserves protocol availability.
  - Executive restart preserves lane state and journal.
  - Reconnects do not lose or duplicate events.
- Database/state migration safety:
  - Single-writer ownership per state surface.
  - Migration dry run and rollback path.
  - No hidden dual-writes without drift reporting.
- Fallback to Node:
  - Node remains installed and startable.
  - Canary can be disabled without data migration.
  - Existing dashboard/Swift configs can return to `18789`.
- Operator rollback command:
  - Document and test rollback command before canary.
  - Rollback must stop Rust authority and restore Node authority.
- No silent data loss:
  - All dropped/ignored shadow events counted.
  - All unsupported live surfaces fail closed.
- No duplicated timers/channels/runs:
  - Rust authority must prove it cannot double-fire cron jobs, heartbeat wakeups, workflow schedules, channel listeners, or agent runs during promotion/cutback.

## Implementation Slices

### Slice A: Inventory + Parity Matrix

- Create this plan.
- Add status/readiness inventory for Rust gateway and executive surfaces.
- Record current missing tests and drift risks.
- No live behavior changes.

### Slice B: Golden Protocol Test Harness

- Capture Node gateway golden fixtures for connect, health, status, known errors, and selected read methods.
- Replay fixtures against `argentd`.
- Label each fixture as `exact`, `schema-compatible`, `mock-compatible`, `unsupported`, or `unsafe`.

### Slice C: Shadow-Mode Drift Logger

- Add structured drift records under `.omx/state/rust-gateway-shadow/` or an operator state dir.
- Record method support, schema differences, event differences, and kernel/executive lane differences.
- Keep drift logs non-user-facing until summarized.

### Slice D: Health/Status Reporting for Rust Shadow

- Add `argent status` / doctor visibility for `argentd` and `argent-execd`.
- Include reachability, version, uptime, protocol coverage summary, executive tick/lane/journal summary, and last drift record path when present.
- Keep unavailable Rust shadow services informational, not fatal.

### Slice E: Scheduler/Timer Boundary Plan

- Inventory cron, heartbeat, workflow schedule, reminder, contemplation, SIS, job-orchestrator, and update-check timers.
- Define single-authority and fallback behavior for each timer class.
- Coordinate with Workflows before touching runtime/scheduler files.

### Slice F: Kernel Authority Boundary Hardening

- Formalize TypeScript kernel vs `argent-execd` authority states:
  - shadow-observe
  - read-only-consume
  - canary-decide-no-side-effects
  - canary-authority-isolated
  - live-authority
- Add assertions that prevent live side effects outside the selected state.

### Slice G: Opt-In Canary Mode

- Add explicit canary flag and port/config separation.
- Route selected clients to Rust only by explicit operator opt-in.
- Preserve Node fallback and no automatic cutover.

### Slice H: Rollback/Fallback Path

- Add tested command/runbook to stop Rust canary authority and restore Node live authority.
- Verify no duplicate timers, stuck channels, or orphaned runs after rollback.

### Slice I: Promotion Readiness Report

- Generate a report covering all gates, tests, smoke evidence, drift history, known gaps, and rollback evidence.
- Promotion requires explicit release decision.

## First Implementation Target

Recommended first code slice: Slice D, read-only Rust gateway shadow status reporting.

Rationale:

- It does not touch live traffic takeover.
- It gives operators a measurable signal for `argentd`, matching the existing `argent-execd` status path.
- It helps future golden harness work by making Rust gateway reachability/version visible in normal diagnostics.
- It avoids workflow runtime, scheduler, AOS connector, AppForge dashboard APIs, and database state.

Initial target:

- Add a best-effort `getRustGatewayShadowSummary` that probes `http://127.0.0.1:18799/health`.
- Add `rustGatewayShadow` to status summary JSON.
- Add a human-readable `Rust gateway shadow` row to `argent status`.
- Treat unreachable as informational because the shadow service is operator-started and disabled by default.

## Existing Tests And Missing Tests

Existing relevant tests:

- Rust gateway:
  - `cargo test -p argentd`
  - `rust/argentd/tests/http_parity.rs`
  - `rust/argentd/tests/ws_parity.rs`
- Rust executive:
  - `cargo test -p argent-execd`
  - `rust/argent-execd/tests/http_control.rs`
  - `rust/argent-execd/tests/lease_expiry.rs`
  - `rust/argent-execd/tests/restart_recovery.rs`
  - `rust/argent-execd/scripts/restart-smoke.sh`
  - `rust/argent-execd/scripts/lease-soak.sh`
  - `rust/argent-execd/scripts/restart-poll-soak.sh`
- TypeScript executive shadow:
  - `src/infra/executive-shadow-contract.test.ts`
  - `src/infra/executive-shadow-client.test.ts`
  - `src/infra/executive-shadow-client.integration.test.ts`
  - `src/infra/executive-shadow-kernel-inspector.test.ts`
  - `src/commands/status.executive-shadow.test.ts`
- Node gateway:
  - Broad unit/e2e coverage under `src/gateway/**`.
  - Method tests under `src/gateway/server-methods/**`.
  - Cron/workflow tests under `src/cron/**`, `src/infra/workflow-*`, and `src/gateway/server-methods/workflows*.test.ts`.

Missing tests:

- Node-vs-Rust golden WebSocket protocol comparison.
- Auth and role/scope parity comparison.
- Dashboard smoke against Rust canary.
- Swift app smoke against Rust canary.
- Workflow and cron isolated canary run tests.
- Duplicate timer/channel/run prevention tests.
- Rust gateway restart/reconnect behavior.
- Rust gateway dynamic plugin/channel/AOS method registration parity.
- Rust gateway status/doctor readiness reporting before this slice.
- Migration and rollback rehearsals.

## Major Risks

- Mock parity can be mistaken for live parity.
- Cron/workflow/heartbeat timers can double-fire during any partial cutover.
- Channel adapters can duplicate inbound listeners or outbound sends.
- Dashboard and Swift apps assume Node port/protocol/payload details.
- Auth in Rust gateway is currently much thinner than Node authorization.
- Rust gateway has broad method names but no dynamic plugin registry or live state.
- `argent-execd` has durable substrate behavior, but TypeScript kernel still owns product behavior and scheduler integration.
- The workflow/docpanel fix branch is separate and must not receive Rust-spine changes.

## Coordination Notes

- Coordination board read: `ops/THREADMASTER_COORDINATION.md`.
- Bus currently does not recognize a `rust-spine` lane; known lanes are `master`, `workflows`, `appforge`, `aou`, `aos`, `openclaw`, `hermes`, `roomreader`, `business`, `agent-persona`, and `all`.
- This lane is isolated in worktree `/Users/sem/code/argent-core-rust-spine` on branch `codex/rust-gateway-kernel-transition`.
- Use `master`/targeted known lanes for durable bus notifications unless a Rust lane is added to the bus.
- Coordinate with Workflows before touching `src/infra/workflow-*`, `src/gateway/server-methods/workflows*.ts`, workflow schedule reconciliation, or cron/workflow run semantics.
- Coordinate with AOS before changing `tools/aos/**`, `connectors.catalog`, workflow connector exposure, or connector command behavior.
- Coordinate with AppForge before changing dashboard/gateway AppForge APIs or AppForge event payloads.

## Next Agent / Thread Checklist

1. Work from `/Users/sem/code/argent-core-rust-spine`, not `/Users/sem/code/argent-core`.
2. Verify repo/branch before edits: `ArgentAIOS/argentos-core`, branch `codex/rust-gateway-kernel-transition`.
3. Preserve unrelated dirty files in other worktrees and branches.
4. Keep Rust shadow work read-only until parity and rollback gates pass.
5. Prefer the next parity-evidence increment: convert mock-compatible fixture coverage into real comparison evidence and add dashboard/client smoke gates.
6. Before any push to `origin/dev`, recompute and bump the root `package.json` dev version per AGENTS.md.

## Implementation Progress

Completed safe scaffolding so far:

1. Slice A plan artifact and inventory.
2. Slice D read-only `argent status` Rust gateway shadow readiness row.
3. Slice B fixture catalog with safety labels.
4. Slice B replay/classification engine.
5. Slice B WebSocket transport for explicit Node/Rust endpoints.
6. Slice B isolated coordinator with reverse-order cleanup.
7. Slice B concrete isolated Node gateway and `argentd` process starters.
8. Slice I parity Markdown report renderer.
9. Slice I promotion readiness evaluator.
10. Slice C shadow drift JSONL event formatter.
11. Slice B/I opt-in local parity report script: `pnpm rust-gateway:parity:report -- [options]`.
12. Sprint 1 started: latest parity report status surface and freshness classifier.
13. Sprint 1 continued: grouped parity report sections, categorized drift notes, slow read-only fixture timeout override, and expanded read-only fixture coverage.
14. Sprint 1 continued: Rust gateway HTTP health now declares shadow mode, protocol version, Node live authority, shadow-only gateway authority, promotion readiness false, and memory-only persistence; CLI status surfaces these fields.
15. Slice E/H planning: `ops/RUST_GATEWAY_SCHEDULER_TIMER_BOUNDARY_PLAN.md` defines Node timer authority, Rust shadow limits, duplicate-execution risks, authority-record requirements, promotion gates, and rollback/fallback command shape.
16. Slice D/E status: `argent status` now includes a read-only scheduler authority row that declares Node as live scheduler authority, Rust as shadow-only, counts cron/workflow timer jobs, and reports no authority record yet.
17. Slice I handoff: `ops/RUST_GATEWAY_PROMOTION_READINESS_HANDOFF.md` captures promotion readiness, remaining blockers, current authority, percentages, and next commands.
18. Slice I machine summary: `pnpm rust-gateway:parity:report` now writes `rust-gateway-readiness-summary.json`.
19. Slice H planning/status: `argent gateway authority status` is read-only and reports Node authority, Rust shadow-only status, latest parity freshness, scheduler authority, and planned rollback command shape.
20. Slice H design: `ops/RUST_GATEWAY_ROLLBACK_FALLBACK_COMMAND_DESIGN.md` defines read-only-first rollback/fallback command sequencing.
21. Parity evidence hardening: schema-compatible fixtures now validate known payload shapes for `connect`, `health`, `system-presence`, and `config.schema`; readiness summary now includes explicit gate statuses.

Still not done, by design:

- no live gateway authority switch,
- no workflow scheduler/timer ownership changes,
- no AOS connector exposure changes,
- no AppForge/dashboard API contract changes,
- no canary mode or rollback command yet.
