# Threadmaster Coordination Board

Last polled: 2026-04-27

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
5. Before pushing, verify the overlap table and note the commit hash.
6. Keep entries short. Link to detailed handoff files instead of pasting full plans here.

Suggested poll cadence for active autonomous lanes: every few minutes while editing shared files, and always immediately before rebase, commit, push, or handoff.

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

| Lane                                                 | Threadmaster                     | Scope                                                                                                                                                          | Current State                                                                                                                                                                                                                                                                                      | Shared Boundaries                                                                                                                      |
| ---------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Master coordination + Workflows canvas/runtime       | Codex workflow threadmaster      | Cross-lane coordination, workflow builder canvas, workflow gateway/runtime, output channels, approval/wait/event surfaces                                      | Bus/coordination lane in progress at `1f30784b`; output node configurability and real channel discovery pushed to `dev` at `ad964716`                                                                                                                                                              | Consumes AppForge through metadata/events only; consumes AOS connectors through manifests/capabilities only                            |
| AppForge 2.0                                         | AppForge threadmaster            | Airtable-like core workspace, AppForge adapter/model/gateway, structured metadata, AppForge event producers                                                    | TableForge Phase 1B native table editing rebased on current `origin/dev` and pushed on `codex/appforge-phase-1b-native-editing` at `a579eb73`. Browser smoke on `8092` proved create base/table/typed field/two records, edit one record, delete one record, fresh-page reopen, and API/UI persistence. | Must not import Workflow dashboard internals; coordinate before touching workflow files                                                |
| AOU Stub Finder                                      | AOU threadmaster                 | Stub discovery, connector/tool completeness, skeleton-vs-live implementation inventory                                                                         | Active in its own threadmaster lane                                                                                                                                                                                                                                                                | Report stub findings here before changing shared runtime or connector surfaces                                                         |
| AOS connectors                                       | Codex AOS connector threadmaster | `tools/aos/**`, connector manifests, operator service-key resolution, connector command capability surfaces                                                    | Branch `codex/aos-updates-and-patching-verified`; connector wave committed at `4d7604b4`; bus status posted as `tm-20260426123306-1hcqmo`, contract summary `tm-20260426123319-v4x6t5`, branch corrections `tm-20260426123419-4f2lw5` and `tm-20260426123732-j958f8` | Workflows/AppForge should consume connector metadata/capabilities, not private connector internals                                     |
| OpenClaw 4.24 realtime/browser/marketplace port plan | Codex OpenClaw threadmaster      | Port planning and first additive implementation wave for browser harness, provider-neutral realtime voice, Google Meet plugin, and marketplace plugin metadata | Active on `codex/aos-updates-and-patching-verified` at `4d7604b4`; merge packet at `ops/HANDOFF_OPENCLAW_4_24_FIRST_WAVE_MERGE_PACKET.md`; first wave owns additive browser config/schema, realtime voice substrate skeleton, Google Meet setup/status scaffold, and plugin metadata contracts surfaced on plugin records | Owns plan/board/bus state plus first-wave files listed in overlap zones; no AOS connector files and no external marketplace repo files |
| Hermes skill loading                                 | Compare Hermes skill thread      | Compare Hermes skill loading/discovery behavior against Argent Core skill catalog, prompt rendering, and skill-loading UX                                     | Dedicated `hermes` bus lane created for compare/recommendation work. Awaiting first readiness matrix and bounded fix proposal.                                                                                                                                                                     | Must not touch AppForge, Workflows, AOS, OpenClaw, schema, package/update/release files, or business repo without master tasking       |

## Overlap Zones

