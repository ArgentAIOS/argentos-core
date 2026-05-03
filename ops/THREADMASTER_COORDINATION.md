# Threadmaster Coordination Board

Last polled: 2026-04-26

## Lane Lock

Repo: `ArgentAIOS/argentos-core`
Local path: `/Users/sem/code/argent-core`
Target branch: `dev`
Forbidden repo for core work: `ArgentAIOS/argentos`

This board is the shared coordination surface for active core threadmasters. Poll it before starting a slice, before touching overlap files, and before push/handoff.

The Workflows threadmaster is also acting as the master threadmaster for core coordination unless the operator assigns a different lead.

## Protocol

1. Add or update your lane entry when starting work.
2. Mark owned files or directories before editing shared surfaces.
3. Use the threadmaster bus for targeted lane-to-lane messages.
4. Add durable contract summaries under `Threadmaster Messages` when another lane should react.
5. Before pushing to `origin/dev`, bump the root `package.json` dev version using the daily sequence contract in `AGENTS.md`.
6. Keep entries short. Link to detailed handoff files instead of pasting full plans here.

**Posting cadence:** Lanes post on state transitions ONLY: `STARTED`, `READY`, `BLOCKED`, `MERGED`, `CONTAINED`. Heartbeat / idle / standby / checkpoint posts are forbidden. The bus is a coordination ledger, not a liveness check. Lanes presumed alive between transitions.

Checkpoint cadence: prefer small, verified checkpoints to `origin/dev` over large multi-lane batch merges. When a slice is clean, rebased on latest `origin/dev`, verified, truth-labeled, and safe for `argent update`, move it through custody and land it with the next dev version instead of waiting for unrelated lanes. READY packets should not sit while another lane is stale; keep clean packets moving and open rescue/escalation tasks for the stale lane. Every checkpoint must say what is enabled, what remains dry-run/shadow/deferred, and what is explicitly not live.

For targeted lane-to-lane messages, prefer the threadmaster bus:

```sh
pnpm threadmaster:post --from workflows --to appforge --subject "Need event contract" --body "Confirm payload fields before changing workflow resume logic."
pnpm threadmaster:list --lane workflows --unacked
pnpm threadmaster:ack --lane workflows --id <message-id>
pnpm threadmaster:task-add --from master --owner appforge --title "Next task" --body "Concrete next step."
pnpm threadmaster:task-list --lane appforge
pnpm threadmaster:status
```

Bus docs: `ops/threadmaster-bus/README.md`.

## Active Lanes

