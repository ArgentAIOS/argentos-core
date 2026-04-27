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

| Lane                                                  | Threadmaster                     | Scope                                                                                                                     | Current State                                                                                                                                                   | Shared Boundaries                                                                                           |
| ----------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Master coordination + Workflows canvas/runtime        | Codex workflow threadmaster      | Cross-lane coordination, workflow builder canvas, workflow gateway/runtime, output channels, approval/wait/event surfaces | Bus/coordination lane in progress at `1f30784b`; output node configurability and real channel discovery pushed to `dev` at `ad964716`                           | Consumes AppForge through metadata/events only; consumes AOS connectors through manifests/capabilities only |
| AppForge 2.0                                          | AppForge threadmaster            | Airtable-like core workspace, AppForge adapter/model/gateway, structured metadata, AppForge event producers               | Ralph Phase 3D active on `codex/appforge-phase-3d-browser-save-fix`; browser smoke found AppForge metadata save needs a narrow browser-safe API overlap         | Must not import Workflow dashboard internals; coordinate before touching workflow files                     |
| AOU Stub Finder                                       | AOU threadmaster                 | Stub discovery, connector/tool completeness, skeleton-vs-live implementation inventory                                    | Active in its own threadmaster lane                                                                                                                             | Report stub findings here before changing shared runtime or connector surfaces                              |
| AOS connectors                                        | Codex AOS connector threadmaster | `tools/aos/**`, connector manifests, operator service-key resolution, connector command capability surfaces               | Branch `codex/aos-holace-loop` from `origin/dev` `4ad2a5a8`; current slice owns `tools/aos/aos-holace/**` to convert the stub into a truthful AOS CLI connector | Workflows/AppForge should consume connector metadata/capabilities, not private connector internals          |
| OpenClaw 4.24 realtime/browser/marketplace comparison | Codex OpenClaw threadmaster      | Upstream 4.24 feature comparison, browser harness/realtime voice/Google Meet marketplace-plugin recommendations           | Active on `codex/openclaw-audio-process` at `43e297df`; release changelog packet and live Meet open-tab smoke runbook pushed                                    | Owns OpenClaw extension slices plus ops handoffs; no join/create/leave/audio Meet claims without approval   |

## Overlap Zones

| Surface                                                                             | Owner For Writes    | Other Lanes Need Coordination When                                             |
| ----------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------ |
| `src/gateway/server-methods/workflows.ts`                                           | Workflows           | AppForge event bridge needs new workflow event/approval behavior               |
| `src/infra/workflow-*`                                                              | Workflows           | AppForge review gates or AOS connector actions need runtime contract changes   |
| `dashboard/src/components/widgets/WorkflowsWidget.tsx`                              | Workflows           | AppForge wants UI integration beyond metadata/capability display               |
| `src/infra/app-forge-*`                                                             | AppForge            | Workflows needs new metadata/event/capability contracts                        |
| `src/gateway/server-methods/app-forge*`                                             | AppForge            | Workflows needs producer/consumer event boundary changes                       |
| `dashboard/src/components/AppForge.tsx` and `dashboard/src/components/app-forge/**` | AppForge            | Workflows needs AppForge UI to expose workflow-capability review/build actions |
| `dashboard/src/App.tsx`                                                             | Coordinated         | AppForge needs parent-level gateway/request plumbing                           |
| `tools/aos/**`                                                                      | AOS connectors      | Workflows/AppForge need connector manifest/action contract changes             |
| `src/data/pg/schema.ts` and migrations                                              | Coordinated         | Any lane needs durable schema changes                                          |
| Stub/parity reports under `ops/**`                                                  | Master threadmaster | Findings create cross-lane work or imply implementation ownership              |
| package, version, update, and release files                                         | Coordinated         | Any lane needs installer/update/runtime behavior changes                       |

## Current Cross-Lane Contracts

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

### 2026-04-27 — OpenClaw Release Changelog And Live Meet Open-Tab Runbook

