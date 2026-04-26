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

| Lane                                                  | Threadmaster                     | Scope                                                                                                                     | Current State                                                                                                                                                      | Shared Boundaries                                                                                           |
| ----------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Master coordination + Workflows canvas/runtime        | Codex workflow threadmaster      | Cross-lane coordination, workflow builder canvas, workflow gateway/runtime, output channels, approval/wait/event surfaces | Bus/coordination lane in progress at `1f30784b`; output node configurability and real channel discovery pushed to `dev` at `ad964716`                              | Consumes AppForge through metadata/events only; consumes AOS connectors through manifests/capabilities only |
| AppForge 2.0                                          | AppForge threadmaster            | Airtable-like core workspace, AppForge adapter/model/gateway, structured metadata, AppForge event producers               | Structured local event contract pushed to `dev` at `3dc5e7f6`; completion posted as `tm-20260426160541-6341o1`                                                     | Must not import Workflow dashboard internals; coordinate before touching workflow files                     |
| AOU Stub Finder                                       | AOU threadmaster                 | Stub discovery, connector/tool completeness, skeleton-vs-live implementation inventory                                    | Active in its own threadmaster lane                                                                                                                                | Report stub findings here before changing shared runtime or connector surfaces                              |
| AOS connectors                                        | Codex AOS connector threadmaster | `tools/aos/**`, connector manifests, operator service-key resolution, connector command capability surfaces               | Branch `codex/aos-next-connector-wave`; latest lane commit `ad3fb0b9` stabilizes Klaviyo as truthful read-only live connector; prior next-wave baseline `83a9bcb7` | Workflows/AppForge should consume connector metadata/capabilities, not private connector internals          |
| OpenClaw 4.24 realtime/browser/marketplace comparison | Codex comparison threadmaster    | Upstream 4.24 feature comparison, browser harness/realtime voice/Google Meet marketplace-plugin recommendations           | Active on `codex/aos-next-connector-wave` at `ad3fb0b9`; read-only analysis so far                                                                                 | Owns comparison/planning notes only; no shared implementation files without another board update            |

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

### 2026-04-26 — Master to All

The threadmaster bus is available. Use `pnpm threadmaster:post/list/ack/status/poll` for targeted messages, `pnpm threadmaster:task-add/task-list/task-update` for lane tasking, and keep durable contract summaries in this board.

### 2026-04-26 — Workflows to AppForge

The workflow output node now discovers configured output channels and has real source/payload/destination fields. Please do not add AppForge UI imports into workflow canvas code. If AppForge needs workflow-facing actions, expose them as metadata capabilities or `forge.*` events.

### 2026-04-26 — Workflows to AOS Connectors

The workflow canvas should consume connector manifests/capabilities rather than connector implementation files. If connector command metadata changes shape, add a short note here before pushing so workflow action-node mapping can stay aligned.

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

### 2026-04-26 — Master Threadmaster Roster

Current active core threadmasters: AppForge 2.0, Work flow building master, AOU Stub Finder, and Compare OpenClaw 4.24 features. Treat the Workflows threadmaster as the master coordinator for cross-project lane awareness while it continues implementing the workflow canvas/runtime.

### 2026-04-26 — OpenClaw 4.24 Comparison Lane

Lane: OpenClaw 4.24 realtime/browser/marketplace comparison. Branch/commit: `codex/aos-next-connector-wave` at `ad3fb0b9`. Owned files/directories for this lane: `ops/THREADMASTER_COORDINATION.md` for coordination updates; future comparison artifacts under `ops/**` only unless the board is updated first. Shared contract changes: none yet. Workflows/AppForge/AOU reaction: proposed direction is browser harness first, provider-neutral realtime voice substrate second, then Google Meet as a marketplace-distributed capability plugin; no implementation dependency is active until a follow-up plan claims specific files/contracts.

### 2026-04-26 — OpenClaw Realtime Voice Fake Provider Wave

Lane: `openclaw`. Branch: `codex/openclaw-realtime-fake-provider` from `origin/dev` / `85abcdc4`. Owned files for this slice: `extensions/voice-call/src/realtime-voice/**` and this coordination note only. Shared contract change: add deterministic fake-provider lifecycle coverage for realtime voice bridge/session behavior before any live OpenAI adapter work. Boundaries: no edits to existing voice-call telephony providers, `extensions/voice-call/src/media-stream.ts`, Google Meet runtime, browser runtime, Workflows, AppForge, AOS, schema, or gateway registry files. Required reaction: other lanes should not consume this as live OpenAI/Google/terminal voice support; fake provider is local deterministic lifecycle proof only.

### 2026-04-26 — OpenClaw Local Operator Fake Session Wave