| Lane                                                  | Threadmaster                     | Scope                                                                                                                     | Current State                                                                                                                                                                                                                                                                       | Shared Boundaries                                                                                                                                                                                |
| ----------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Master coordination + Workflows canvas/runtime        | Codex workflow threadmaster      | Cross-lane coordination, workflow builder canvas, workflow gateway/runtime, output channels, approval/wait/event surfaces | Bus/coordination lane in progress at `1f30784b`; output node configurability and real channel discovery pushed to `dev` at `ad964716`                                                                                                                                               | Consumes AppForge through metadata/events only; consumes AOS connectors through manifests/capabilities only                                                                                      |
| AppForge 2.0                                          | AppForge threadmaster            | Airtable-like core workspace, AppForge adapter/model/gateway, structured metadata, AppForge event producers               | Ralph Phase 3D active on `codex/appforge-phase-3d-browser-save-fix`; browser smoke found AppForge metadata save needs a narrow browser-safe API overlap                                                                                                                             | Must not import Workflow dashboard internals; coordinate before touching workflow files                                                                                                          |
| AOU Stub Finder                                       | AOU threadmaster                 | Stub discovery, connector/tool completeness, skeleton-vs-live implementation inventory                                    | Active in its own threadmaster lane                                                                                                                                                                                                                                                 | Report stub findings here before changing shared runtime or connector surfaces                                                                                                                   |
| AOS connectors                                        | Codex AOS connector threadmaster | `tools/aos/**`, connector manifests, operator service-key resolution, connector command capability surfaces               | Branch `codex/aos-holace-loop` from `origin/dev` `4ad2a5a8`; current slice owns `tools/aos/aos-holace/**` to convert the stub into a truthful AOS CLI connector                                                                                                                     | Workflows/AppForge should consume connector metadata/capabilities, not private connector internals                                                                                               |
| OpenClaw 4.24 realtime/browser/marketplace comparison | Codex OpenClaw threadmaster      | Upstream 4.24 feature comparison and additive browser/realtime voice/Google Meet marketplace-plugin implementation slices | Active on `codex/openclaw-talk-realtime-session` from current `origin/dev` after wave 1 merged at `7a4ce141`; current slice owns public `talk.realtime.session` plus gateway relay controls, `talk.realtime` config/types, protocol schema/method registration, and changelog notes | Owns OpenClaw-approved Talk/realtime files only; no AOS connector files, no AppForge/Workflows internals, no schema migrations, no Google Meet live lifecycle/audio, no phone telephony realtime |
| Agent Persona/Profile                                 | Agent Persona threadmaster       | Agent Profile tab, per-agent TTS/profile config, profile APIs, redacted agent-local auth/account summaries                | New lane `agent-persona`; canonical plan `.omx/plans/agent-profile-first-class-plan-2026-04-28.md`; onboarding prompt `ops/AGENT_PERSONA_ONBOARDING_PROMPT.md`; first task assigned through the bus.                                                                                | Must not touch Workflows/AppForge/AOS/OpenClaw Voice/Business surfaces without a specific Master bus task; secrets must stay redacted and out of persona markdown files                          |
| OpenAI Codex device OAuth                             | Codex auth slice                 | OpenAI Codex OAuth reconnect/login, dashboard auth start/status UX, auth profile refresh/import                           | Clean handoff branch `codex/openai-codex-device-flow`; see `ops/HANDOFF_OPENAI_CODEX_DEVICE_FLOW.md`                                                                                                                                                                                | Coordinates with dashboard/settings and auth-profile owners before changing provider defaults                                                                                                    |

## Overlap Zones

| Surface                                                                             | Owner For Writes    | Other Lanes Need Coordination When                                                               |
| ----------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------ |
| `src/gateway/server-methods/workflows.ts`                                           | Workflows           | AppForge event bridge needs new workflow event/approval behavior                                 |
| `src/infra/workflow-*`                                                              | Workflows           | AppForge review gates or AOS connector actions need runtime contract changes                     |
| `dashboard/src/components/widgets/WorkflowsWidget.tsx`                              | Workflows           | AppForge wants UI integration beyond metadata/capability display                                 |
| `src/infra/app-forge-*`                                                             | AppForge            | Workflows needs new metadata/event/capability contracts                                          |
| `src/gateway/server-methods/app-forge*`                                             | AppForge            | Workflows needs producer/consumer event boundary changes                                         |
| `dashboard/src/components/AppForge.tsx` and `dashboard/src/components/app-forge/**` | AppForge            | Workflows needs AppForge UI to expose workflow-capability review/build actions                   |
| `dashboard/src/App.tsx`                                                             | Coordinated         | AppForge needs parent-level gateway/request plumbing                                             |
| `tools/aos/**`                                                                      | AOS connectors      | Workflows/AppForge need connector manifest/action contract changes                               |
| Agent profile/config/API/UI surfaces                                                | Agent Persona       | Any lane needs per-agent identity, TTS, auth-profile, account-binding, or persona-file contracts |
| `src/data/pg/schema.ts` and migrations                                              | Coordinated         | Any lane needs durable schema changes                                                            |
| Stub/parity reports under `ops/**`                                                  | Master threadmaster | Findings create cross-lane work or imply implementation ownership                                |
| package, version, update, and release files                                         | Coordinated         | Any lane needs installer/update/runtime behavior changes                                         |

## Current Cross-Lane Contracts