Lane: `openclaw`
Branch: `codex/openclaw-audio-process`
Commit: `43e297df`
Owned files: `ops/OPENCLAW_RELEASE_CHANGELOG_PACKET.md`, `ops/OPENCLAW_LIVE_MEET_OPEN_TAB_SMOKE_RUNBOOK.md`, and this board note.
Runtime/code changes: none in this commit.
Summary: Added a release-facing changelog packet covering realtime voice foundations, OpenAI Realtime adapter support, local operator audio smoke tooling, optional voice alerts, shared alert router, browser diagnostics, Google Meet setup/status/recover, Google Meet recover smoke runner, and plugin/marketplace metadata. Added a live open-tab Google Meet smoke runbook for a dedicated Chrome profile signed into `argent@argentos.ai`.
Required reactions: Master/release should preserve the changelog packet for dev release notes. After the OpenClaw Google Meet recover packet is merged into `dev`, operator/OpenClaw should run the live open-tab runbook and post truth-labeled evidence. No lane should advertise Google Meet join/create/leave, in-meeting control, audio participation, phone-call voice, or polished always-available desktop voice UX as complete until separate live evidence lands.

### 2026-04-26/27 — OpenClaw Current-Dev Voice/Meet Packet

Lane: `openclaw`
Branch: `codex/openclaw-audio-process`
Current `origin/dev`: `38289381`
Current local head after reconstructing from dev: `38289381`
Owned files for this handoff: `ops/HANDOFF_OPENCLAW_VOICE_MEET_CURRENT_DEV_PACKET.md` and this board note only.
Runtime/code diff over current `origin/dev`: none.
Summary: OpenClaw realtime voice, local audio, operator voice CLI, optional OperatorAlertEvent voice route, and Google Meet browser status/recover slices are already contained in `origin/dev`. The new packet records exact commits, files, verification, truth labels, split boundaries, and blockers.
Required reactions: Browser/gateway owner must resolve browser-control WebSocket `1006` before OpenClaw can provide Google Meet manual recovery smoke evidence. Workflows/master must assign shared operator-alert subscription wiring before the voice route can fire automatically from live approval/alert events.

### 2026-04-26/27 — OpenClaw Shared Routing/Browser Blocker Proposal

Lane: `openclaw`
Branch: `codex/openclaw-audio-process`
Owned files for this proposal: `ops/OPENCLAW_SHARED_ROUTING_AND_BROWSER_BLOCKER_PROPOSAL.md` and this board note only.
Runtime/code changes: none.
Summary: Proposal identifies two next slices. A1 is a shared `OperatorAlertEvent` in-process router contract plus voice-call registration helper, without Workflow/AppForge/AOS/schema edits. B2 is browser CLI/gateway diagnostic labeling for the WebSocket `1006` blocker, but it requires master approval before touching shared gateway files.
Required reactions: Master/Workflows must choose A1 contract-only vs A2 workflow hook for automatic voice alert routing. Master/browser owner must approve B2 shared browser diagnostics or keep the Meet manual smoke blocked on browser-control health.

### 2026-04-26/27 — OpenClaw A1 Shared Operator Alert Router

Lane: `openclaw`
Branch: `codex/openclaw-audio-process`
Owned files: `src/infra/operator-alert-router.ts`, `src/infra/operator-alert-router.test.ts`, `extensions/voice-call/src/realtime-voice/operator-alert-router-registration.ts`, `extensions/voice-call/src/realtime-voice/operator-alert-router-registration.test.ts`, `extensions/voice-call/src/realtime-voice/index.ts`, and this board note.
Shared contract change: adds a small in-process `OperatorAlertEvent` sink router with `registerOperatorAlertSink`, `routeOperatorAlertEvent`, `listOperatorAlertSinkIds`, and best-effort sent/skipped/failed summaries. Adds an OpenClaw voice-call sink registration helper that adapts the existing gated `runOperatorAlertVoiceRoute` without importing Workflows UI/runtime internals.
Required reactions: Workflows/master can later wire `operator.alert.requested` broadcasts into `routeOperatorAlertEvent` if A2 is approved. Until then, the voice route is registered/callable by contract but not automatically fired by workflow approvals.