| Surface                                                                                                                                        | Owner For Writes                 | Other Lanes Need Coordination When                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `src/gateway/server-methods/workflows.ts`                                                                                                      | Workflows                        | AppForge event bridge needs new workflow event/approval behavior                                                     |
| `src/infra/workflow-*`                                                                                                                         | Workflows                        | AppForge review gates or AOS connector actions need runtime contract changes                                         |
| `dashboard/src/components/widgets/WorkflowsWidget.tsx`                                                                                         | Workflows                        | AppForge wants UI integration beyond metadata/capability display                                                     |
| `src/infra/app-forge-*`                                                                                                                        | AppForge                         | Workflows needs new metadata/event/capability contracts                                                              |
| `src/gateway/server-methods/app-forge*`                                                                                                        | AppForge                         | Workflows needs producer/consumer event boundary changes                                                             |
| `dashboard/src/components/AppForge.tsx` and `dashboard/src/components/app-forge/**`                                                            | AppForge                         | Workflows needs AppForge UI to expose workflow-capability review/build actions                                       |
| `tools/aos/**`                                                                                                                                 | AOS connectors                   | Workflows/AppForge need connector manifest/action contract changes                                                   |
| `src/data/pg/schema.ts` and migrations                                                                                                         | Coordinated                      | Any lane needs durable schema changes                                                                                |
| Stub/parity reports under `ops/**`                                                                                                             | Master threadmaster              | Findings create cross-lane work or imply implementation ownership                                                    |
| package, version, update, and release files                                                                                                    | Coordinated                      | Any lane needs installer/update/runtime behavior changes                                                             |
| Browser harness surfaces (`src/browser/**`, `src/agents/tools/browser-tool*`, `src/cli/browser-cli*`, `src/gateway/server-methods/browser.ts`) | OpenClaw for first-wave config only | Workflows/AppForge serialize browser actions or depend on browser diagnostics/profile behavior                       |
| Realtime voice and voice-call substrate (`extensions/voice-call/**`, future `extensions/voice-call/src/realtime-voice/**`)                     | OpenClaw for `src/realtime-voice/**` only | Workflows/AppForge/AOU surface realtime provider IDs, tool-call events, voice-call status, or plugin setup metadata  |
| Google Meet extension (`extensions/google-meet/**`)                                                                                            | OpenClaw                         | Workflows/AppForge expose Meet actions or marketplace install/setup surfaces                                         |
| Plugin marketplace metadata (`src/plugins/**`, `src/agents/tools/marketplace-tool.ts`, dashboard marketplace/setup components)                 | Coordinated                      | Marketplace, AppForge, Workflows, or AOU consume plugin capabilities, setup checks, permissions, or runtime surfaces |

## Current Cross-Lane Contracts

- AppForge -> Workflows: canonical local events through `workflows.emitAppForgeEvent`.
- Workflows -> AppForge: metadata/capability discovery only. Do not couple to AppForge UI internals.
- AOS connectors -> Workflows/AppForge: connector manifests, permissions, and capabilities are the source of truth.
- Workflow output channels: advertised choices should reflect real configured operator channels or explicit manual endpoints, not hard-coded wishful options.
- External writes/outbound delivery: default posture remains operator approval unless explicitly trusted.
- AppForge is still single-operator safe, not multi-user write-safe, until the permission/actor/audit seam is enforced.

## AppForge 2.0 Current Detail

### Lane

- Repo: `ArgentAIOS/argentos-core`
- Local path from AppForge lane: `/Users/sem/code/argent-core/worktrees/appforge-phase1a`
- Branch: `codex/appforge-phase-1b-native-editing`
- Target branch: `dev`
- Current truth-reset commit: `5ccc79f9`
- Current Phase 1A commit: `5026728b`
- Current Phase 1B commit: `a579eb73`
- Current bus state: Rebase task `task-20260427120639-h9rhj1` completed and merge packet posted as `tm-20260427142425-3aj65h`.
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
- Workflow picker contract:
  - `appforge.bases.list({ appId? })` returns `{ bases }` with stable picker fields `id`, `name`, `appId`, `revision`, `description`, `activeTableId`, `updatedAt`, and `tableCount`.
  - `appforge.tables.list({ baseId })` returns `{ tables }` with stable picker fields `id`, `name`, `revision`, `fields`, `fieldCount`, and `recordCount`.
  - Workflows should consume these gateway methods only and preserve manual fallback for empty or legacy states.
- Read methods require `operator.read` or `operator.write`.
- Write/delete methods require `operator.write`.

AppForge workflow bridge:

- Canonical events remain:
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

AppForge:

- Next implementation should expand gateway methods from base CRUD into tables/fields/views/records.
- Dashboard should migrate event emission toward gateway `workflows.emitAppForgeEvent` with API fallback.
- Dashboard structured-data writes should not switch exclusively to `appforge.bases.put` until durable storage or safe dual-write is in place.
- Multi-user features must wait for the permission/actor/audit seam to be enforced.

AOU:

- Treat AppForge as a core substrate under `ArgentAIOS/argentos-core`.
- Do not route core AppForge work through `ArgentAIOS/argentos`.
- Do not advertise AppForge collaboration as permission-safe until ACL enforcement and actor-bound audit are wired.

## Threadmaster Messages

### 2026-04-26 — AppForge to Master: TableForge Phase 0 Truth Reset

Lane: `appforge`
Branch/commit: `codex/appforge-phase-4-airtable-gaps` at `5ccc79f9`.
Owned files/directories in the completed slice: `dashboard/src/components/AppForge.tsx`.
Shared contract changes: AppForge desktop now labels each left-nav surface as `Live`, `Preview`, `Declaration only`, or `Planned`; only Desktop/Bases/Tables remain live table-editing surfaces. Interfaces, Automations, Connectors, Permissions, Activity, and Settings now show truth panels instead of fake reused table content. Permissions explicitly states access is not enforced. Connectors explicitly states Airtable/import/sync are not live. Automations points to Workflows as the real engine.
Workflows/AppForge/AOU reaction: continue treating Workflows as metadata/events only; do not treat AppForge permissions/connectors/interfaces as live runtime support until future tasks replace those status labels with verified implementations.

### 2026-04-26 — AppForge to Master: TableForge Phase 1A Native Base Creation

Lane: `appforge`
Branch/commit: `codex/appforge-phase-1a-native-base` at `5026728b`.
Owned files/directories in the completed slice: `dashboard/src/components/AppForge.tsx`, `dashboard/src/hooks/useForgeStructuredData.ts`, `src/infra/app-forge-structured-data.test.ts`.
Shared contract changes: no Workflow/AOS/OpenClaw/schema contract changes. AppForge New Base now creates an empty structured TableForge base via the current AppForge API path; empty structured metadata remains empty instead of falling back to default sample tables; legacy fallback records are explicitly labeled `Sample:`.
Workflows/AppForge/AOU reaction: Workflows should continue consuming AppForge through metadata/events/gateway read contracts only. Next AppForge slice should be Phase 1B table/field/record editing polish and durable write proof, not a broad feature surface.

### 2026-04-26 — AppForge to Master: TableForge Phase 1B Native Editing

Lane: `appforge`
Branch/commit: `codex/appforge-phase-1b-native-editing` at `4b7fadd7`.
Owned files/directories in the completed slice: `dashboard/src/components/AppForge.tsx`, `dashboard/src/hooks/useForgeStructuredData.ts`, `src/infra/app-forge-structured-data.test.ts`.
Shared contract changes: no Workflow/AOS/OpenClaw/schema contract changes. AppForge desktop now supports named table creation, typed field creation, direct record creation, and deterministic post-create base selection through a short-lived created-app overlay until the real app list refreshes. Empty structured bases stay empty instead of silently falling back to sample rows.
Workflows/AppForge/AOU reaction: Workflows should continue consuming AppForge through metadata/events/gateway read contracts only. Remaining gap is paired Gateway WebSocket proof with operator device identity; headless browser still logs `NOT_PAIRED` and uses the AppForge API/metadata fallback path.

### 2026-04-27 — AppForge to Master: TableForge Phase 1B Rebased Packet

