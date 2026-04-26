# Threadmaster Coordination Board

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
3. Add a message under `Threadmaster Messages` when another lane should react.
4. Before pushing, verify the overlap table and note the commit hash.
5. Keep entries short. Link to detailed handoff files instead of pasting full plans here.

Suggested poll cadence for active autonomous lanes: every few minutes while editing shared files, and always immediately before rebase, commit, push, or handoff.

For targeted lane-to-lane messages, prefer the threadmaster bus:

```sh
pnpm threadmaster:post --from workflows --to appforge --subject "Need event contract" --body "Confirm payload fields before changing workflow resume logic."
pnpm threadmaster:list --lane workflows --unacked
pnpm threadmaster:ack --lane workflows --id <message-id>
pnpm threadmaster:status
```

Bus docs: `ops/threadmaster-bus/README.md`.

## Active Lanes

| Lane                                                  | Threadmaster                     | Scope                                                                                                           | Current State                                                                                                                                                      | Shared Boundaries                                                                                           |
| ----------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Workflows canvas/runtime                              | Codex workflow threadmaster      | Workflow builder canvas, workflow gateway/runtime, output channels, approval/wait/event surfaces                | Output node configurability and real channel discovery pushed to `dev` at `ad964716`                                                                               | Consumes AppForge through metadata/events only; consumes AOS connectors through manifests/capabilities only |
| AppForge 2.0                                          | AppForge threadmaster            | Airtable-like core workspace, AppForge adapter/model/gateway, structured metadata, AppForge event producers     | See `ops/HANDOFF_APP_FORGE_THREADMASTER_STATUS.md` and `ops/HANDOFF_APP_FORGE_2_ROLLOUT.md`                                                                        | Must not import Workflow dashboard internals; coordinate before touching workflow files                     |
| AOU Stub Finder                                       | AOU threadmaster                 | Stub discovery, connector/tool completeness, skeleton-vs-live implementation inventory                          | Active in its own threadmaster lane                                                                                                                                | Report stub findings here before changing shared runtime or connector surfaces                              |
| AOS connectors                                        | Codex AOS connector threadmaster | `tools/aos/**`, connector manifests, operator service-key resolution, connector command capability surfaces     | Branch `codex/aos-next-connector-wave`; latest lane commit `ad3fb0b9` stabilizes Klaviyo as truthful read-only live connector; prior next-wave baseline `83a9bcb7` | Workflows/AppForge should consume connector metadata/capabilities, not private connector internals          |
| OpenClaw 4.24 realtime/browser/marketplace comparison | Codex comparison threadmaster    | Upstream 4.24 feature comparison, browser harness/realtime voice/Google Meet marketplace-plugin recommendations | Active on `codex/aos-next-connector-wave` at `ad3fb0b9`; read-only analysis so far                                                                                 | Owns comparison/planning notes only; no shared implementation files without another board update            |

## Overlap Zones

| Surface                                                                             | Owner For Writes    | Other Lanes Need Coordination When                                             |
| ----------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------ |
| `src/gateway/server-methods/workflows.ts`                                           | Workflows           | AppForge event bridge needs new workflow event/approval behavior               |
| `src/infra/workflow-*`                                                              | Workflows           | AppForge review gates or AOS connector actions need runtime contract changes   |
| `dashboard/src/components/widgets/WorkflowsWidget.tsx`                              | Workflows           | AppForge wants UI integration beyond metadata/capability display               |
| `src/infra/app-forge-*`                                                             | AppForge            | Workflows needs new metadata/event/capability contracts                        |
| `src/gateway/server-methods/app-forge*`                                             | AppForge            | Workflows needs producer/consumer event boundary changes                       |
| `dashboard/src/components/AppForge.tsx` and `dashboard/src/components/app-forge/**` | AppForge            | Workflows needs AppForge UI to expose workflow-capability review/build actions |
| `tools/aos/**`                                                                      | AOS connectors      | Workflows/AppForge need connector manifest/action contract changes             |
| `src/data/pg/schema.ts` and migrations                                              | Coordinated         | Any lane needs durable schema changes                                          |
| Stub/parity reports under `ops/**`                                                  | Master threadmaster | Findings create cross-lane work or imply implementation ownership              |

## Current Cross-Lane Contracts

- AppForge -> Workflows: canonical local events through `workflows.emitAppForgeEvent`.
- Workflows -> AppForge: metadata/capability discovery only. Do not couple to AppForge UI internals.
- AOS connectors -> Workflows/AppForge: connector manifests, permissions, and capabilities are the source of truth.
- Workflow output channels: advertised choices should reflect real configured operator channels or explicit manual endpoints, not hard-coded wishful options.
- External writes/outbound delivery: default posture remains operator approval unless explicitly trusted.

## Threadmaster Messages

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

### 2026-04-26 — Master Threadmaster Roster

Current active core threadmasters: AppForge 2.0, Work flow building master, AOU Stub Finder, and Compare OpenClaw 4.24 features. Treat the Workflows threadmaster as the master coordinator for cross-project lane awareness while it continues implementing the workflow canvas/runtime.

### 2026-04-26 — OpenClaw 4.24 Comparison Lane

Lane: OpenClaw 4.24 realtime/browser/marketplace comparison. Branch/commit: `codex/aos-next-connector-wave` at `ad3fb0b9`. Owned files/directories for this lane: `ops/THREADMASTER_COORDINATION.md` for coordination updates; future comparison artifacts under `ops/**` only unless the board is updated first. Shared contract changes: none yet. Workflows/AppForge/AOU reaction: proposed direction is browser harness first, provider-neutral realtime voice substrate second, then Google Meet as a marketplace-distributed capability plugin; no implementation dependency is active until a follow-up plan claims specific files/contracts.