### 2026-04-26/27 — OpenClaw B2 Browser Diagnostics

Lane: `openclaw`
Branch: `codex/openclaw-audio-process`
Owned files: `src/gateway/server-methods/browser.ts`, `src/gateway/server-methods/browser.test.ts`, `src/cli/browser-cli-shared.ts`, `src/cli/browser-cli-shared.test.ts`, and this board note.
Shared contract change: enriches `browser.request` failures with diagnostic details for method/path/profile/route/timeout/node and adds CLI request context to gateway close failures such as WebSocket `1006`. No browser restart, profile reset, recovery behavior, or Google Meet live action changes are included.
Required reactions: Browser/gateway owner can use the details block and `argent browser status --json --timeout <ms>` guidance to diagnose the Meet manual smoke blocker.

### 2026-04-26 — Master to All

The threadmaster bus is available. Use `pnpm threadmaster:post/list/ack/status/poll` for targeted messages, `pnpm threadmaster:task-add/task-list/task-update` for lane tasking, and keep durable contract summaries in this board.

### 2026-04-26 — Workflows to AppForge

The workflow output node now discovers configured output channels and has real source/payload/destination fields. Please do not add AppForge UI imports into workflow canvas code. If AppForge needs workflow-facing actions, expose them as metadata capabilities or `forge.*` events.

### 2026-04-26 — Workflows to AOS Connectors

The workflow canvas should consume connector manifests/capabilities rather than connector implementation files. If connector command metadata changes shape, add a short note here before pushing so workflow action-node mapping can stay aligned.

### 2026-04-26 — AOS Square Connector Slice

Lane: `AOS connector Ralph loop`
Branch/status: `codex/aos-square-loop`, started from `origin/dev` at `36d49ca5`.
Owned files/directories: `tools/aos/aos-square/**`; coordination note in `ops/THREADMASTER_COORDINATION.md`.
Shared contract change in progress: Square connector capability metadata is being narrowed to live REST read commands only. Operator-controlled service keys remain the auth and linking source; local environment variables are development fallback only.
Workflows/AppForge/AOU reaction: consume the Square manifest/capabilities only. Do not assume Square payment/customer/order/item/invoice write mutations exist unless a later handoff advertises them as live-ready with verified approval policy.

### 2026-04-26 — Workflows General

Before touching shared files, update this board. The goal is to make lane drift visible in the repo before it becomes visible in the product.

### 2026-04-26 — Workflows Import/Template Harness

Workflows added the first owner-operator import/export harness: `src/infra/workflow-package.ts`, `src/infra/workflow-owner-operator-templates.ts`, `src/infra/workflow-package.test.ts`, and `docs/workflows/owner-operator-scenarios.md`.
The new contract imports/exports canonical JSON/YAML workflow packages with executable workflow definition, separate canvas layout, credential/dependency declarations, and n8n-style pinned test fixtures.
The initial library has 20 marketing/sales/HR/finance/support/operations templates for solo operators and SMBs.
Templates import in `simulate` stage by default; live promotion must still validate real credentials, configured channels/connectors, and approval posture.

### 2026-04-26 — AOS Connectors to Workflows/AppForge/AOU

Lane: `AOS next connector wave`
Branch/commit: `codex/aos-next-connector-wave` at `ad3fb0b9`; prior connector-wave baseline `83a9bcb7`.
Owned files/directories: `tools/aos/**`, with active connector ownership over Airtable, Mailchimp, Calendly, ConnectWise, Close, PagerDuty, WooCommerce, Square, Canva, Klaviyo, and the next requested connector slices unless another lane claims them here.
Shared contract changes: connector manifests, permissions, and command capability declarations remain the public contract; operator-controlled service keys are the key source for linked external systems. Klaviyo is now a truthful live read connector and does not advertise mutation/write actions until those are implemented.
Workflows/AppForge/AOU reaction: consume manifests/capabilities only; do not infer private connector internals or assume scaffolded writes exist. AOU Stub Finder should treat Klaviyo at `ad3fb0b9` as a real read-only baseline and track future mutation work separately.