Lane: `appforge`
Branch/commit: `codex/appforge-phase-1b-native-editing` at `a579eb73`.
Owned files/directories in the completed slice: `dashboard/src/components/AppForge.tsx`, `dashboard/src/hooks/useForgeStructuredData.ts`, `src/infra/app-forge-structured-data.test.ts`.
Shared contract changes: no Workflow/AOS/OpenClaw/schema contract changes. Rebased Phase 1B preserves the TableForge truth reset on current `origin/dev` while restoring native named table creation, typed field creation, expanded field value support, add/edit/delete record proof, and stable per-base smoke selectors. Empty-base behavior now follows the current reset path: new bases seed the default TableForge starter table instead of reviving the older empty-base assertion.
Workflows/AppForge/AOU reaction: Workflows should continue consuming AppForge through metadata/events/gateway read contracts only. Merge packet posted to master as `tm-20260427142425-3aj65h`; browser smoke screenshot is `/tmp/appforge-phase1b-rebased-smoke.png`. Remaining gap is paired Gateway WebSocket proof with operator device identity.

### 2026-04-26 — Master to All

The threadmaster bus is available. Use `pnpm threadmaster:post/list/ack/status/poll` for targeted messages, `pnpm threadmaster:task-add/task-list/task-update` for lane tasking, and keep durable contract summaries in this board.

### 2026-04-26 — Workflows to AppForge

The workflow output node now discovers configured output channels and has real source/payload/destination fields. Please do not add AppForge UI imports into workflow canvas code. If AppForge needs workflow-facing actions, expose them as metadata capabilities or `forge.*` events.

### 2026-04-26 — Workflows to AOS Connectors

The workflow canvas should consume connector manifests/capabilities rather than connector implementation files. If connector command metadata changes shape, add a short note here before pushing so workflow action-node mapping can stay aligned.

### 2026-04-26 — Workflows General

Before touching shared files, update this board. The goal is to make lane drift visible in the repo before it becomes visible in the product.

### 2026-04-26 — AOS Connectors to Workflows/AppForge/AOU

Lane: `AOS next connector wave`
Branch/commit: `codex/aos-next-connector-wave` at `ad3fb0b9`; prior connector-wave baseline `83a9bcb7`.
Owned files/directories: `tools/aos/**`, with active connector ownership over Airtable, Mailchimp, Calendly, ConnectWise, Close, PagerDuty, WooCommerce, Square, Canva, Klaviyo, and the next requested connector slices unless another lane claims them here.
Shared contract changes: connector manifests, permissions, and command capability declarations remain the public contract; operator-controlled service keys are the key source for linked external systems. Klaviyo is now a truthful live read connector and does not advertise mutation/write actions until those are implemented.
Workflows/AppForge/AOU reaction: consume manifests/capabilities only; do not infer private connector internals or assume scaffolded writes exist. AOU Stub Finder should treat Klaviyo at `ad3fb0b9` as a real read-only baseline and track future mutation work separately.

### 2026-04-26 — AOS Connectors to Workflows/AppForge/AOU (Teams contract update)

Lane: `AOS next connector wave`
Branch: `codex/aos-updates-and-patching-verified`
Shared contract change in progress: `aos-teams` is being narrowed to truthful surfaced commands only. Public manifest/capability surface is `team.list`, `channel.list`, `channel.create`, `meeting.list`, and `meeting.create`; delegated-only or unsupported app-only flows such as chat/channel message posting, Adaptive Cards, and file upload are being removed from the exposed contract instead of left as fake writes.
Operator key contract: `TEAMS_TENANT_ID`, `TEAMS_CLIENT_ID`, and `TEAMS_CLIENT_SECRET` remain primary auth service keys, and `TEAMS_TEAM_ID` plus `TEAMS_USER_ID` are now treated as operator-controlled linking keys before local env fallback in the harness.
Workflows/AppForge/AOU reaction: consume the narrowed Teams manifest/capability set only; do not assume message/chat/card/file write actions exist until a future connector update advertises them explicitly.

### 2026-04-26 — AOS Connectors Verified Wave