- Dev version contract: every successful `origin/dev` push must include a unique root `package.json` version using `YYYY.M.D-dev.N` in America/Chicago time. Start each new date at `dev.0`, increment `N` for every later push that day, and recompute after fetch/rebase if another lane landed first. Display/tag form may use `vYYYY.M.D-dev.N`; `package.json` stores no `v`.
- Dev checkpoint cadence contract: land small, verified, safe checkpoints to `origin/dev` as soon as they are custody-clean. Do not batch unrelated lane work into giant merges. Do not block clean READY packets behind stale lanes. Use rescue tasks for stale/blocking lanes, and preserve explicit truth labels for dry-run, shadow-only, deferred, no-live-side-effect, and not-authorized surfaces.
- AppForge -> Workflows: canonical local events through `workflows.emitAppForgeEvent`.
- Workflows -> AppForge: metadata/capability discovery only. Do not couple to AppForge UI internals.
- AOS connectors -> Workflows/AppForge: connector manifests, permissions, and capabilities are the source of truth.
- Workflow output channels: advertised choices should reflect real configured operator channels or explicit manual endpoints, not hard-coded wishful options.
- Workflow import/export: canonical Argent workflow packages are executable definition first, canvas layout second, with credentials/dependencies and pinned test fixtures declared explicitly.
- External writes/outbound delivery: default posture remains operator approval unless explicitly trusted.
- AppForge is still single-operator safe, not multi-user write-safe, until the permission/actor/audit seam is enforced.

## AppForge 2.0 Current Detail

### Lane

- Repo: `ArgentAIOS/argentos-core`
- Local path from AppForge lane: `/Users/sem/code/argent-core-appforge-dev`
- Branch: `codex/appforge-structured-events`
- Target branch: `dev`
- Current known commits on `origin/dev`: `e22dc0e8`, `b36fb45e`, `a90966c3`, `90215928`, `7acd9d2e`, `6507221d`, `3dc5e7f6`
- Current bus state: `appforge` has no unacked messages; task `task-20260426155725-f6z379` completed in `3dc5e7f6`.
- Current slice: structured local event contract pushed to `dev` at `3dc5e7f6`; completion posted as `tm-20260426160541-6341o1`.
- Forbidden repo for this lane: `ArgentAIOS/argentos`

### Owned Files And Directories

Current AppForge Threadmaster ownership:

- `src/infra/app-forge-*.ts`
- `src/infra/appforge-workflow-events.test.ts`
- `src/infra/appforge-workflow-capabilities.test.ts`
- `src/gateway/server-methods/app-forge*.ts`
- AppForge-specific ops notes:
  - `ops/HANDOFF_APP_FORGE_*.md`
  - `ops/THREADMASTER_COORDINATION.md`

Shared registration files touched only as Threadmaster-approved gateway registration exceptions:

- `src/gateway/server-methods.ts`
- `src/gateway/server-methods-list.ts`
- `dashboard/src/App.tsx` for narrow AppForge `gateway.request` prop plumbing only

Do not touch without coordination:

- `src/infra/workflow-*.ts`
- `src/gateway/server-methods/workflows*.ts`
- `dashboard/src/components/widgets/WorkflowsWidget.tsx`
- `tools/aos/**`
- package, version, update, and release files

### Shared Contract Changes

AppForge core model and adapter:

- `AppForgeBase`, `AppForgeTable`, `AppForgeField`, and `AppForgeRecord` are defined in `src/infra/app-forge-model.ts`.
- `AppForgeAdapter` now supports base, table, and record operations.
- In-memory adapter semantics are clone-safe, revision-checked, and support idempotent `put*` operations.

AppForge gateway:

- New gateway methods:
  - `appforge.bases.list`
  - `appforge.bases.get`
  - `appforge.bases.put`
  - `appforge.bases.delete`
  - `appforge.tables.list`
  - `appforge.tables.get`
  - `appforge.tables.put`
  - `appforge.tables.delete`
  - `appforge.records.list`
  - `appforge.records.get`
  - `appforge.records.put`
  - `appforge.records.delete`