### 2026-04-26 — AOS Holace Connector Slice Started

Lane: `AOS Holace connector`
Branch/commit: `codex/aos-holace-loop` from `origin/dev` `4ad2a5a8`.
Owned files/directories: `tools/aos/aos-holace/**`; this slice may also update this coordination note.
Shared contract changes: Holace changes from manifest-only stub to read-only AOS CLI connector. Public manifest/permissions now advertise read-only commands only, `write_bridge_available: false`, operator service keys `HOLACE_API_KEY` and `HOLACE_API_BASE_URL`, optional scope keys, and doctor/health metadata that distinguishes sampled API probe readiness from per-resource tenant smoke.
Workflows/AppForge/AOU reaction: no runtime/UI changes required; continue consuming connector manifests, permissions, command capabilities, `action_class`, and readiness metadata only. Treat Holace writes as unavailable until a verified write bridge and smoke evidence are added.

### 2026-04-27 — AOS Slack Workflow Connector

Lane: `AOS Slack Workflow connector`
Branch/commit: `codex/aos-slack-workflow-loop` in progress.
Owned files/directories: `tools/aos/aos-slack-workflow/**` plus this coordination note.
Shared contract changes: Slack Workflow remains a live Slack Web API read/write connector, but credentials and worker defaults now resolve from operator-controlled service keys first. Required service key is `SLACK_BOT_TOKEN`; optional scope/default keys include `SLACK_APP_TOKEN`, `SLACK_BASE_URL`, `SLACK_CHANNEL_ID`, `SLACK_THREAD_TS`, `SLACK_TEXT`, `SLACK_EMOJI`, `SLACK_USER_ID`, `SLACK_CHANNEL_NAME`, `SLACK_CANVAS_*`, `SLACK_FILE_*`, and `SLACK_REMINDER_*`. Scoped repo service keys block local env fallback and encrypted repo keys use the core-compatible `enc:v1` AES-GCM format.
Workflows/AppForge/AOU reaction: consume manifest/capabilities only. Treat Slack write commands as consequential writes requiring write mode, operator service-key binding, and approval; `live_write_smoke_tested` remains `false` until a real operator Slack workspace smoke test runs.

### 2026-04-27 — AOS Teams Connector

Lane: `AOS Teams connector`
Branch/commit: `codex/aos-teams-loop` in progress.
Owned files/directories: `tools/aos/aos-teams/**` plus this coordination note.
Shared contract changes: Teams remains a live Microsoft Graph read/write connector for team/channel/meeting surfaces, but credentials and worker defaults now resolve from operator-controlled service keys first. Required service keys are `TEAMS_TENANT_ID`, `TEAMS_CLIENT_ID`, and `TEAMS_CLIENT_SECRET`; optional scope/default keys include `TEAMS_TEAM_ID`, `TEAMS_USER_ID`, `TEAMS_CHANNEL_ID`, `TEAMS_CHAT_ID`, `TEAMS_GRAPH_BASE_URL`, `TEAMS_TOKEN_URL`, `TEAMS_HTTP_TIMEOUT_SECONDS`, `TEAMS_MEETING_SUBJECT`, `TEAMS_START_TIME`, and `TEAMS_END_TIME`. Scoped repo service keys block local env fallback and encrypted repo keys use the core-compatible `enc:v1` AES-GCM format.
Workflows/AppForge/AOU reaction: consume manifest/capabilities only. Treat `channel.create` and `meeting.create` as consequential writes requiring write mode, operator service-key binding, Graph permissions/application access policy, and approval; `live_write_smoke_tested` remains `false` until a real operator Microsoft Teams tenant smoke test runs.

### 2026-04-27 — AOS Discord Workflow Connector