Lane: `openclaw`. Branch: `codex/openclaw-realtime-fake-provider` rebased onto `origin/dev` / `bdbf18fa`; prior fake-provider determinism commit replayed as `e6d7c3d5`. Owned files for this slice: `extensions/voice-call/src/realtime-voice/**` and this coordination note only. Shared contract change: add an operator-facing realtime voice session contract that can run against the deterministic fake provider, recording transcript/audio/tool/close events and preserving handoff points for future OpenAI/Google adapters; `RealtimeVoiceCloseReason` now includes `cancelled` for operator-initiated cancellation. Boundaries: no Workflows, AppForge, AOS, schema, gateway, browser, Google Meet, existing telephony provider behavior, live microphone/audio, or live provider support claims. Required reaction: other lanes should treat this as a local deterministic operator harness only until a separate live adapter task is assigned and verified.

### 2026-04-26 — OpenClaw Fake-Backed Operator CLI Harness Wave

Lane: `openclaw`. Branch: `codex/openclaw-realtime-fake-provider` rebased onto `origin/dev` / `4ad2a5a8`; prior operator fake-session commit replayed as `a3a325e5`. Owned files for this slice: `extensions/voice-call/src/realtime-voice/**` and this coordination note only. Shared contract change: add a deterministic terminal/operator command harness over `createRealtimeVoiceOperatorSession` that can feed text/audio-token input, trigger greetings, acknowledge marks, cancel/close sessions, collect transcript/tool/result/close events, and emit stable logs for later CLI wiring. Boundaries: no Workflows, AppForge, AOS, schema, gateway, browser, Google Meet, existing telephony provider behavior, live microphone/audio, live OpenAI/Google provider calls, or credentials. Required reaction: other lanes should treat this as a fake/local harness only.

### 2026-04-26 — OpenClaw OpenAI Realtime Provider Wave

Lane: `openclaw`. Branch: `codex/openclaw-realtime-fake-provider` at `c6f8554c` before this slice. Owned files for this slice: `extensions/voice-call/src/realtime-voice/**` and this coordination note only unless master explicitly widens scope. Shared contract change: add a clearly labeled live OpenAI Realtime provider adapter beside the fake test-only provider; fake remains test-only and should not be registered as an operator-facing CLI surface. Boundaries: no Workflows, AppForge, AOS, schema, browser, Google Meet live runtime, existing telephony provider behavior, credentials, or live microphone/audio claims. Required reaction: live smoke remains blocked until `OPENAI_API_KEY` is visible to the running process; current local checks did not find it in `~/.argentos/.env`, repo `.env`, or `process.env`.

### 2026-04-26 — OpenClaw Live OpenAI Realtime Smoke Wave

Lane: `openclaw`. Branch: `codex/openclaw-realtime-fake-provider` at `05b22380` before this slice. Owned files for this slice: `extensions/voice-call/src/realtime-voice/**` and this coordination note only. Shared contract change: add a reusable live OpenAI Realtime smoke helper that uses the live-labeled OpenAI provider to send one local text prompt and require both a final assistant transcript and audio output chunks without exposing secrets. Boundaries: fake provider remains test-only; no Workflows, AppForge, AOS, schema, browser, Google Meet runtime, existing telephony provider behavior, or microphone/playback claims. Required reaction: other lanes may treat this as live OpenAI text-to-audio session evidence only when the helper output reports `ok: true`, final transcript, and `audioChunkCount > 0`; live microphone/speaker and synthetic input-audio fixtures remain separate follow-up work.

### 2026-04-26 — OpenClaw Synthetic Audio I/O Adapter Wave

Lane: `openclaw`. Branch: `codex/openclaw-realtime-fake-provider` at `80fdc6d4` before this slice. Owned files for this slice: `extensions/voice-call/src/realtime-voice/**` and this coordination note only. Shared contract change: add local realtime operator audio I/O abstractions for synthetic 24k PCM input and capture-only 24k PCM output, plus an operator audio session wrapper that routes synthetic frames into the existing operator session and captures provider audio chunks. Boundaries: no real microphone device code, no speaker playback device code, no Workflows, AppForge, AOS, schema, browser, Google Meet runtime, or existing telephony provider defaults. Required reaction: downstream lanes may use this as a testable audio I/O contract only; live mic/speaker device adapters still require a separate assignment and explicit privacy/permission gates.

### 2026-04-26 — OpenClaw Local Audio Process Wrapper Wave

Lane: `openclaw`. Branch: `codex/openclaw-audio-process` rebased/reconstructed from `origin/dev` / `3e9a1357`, with prior realtime voice commits replayed through `e8d3cc7b` before this slice. Owned files for this slice: `extensions/voice-call/src/realtime-voice/local-audio-process.ts`, `extensions/voice-call/src/realtime-voice/local-audio-process.test.ts`, `extensions/voice-call/src/realtime-voice/index.ts`, and this coordination note only. Shared contract change: add explicit-gate local device probe and macOS ffmpeg/ffplay process wrapper foundation for future microphone capture/speaker playback. Boundaries: default disabled, no live mic loop claim, no raw audio persistence unless `ARGENT_REALTIME_AUDIO_CAPTURE_PATH` is explicit, no Workflows, AppForge, AOS, schema, browser, Google Meet runtime, telephony default, or marketplace contract changes.