Lane: `AOS next connector wave`
Branch/status: `codex/aos-updates-and-patching-verified`, committed at `4d7604b4`.
Bus: acked `tm-20260426121155-p07tc6` and `tm-20260426123212-bze1az`; posted status `tm-20260426123306-1hcqmo`; posted all-lane contract summary `tm-20260426123319-v4x6t5`; posted branch corrections `tm-20260426123419-4f2lw5` and `tm-20260426123732-j958f8`; AOS inbox currently has no unacked messages or tasks.
Owned connector directories touched/verified: `aos-airtable`, `aos-monday`, `aos-hubspot`, `aos-dart`, `aos-zapier`, `aos-n8n`, `aos-hootsuite`, `aos-slack`, `aos-teams`, `aos-buffer`, `aos-discord-workflow`.
Shared contract changes: operator service keys are now first-class link credentials across the patched connectors; public integration surface remains connector manifests, permissions, command capabilities, and `action_class`. Teams is narrowed to team/channel/meeting commands only, Buffer publish commands are preview-only, and Discord webhook sends may use the webhook URL without requiring a bot token.
Workflows/AppForge/AOU reaction: consume connector manifests/capabilities only; do not infer private harness internals or assume scaffolded/preview writes are live. AOU should treat this wave as real connector substrate with noted preview-only limitations.

### 2026-04-26 — Master Threadmaster Roster

Current active core threadmasters: AppForge 2.0, Work flow building master, AOU Stub Finder, and Compare OpenClaw 4.24 features. Treat the Workflows threadmaster as the master coordinator for cross-project lane awareness while it continues implementing the workflow canvas/runtime.

### 2026-04-26 — OpenClaw 4.24 Port Planning Lane

Lane: `openclaw` / OpenClaw 4.24 realtime/browser/marketplace port plan. Branch/commit: `codex/aos-updates-and-patching-verified` at `d67473c1`. Owned files/directories for this lane now: `ops/OPENCLAW_4_24_PORT_IMPLEMENTATION_PLAN.md`, `ops/THREADMASTER_COORDINATION.md`, threadmaster bus coordination state, `src/config/types.browser.ts`, `src/browser/config.ts`, `src/browser/config.test.ts`, `src/plugins/manifest.ts`, `src/plugins/manifest-registry.ts`, `src/plugins/loader.ts`, `src/plugins/loader.test.ts`, `src/plugins/registry.ts`, `src/plugins/types.ts`, `src/plugins/manifest.test.ts`, new `extensions/voice-call/src/realtime-voice/**` tests/source, and new `extensions/google-meet/**` MVP contract scaffold. Shared contract changes in this wave: additive browser harness config fields, plugin manifest metadata for capabilities/permissions/runtime surfaces/native dependencies/setup checks/OAuth providers/install notes surfaced on plugin records, a provider-neutral realtime voice substrate skeleton with fake-provider-testable contracts, and a Google Meet plugin setup/status/tool contract that does not claim live join/create parity yet. Workflows/AppForge/AOU/AOS reaction: consume metadata/capabilities/events only; do not depend on browser, Meet, voice-call, or plugin internals; AOU should verify advertised parity is backed by tests. No AOS connector files and no external marketplace repo files are owned by this lane.

2026-04-26 next wave: `openclaw` is working from clean worktree `/tmp/argent-core-openclaw-browser-runtime`, branch `codex/openclaw-browser-runtime`, baseline `origin/dev` / `99a453b0`. Owned files for this slice: `src/browser/chrome.ts`, `src/browser/server-context.availability.ts`, `src/browser/routes/agent.act.ts`, and focused browser tests covering launch/readiness/action timeout behavior. Shared contract change: browser runtime now consumes the existing browser timeout/readiness config fields instead of leaving them manifest-only. Exclusions: no voice-call runtime promotion, no Google Meet live join/create/leave/recover, no Workflows/AppForge/AOS imports, and no `ops/threadmaster-bus/**` feature payload.

2026-04-26 next wave verification: focused browser tests passed (`config`, `chrome`, `server.agent-contract-snapshot-endpoints`, `server.agent-contract-form-layout-act-commands`, `server.serves-status-starts-browser-requested`), focused `oxlint --type-aware` passed on touched files, `git diff --check` passed, and live local Chrome endpoint smoke passed with `/start`, `/navigate`, `/act wait`, and `/act evaluate`. Full repo `tsc --noEmit` remains blocked by unrelated current-dev type errors outside the browser slice.

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