- Read methods require `operator.read` or `operator.write`.
- Write/delete methods require `operator.write`.
- Field and view edits currently remain table-payload semantics until a separate API is explicitly designed.

AppForge workflow bridge:

- Canonical events:
  - `forge.table.created`
  - `forge.table.updated`
  - `forge.table.deleted`
  - `forge.record.created`
  - `forge.record.updated`
  - `forge.record.deleted`
  - `forge.review.requested`
  - `forge.review.completed`
  - `forge.capability.completed`
- Workflows boundary remains metadata/events only.
- AppForge must not import Workflow dashboard internals.

AppForge permissions:

- `src/infra/app-forge-permissions.ts` defines the pure actor/ACL/audit seam.
- Current seam is not wired into dashboard/API mutations yet.
- AppForge is still single-operator safe, not multi-user write-safe.

### Required Reactions

Workflows:

- Continue consuming AppForge only through metadata and `workflows.emitAppForgeEvent`.
- Do not depend on AppForge UI/component internals.
- Runtime event bridge work can rely on the canonical `forge.*` event names above.
- Table trigger/wait filters can now target `forge.table.created`, `forge.table.updated`, and `forge.table.deleted`; see `ops/HANDOFF_APP_FORGE_WORKFLOW_EVENTS.md`.

AppForge:

- Next implementation should migrate dashboard table/record mutations onto `appforge.tables.*` and `appforge.records.*` with a safe metadata fallback.
- Dashboard should migrate event emission toward gateway `workflows.emitAppForgeEvent` with API fallback.
- Dashboard structured-data writes should not switch exclusively to `appforge.bases.put` until durable storage or safe dual-write is in place.
- Multi-user features must wait for the permission/actor/audit seam to be enforced.

AOU:

- Treat AppForge as a core substrate under `ArgentAIOS/argentos-core`.
- Do not route core AppForge work through `ArgentAIOS/argentos`.
- Do not advertise AppForge collaboration as permission-safe until ACL enforcement and actor-bound audit are wired.

## Threadmaster Messages

(Older messages archived; bus is event-driven via threadmaster-bus JSONL.)

## Verification Snapshot

Latest AOS focused verification after threadmaster bus adoption:

- `pnpm threadmaster:status`
- `pnpm threadmaster:list --lane aos --unacked`
- `pnpm threadmaster:task-list --lane aos`
- Isolated harness sweep, one connector `agent-harness` at a time:
  - `aos-airtable`: 24 passed
  - `aos-monday`: 15 passed
  - `aos-hubspot`: 24 passed
  - `aos-dart`: 11 passed
  - `aos-zapier`: 13 passed
  - `aos-n8n`: 12 passed
  - `aos-hootsuite`: 14 passed
  - `aos-slack`: 16 passed
  - `aos-teams`: 13 passed
  - `aos-buffer`: 15 passed
  - `aos-discord-workflow`: 13 passed
- `python -m json.tool` passed for all connector manifests above.

Latest AppForge focused verification after rebase onto `origin/dev`:

- `pnpm check:repo-lane`
- `pnpm exec vitest run src/infra/app-forge-adapter.test.ts src/infra/app-forge-permissions.test.ts src/gateway/server-methods/app-forge.test.ts src/infra/app-forge-model.test.ts src/infra/appforge-workflow-events.test.ts src/gateway/server-methods/workflows.appforge-events.test.ts src/infra/appforge-workflow-capabilities.test.ts src/infra/app-forge-structured-data.test.ts`
- `pnpm exec oxlint --type-aware src/infra/app-forge-adapter.ts src/infra/app-forge-adapter.test.ts src/infra/app-forge-permissions.ts src/infra/app-forge-permissions.test.ts src/gateway/server-methods/app-forge.ts src/gateway/server-methods/app-forge.test.ts`

Known unrelated failures remain documented in `ops/HANDOFF_APP_FORGE_THREADMASTER_STATUS.md`.