### 2026-04-26 — OpenClaw Gated Local Audio Operator Session Wave

Lane: `openclaw`. Branch: `codex/openclaw-audio-process` rebased onto `origin/dev` / `6805cc0c`, with process-wrapper commit replayed as `6b79a660` before this slice. Owned files for this slice: `extensions/voice-call/src/realtime-voice/local-audio-process-session.ts`, `extensions/voice-call/src/realtime-voice/local-audio-process-session.test.ts`, `extensions/voice-call/src/realtime-voice/index.ts`, and this coordination note only. Shared contract change: add a gated local audio operator session factory that connects the existing realtime operator session to process input/output adapters or dry-run synthetic/capture adapters while requiring `ARGENT_REALTIME_AUDIO_PROCESS_ENABLE=1` and `ARGENT_REALTIME_AUDIO_CONFIRM_LIVE=1`. Boundaries: default disabled, tests do not touch live devices, no operator CLI wiring, no live mic/speaker support claim, and no Workflows/AppForge/AOS/schema/browser/Google Meet runtime or telephony default changes.

### 2026-04-26 — OpenClaw Local Audio Live-Smoke Harness Wave

Lane: `openclaw`. Branch: `codex/openclaw-audio-process` at `c7ec43ae` before this slice. Owned files for this slice: `extensions/voice-call/src/realtime-voice/local-audio-live-smoke.ts`, `extensions/voice-call/src/realtime-voice/local-audio-live-smoke.test.ts`, `extensions/voice-call/src/realtime-voice/index.ts`, and this coordination note only. Shared contract change: add a CLI-runnable local audio smoke harness that uses the gated local audio operator session in dry-run synthetic/capture mode by default, with optional `ARGENT_REALTIME_AUDIO_SMOKE_MODE=process` for explicit real-device attempts. Boundaries: `ARGENT_REALTIME_AUDIO_PROCESS_ENABLE=1` and `ARGENT_REALTIME_AUDIO_CONFIRM_LIVE=1` remain mandatory, no secrets are printed, no raw audio persistence unless `ARGENT_REALTIME_AUDIO_CAPTURE_PATH` is explicitly set, and this still does not claim always-on live operator voice support.

### 2026-04-26 — OpenClaw Gated Operator Voice CLI UX Wave

Lane: `openclaw`. Branch: `codex/openclaw-audio-process` at `3be41f18` before this slice. Owned files for this slice: `extensions/voice-call/src/realtime-voice/operator-voice-cli.ts`, `extensions/voice-call/src/realtime-voice/operator-voice-cli.test.ts`, `extensions/voice-call/src/realtime-voice/index.ts`, and this coordination note only. Shared contract change: add an extension-local operator voice CLI/dev command wrapper that preflights the proven local audio smoke harness and reports separate blockers for missing live gates, OpenAI key, ffmpeg, ffplay, and likely mic/speaker permission failures. Boundaries: no core CLI registry changes, no Workflows/AppForge/AOS/schema/browser/Google Meet runtime or telephony default changes, no secrets printed, no raw audio persistence unless `ARGENT_REALTIME_AUDIO_CAPTURE_PATH` is explicit, and dry-run/process/live evidence remains truth-labeled.

### 2026-04-26 — OpenClaw Voice Alert Integration Plan

Lane: `openclaw`. Branch: `codex/openclaw-audio-process` rebased onto `origin/dev` / `ca7efa17`; voice CLI UX baseline replayed through `7df91416` before this read-only plan. Owned files for this slice: `ops/OPENCLAW_VOICE_ALERT_INTEGRATION_PLAN.md` and this coordination note only. Shared contract proposal: introduce a future `OperatorAlertEvent` contract consumed by Telegram, macOS `system.notify`, workflow/exec approval notifications, and optional realtime voice output. Boundaries: no product code edits, no Workflows/AppForge/AOS/schema/browser/Google Meet runtime or telephony default changes, no always-on listening claim, and voice alerts remain optional notification output only. Required reaction: Threadmaster should assign shared contract ownership before any lane implements product code.

## Verification Snapshot

Latest AppForge focused verification after rebase onto `origin/dev`:

- `pnpm check:repo-lane`
- `pnpm exec vitest run src/infra/app-forge-adapter.test.ts src/infra/app-forge-permissions.test.ts src/gateway/server-methods/app-forge.test.ts src/infra/app-forge-model.test.ts src/infra/appforge-workflow-events.test.ts src/gateway/server-methods/workflows.appforge-events.test.ts src/infra/appforge-workflow-capabilities.test.ts src/infra/app-forge-structured-data.test.ts`
- `pnpm exec oxlint --type-aware src/infra/app-forge-adapter.ts src/infra/app-forge-adapter.test.ts src/infra/app-forge-permissions.ts src/infra/app-forge-permissions.test.ts src/gateway/server-methods/app-forge.ts src/gateway/server-methods/app-forge.test.ts`

Known unrelated failures remain documented in `ops/HANDOFF_APP_FORGE_THREADMASTER_STATUS.md`.
