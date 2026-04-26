# Threadmaster Coordination

Last polled: 2026-04-26

## Lane: AppForge 2.0 Core Foundation

- Repo: `ArgentAIOS/argentos-core`
- Local path: `/tmp/argent-core-appforge-threadmaster`
- Branch: `codex/appforge-threadmaster-next`
- Target branch: `dev`
- Current commit: `77f7046f`
- Remote `origin/dev` at poll time: `77f7046f`
- Forbidden repo for this lane: `ArgentAIOS/argentos`

## Owned Files And Directories

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

## Shared Contract Changes

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

## Required Reactions

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

## Verification Snapshot

Latest AppForge focused verification after rebase onto `origin/dev`:

- `pnpm check:repo-lane`
- `pnpm exec vitest run src/infra/app-forge-adapter.test.ts src/infra/app-forge-permissions.test.ts src/gateway/server-methods/app-forge.test.ts src/infra/app-forge-model.test.ts src/infra/appforge-workflow-events.test.ts src/gateway/server-methods/workflows.appforge-events.test.ts src/infra/appforge-workflow-capabilities.test.ts src/infra/app-forge-structured-data.test.ts`
- `pnpm exec oxlint --type-aware src/infra/app-forge-adapter.ts src/infra/app-forge-adapter.test.ts src/infra/app-forge-permissions.ts src/infra/app-forge-permissions.test.ts src/gateway/server-methods/app-forge.ts src/gateway/server-methods/app-forge.test.ts`

Known unrelated failures remain documented in `ops/HANDOFF_APP_FORGE_THREADMASTER_STATUS.md`.