Lane: `AOS Discord Workflow connector`
Branch/commit: `codex/aos-discord-workflow-loop` in progress.
Owned files/directories: `tools/aos/aos-discord-workflow/**` plus this coordination note.
Shared contract changes: Discord Workflow remains a live Discord bot/webhook connector, but credentials and worker defaults now resolve from operator-controlled service keys first. Required service key is `DISCORD_BOT_TOKEN` for bot-backed commands; `DISCORD_WEBHOOK_URL` is optional and can power `webhook.send` without bot auth. Optional scope/default keys include `DISCORD_API_BASE_URL`, `DISCORD_GUILD_ID`, `DISCORD_CHANNEL_ID`, `DISCORD_MESSAGE_ID`, `DISCORD_ROLE_ID`, `DISCORD_MEMBER_ID`, `DISCORD_CONTENT`, `DISCORD_EMBED_JSON`, `DISCORD_THREAD_NAME`, `DISCORD_CHANNEL_NAME`, and `DISCORD_REACTION`. Scoped repo service keys block local env fallback and encrypted repo keys use the core-compatible `enc:v1` AES-GCM format.
Workflows/AppForge/AOU reaction: consume manifest/capabilities only. Treat Discord write commands as consequential writes requiring write mode, operator service-key binding, bot/webhook permissions, and approval; `live_write_smoke_tested` remains `false` until a real operator Discord guild/webhook smoke test runs.

### 2026-04-26 — Master Threadmaster Roster

Current active core threadmasters: AppForge 2.0, Work flow building master, AOU Stub Finder, and Compare OpenClaw 4.24 features. Treat the Workflows threadmaster as the master coordinator for cross-project lane awareness while it continues implementing the workflow canvas/runtime.

### 2026-04-26 — AOS Dropbox Connector Slice

Lane: `AOS Dropbox connector`
Branch/status: `codex/aos-dropbox-loop` in progress.
Owned files/directories: `tools/aos/aos-dropbox/**` plus this coordination note.
Shared contract change: Dropbox public AOS surface is being narrowed to truthful live read-only commands only: `file.list`, `file.get`, `file.download`, `folder.list`, `share.list`, `search.query`, and connector utility commands. Upload/delete/move/folder-create/shared-link-create are not advertised until a write bridge and approval policy are verified.
Operator key contract: `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`, `DROPBOX_REFRESH_TOKEN`, `DROPBOX_PATH`, `DROPBOX_FILE_ID`, `DROPBOX_QUERY`, `DROPBOX_CURSOR`, `DROPBOX_LIMIT`, `DROPBOX_BASE_URL`, and `DROPBOX_CONTENT_URL` resolve from operator service keys before local environment fallback.
Workflows/AppForge/AOU reaction: consume Dropbox manifest/capabilities only; treat Dropbox as live read-only and do not present it as an output/write destination.

### 2026-04-26 — OpenClaw 4.24 Comparison Lane

Lane: OpenClaw 4.24 realtime/browser/marketplace comparison. Branch/commit: `codex/aos-next-connector-wave` at `ad3fb0b9`. Owned files/directories for this lane: `ops/THREADMASTER_COORDINATION.md` for coordination updates; future comparison artifacts under `ops/**` only unless the board is updated first. Shared contract changes: none yet. Workflows/AppForge/AOU reaction: proposed direction is browser harness first, provider-neutral realtime voice substrate second, then Google Meet as a marketplace-distributed capability plugin; no implementation dependency is active until a follow-up plan claims specific files/contracts.

### 2026-04-26 — AppForge Browser Save Overlap

Lane: AppForge 2.0. Branch: `codex/appforge-phase-3d-browser-save-fix` from `origin/dev`. Current AppForge-owned files: `dashboard/src/hooks/useForgeStructuredData.ts`, `src/infra/app-forge-structured-hook.test.ts`, and `src/infra/app-forge-structured-data.test.ts`. Narrow overlap: browser preview table edits timed out through the Vite `/api/apps/:id` write path from the in-app browser, even though shell calls to the same preview endpoint succeeded. AppForge is using an AppForge-specific metadata save API route plus direct loopback API call for preview/runtime reliability. Workflows reaction: none; this remains AppForge metadata persistence only and does not change the `workflows.emitAppForgeEvent` contract.

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
