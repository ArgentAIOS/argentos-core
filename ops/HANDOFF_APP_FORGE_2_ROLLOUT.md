# AppForge 2.0 Eight-Phase Rollout Plan

## Lane Lock

Repo: `ArgentAIOS/argentos-core`
Local path: `/Users/sem/code/argent-core-appforge-dev`
Target branch: `dev`
Forbidden repo for this task: `ArgentAIOS/argentos`

AppForge 2.0 is core foundation work. Business, licensing, marketplace, and commercial packaging behavior stays out of this lane until the business install path is explicitly coordinated.

## Product Target

AppForge should become an Airtable-like operator workspace inside Argent Core:

- Structured bases, tables, fields, records, saved views, and generated interfaces.
- Editable grid, kanban, form, detail, review, and dashboard surfaces.
- Workflow capability declarations and runtime events through metadata/events only.
- Live write-capable connectors with human approval and audit controls.
- Owner/editor/viewer permissions, then controlled multi-user collaboration.
- Natural-language app editing with preview, approval, rollback, and tests.

Current foundation:

- `dashboard/src/components/AppForge.tsx` provides the desktop shell and early Grid/Kanban/Form/Review views.
- `dashboard/src/hooks/useForgeStructuredData.ts` stores structured data in `metadata.appForge.structured` and emits canonical AppForge events.
- `src/infra/appforge-workflow-capabilities.ts` discovers workflow capabilities from supported metadata paths.
- `src/infra/appforge-workflow-events.ts` normalizes AppForge runtime events.
- `workflows.emitAppForgeEvent` is the current consumer boundary for Workflows.

## Phase 1: Stabilize The AppForge Workspace MVP

Goal: turn the current shell into a dependable single-user workspace that operators can browser-test daily.

Deliverables:

- Keep the full-screen desktop modal and left navigation as the stable AppForge entry point.
- Finish table CRUD in the current metadata-backed hook: create, rename, duplicate, archive/delete tables.
- Finish field CRUD: create, rename, reorder, type change, required flag, select options, description.
- Finish record CRUD: create, edit, delete, duplicate, optimistic error handling, empty states.
- Persist active base/table/view/field selection.
- Keep emitted events for record created, updated, deleted, review requested, review completed, and capability completed.

Acceptance criteria:

- User can create a base-like app, add a table, add fields, edit records, switch views, close/reopen, and keep state.
- AppForge emits canonical events with `appId`, `tableId`, `recordId`, optional `capabilityId`, and structured payload.
- AppForge UI remains usable at desktop and tablet widths.
- No new dependency on Workflow dashboard internals.

Primary files:

- `dashboard/src/components/AppForge.tsx`
- `dashboard/src/hooks/useForgeStructuredData.ts`
- `dashboard/src/hooks/useApps.ts`

Verification:

- Unit tests for structured normalization and mutations.
- Browser smoke: open AppForge, create field, create record, approve review.
- `pnpm check:repo-lane`
- Targeted AppForge formatting/typecheck.

## Phase 2: First-Class Core Data Domain

Goal: move from metadata-backed structured data to a canonical AppForge data layer that can scale beyond toy bases.

Deliverables:

- Add core AppForge data model for bases, grants, tables, fields, views, records, cells, and revisions.
- Prefer a hybrid model: normalized bases/tables/fields/views plus record values/cells that can still support JSONB config.
- Add optimistic revision checks and idempotency keys for mutating writes.
- Add adapter/server-method contracts for base/table/field/view/record operations.
- Keep metadata declarations stable for workflow capability discovery during migration.

Acceptance criteria:

- AppForge can list/create/update/delete bases, tables, fields, views, and records through core server boundaries.
- Record writes validate against field definitions.
- Concurrent updates return a conflict instead of silently overwriting.
- Existing metadata-backed apps can be migrated or read through a compatibility path.

Likely files requiring Threadmaster coordination:

- `src/infra/app-forge-*.ts`
- `src/gateway/server-methods/app-forge*.ts`
- `src/data/pg/schema.ts`
- `src/data/pg-adapter.ts`
- `src/data/adapter.ts`
- migrations under `src/data/pg/**`

Verification:

- Migration tests for schema creation and backfill.
- Adapter tests for CRUD, validation, conflict handling, archive/delete.
- Event bridge tests for record create/update/delete payloads.

## Phase 3: Airtable-Quality Grid And Saved Views

Goal: make the table editor feel like a real daily-use spreadsheet/database surface.

Deliverables:

- Dense grid with stable column widths, sticky headers, row numbers, row selection, and keyboard navigation.
- Field-specific editors for text, long text, number, date, checkbox, single select, multi select, URL, email, attachment placeholder, linked record placeholder.
- Saved views for grid, kanban, form, review, and gallery/list placeholder.
- Per-view filter, sort, group, hidden fields, field order, row height, search, and selected record state.
- View-backed query contract so UI state does not become the source of truth.

Acceptance criteria:

- User can create multiple saved views per table and return to them later.
- Filter/sort/group affects visible records predictably.
- Grid editing validates by field type and shows conflicts/errors clearly.
- Large table smoke case remains responsive enough for MVP testing.

Primary files:

- `dashboard/src/components/AppForge.tsx`
- `dashboard/src/components/app-forge/**`
- `dashboard/src/hooks/useForgeStructured*.ts`
- AppForge server-method/data files from Phase 2.

Verification:

- Unit tests for view query semantics.
- Component/browser tests for grid editing, saved view switching, filter/sort/group.
- Manual keyboard-only smoke.

## Phase 4: Generated Editable Interfaces

Goal: graduate from tables to operator-facing micro-apps generated from schema and editable by humans.

Deliverables:

- Interface metadata model: pages, sections, components, bindings, actions, visibility rules.
- Generated surfaces: record detail, create/edit form, review queue, kanban board, dashboard summary.
- Interface builder panel for layout editing, component selection, field binding, action binding.
- Preserve manual interface edits across later schema changes unless a conflict is explicitly approved.
- Capability declaration editor so operators can confirm workflow-facing capabilities.

Acceptance criteria:

- Every base can generate at least one grid, one form, one record detail page, and one review interface.
- User can hide/reorder fields in an interface without changing the underlying table.
- User can bind an interface action to a local AppForge event or workflow capability declaration.
- Capability metadata remains readable from all supported paths: `metadata.workflowCapabilities`, `metadata.workflow.capabilities`, `metadata.appForge.workflowCapabilities`.

Primary files:

- `dashboard/src/components/AppForge.tsx`
- `dashboard/src/components/app-forge/**`
- `dashboard/src/hooks/useForgeStructured*.ts`
- `src/infra/app-forge-*.ts`
- `src/gateway/server-methods/app-forge*.ts`

Verification:

- Interface metadata round-trip tests.
- Browser tests for generated form/detail/review screens.
- Capability metadata extraction regression tests.

## Phase 5: Workflow Event Bridge Completion

Goal: make AppForge a reliable producer of structured local events and a clean partner for Workflows.

Deliverables:

- Keep canonical event types:
  - `forge.record.created`
  - `forge.record.updated`
  - `forge.record.deleted`
  - `forge.review.requested`
  - `forge.review.completed`
  - `forge.capability.completed`
- Add dedupe/idempotency for event emission where possible.
- Ensure AppForge producers call the existing `workflows.emitAppForgeEvent` boundary.
- Support targeted events with `workflowRunId` and `nodeId`.
- Coordinate with Threadmaster for native approval gate resume, because that touches workflow files outside the normal AppForge write scope.

Acceptance criteria:

- Untargeted AppForge events can start matching `appforge_event` workflows.
- Targeted AppForge events can resume `wait_event` workflow waits.
- Review requested/completed event payloads carry `reviewId`, `decision`, record values, and actor metadata once permissions land.
- No AppForge code imports Workflow dashboard internals.

Likely coordinated files:

- `src/infra/appforge-workflow-events.ts`
- `src/gateway/server-methods/workflows.ts`
- `src/infra/workflow-execution-service.ts`
- `src/infra/workflow-approvals.ts`
- `src/infra/workflow-builder.ts`
- `src/infra/workflow-types.ts`

Verification:

- Existing AppForge event normalization tests.
- Gateway tests for workflow start/resume from AppForge events.
- Cross-layer smoke: AppForge review completion resumes a workflow wait or approval gate.

## Phase 6: Permissions, Audit, And Controlled Collaboration

Goal: make multi-user behavior safe enough for real operators before adding live collaboration.

Deliverables:

- App-level roles for MVP: owner, editor, viewer.
- Actor envelope on mutating calls: `userId`, `deviceId`, `workspaceId`, `role`, `sessionId`, `authStrength`.
- Central policy checks for AppForge mutations and workflow/capability side effects.
- Audit log for prompt, interpreted intent, patch, actor, approval, result, rollback target.
- Lightweight comments, review requests, presence, and edit leases.
- Defer row-level ACL and CRDT/OT until there is a specific need.

Acceptance criteria:

- Viewer cannot mutate.
- Editor can draft changes and request review but cannot publish connector writes without approval.
- Owner can manage members, destructive actions, and approvals.
- Every mutation has audit data and a rollback reference.
- Conflict path is visible and recoverable.

Primary files:

- `src/infra/app-forge-*.ts`
- `src/gateway/server-methods/app-forge*.ts`
- `dashboard/src/components/AppForge.tsx`
- `dashboard/src/hooks/useForgeStructured*.ts`

Potential coordinated files:

- auth/session and workflow approval files if policy moves through those seams.

Verification:

- Role matrix tests.
- Unauthorized mutation tests.
- Audit-log completeness tests.
- Conflict/revision tests.

## Phase 7: Imports, Templates, Connectors, And Sync

Goal: make AppForge useful from day one with real data and live connections.

Deliverables:

- CSV import with schema inference and preview.
- Template creation for CRM, project tracker, content calendar, bug tracker, approvals/review queue, lightweight inventory.
- Import mapping UI for columns, field types, select options, duplicate strategy.
- Connector declaration model for read sync and write proposals.
- Connector write path remains human-approved for external writes, outbound delivery, and mutations.
- Export base/table as CSV and JSON.

Acceptance criteria:

- User can start from blank, template, or CSV import.
- Imported field types are inferred and editable before applying.
- Connector declarations can be attached to bases/tables without leaking business-layer assumptions.
- External writes produce preview, approval, audit, and event output.

Primary files:

- `dashboard/src/components/app-forge/**`
- `dashboard/src/hooks/useForgeStructured*.ts`
- `src/infra/app-forge-*.ts`
- `src/gateway/server-methods/app-forge*.ts`

Do not touch without coordination:

- `src/connectors/**`

Verification:

- CSV parser/import tests.
- Template instantiation tests.
- Connector declaration tests.
- Manual import/export browser smoke.

## Phase 8: Natural-Language App Editing And MVP Hardening

Goal: make AppForge feel like Argent, not just an Airtable clone: the operator can edit the app in natural language with safe previews.

Deliverables:

- NL edit planner that turns prompts into structured patches for schema, records, views, interfaces, capabilities, and connector proposals.
- Patch preview UI with human-readable diff and raw JSON details.
- Approval-gated apply path for mutating changes.
- Undo/rollback for the last applied schema/interface mutation.
- Prompt-injection and connector-write safeguards.
- Release gates that include AppForge UI, backend, event bridge, and workflow integration.

Acceptance criteria:

- User can say “add a status field,” “make this a campaign review table,” “create a kanban by owner,” and “turn this into an approval interface.”
- NL edits preview before applying and never blindly mutate live connector targets.
- Invalid edits fail with specific repair guidance.
- Three complete demo scenarios pass: CRM, project tracker, approval queue.
- MVP is usable through `argent update` on the dev channel and browser-testable locally.

Primary files:

- `src/agents/tools/app-forge-tool*.ts`
- `src/infra/app-forge-*.ts`
- `src/gateway/server-methods/app-forge*.ts`
- `dashboard/src/components/AppForge.tsx`
- `dashboard/src/components/app-forge/**`
- `dashboard/src/hooks/useForgeStructured*.ts`

Verification:

- Patch planner unit tests.
- Prompt-to-preview-to-apply integration tests.
- Rollback tests.
- Browser tests for the three demo scenarios.
- `pnpm check:repo-lane`
- Targeted AppForge tests/lint/typecheck.

## Parallel Execution Model

Lead/orchestrator:

- Owns lane lock, phase sequencing, merge coordination, and final verification.
- Keeps AppForge code inside the allowed write scope unless Threadmaster explicitly approves a coordinated exception.

Recommended subagent lanes:

- Backend/data architect: Phases 2, 3, 6 data model, adapter contracts, migrations.
- UI executor/designer: Phases 1, 3, 4 AppForge desktop, grid, views, interface builder.
- Workflow bridge architect: Phase 5 event semantics, approval bridge coordination, tests.
- Security reviewer: Phase 6 permissions, actor envelope, policy checks, audit, connector guardrails.
- Product/NL planner: Phases 4, 7, 8 templates, generated interfaces, natural-language editing.
- Test engineer/verifier: all phases, owns gate matrix and browser regression path.

Suggested phase grouping:

- Sprint A: Phase 1 plus tests. Keep in current AppForge UI/hook scope.
- Sprint B: Phase 2 data-domain design and coordinated schema/server-method exception.
- Sprint C: Phase 3 saved views and grid quality.
- Sprint D: Phase 4 interfaces plus Phase 5 event bridge.
- Sprint E: Phase 6 permissions/audit.
- Sprint F: Phase 7 imports/templates/connectors.
- Sprint G: Phase 8 NL editing and hardening.

## Release Gates

Every phase:

- Verify `pwd`, `git remote get-url origin`, and branch.
- Run `pnpm check:repo-lane`.
- Keep `git diff --name-only` inside approved AppForge lane unless Threadmaster approved an exception.
- Run targeted tests for touched AppForge surfaces.
- Browser-test the operator flow.

Before MVP label:

- AppForge UI smoke passes in browser.
- AppForge event bridge starts/resumes workflows.
- Role matrix tests pass.
- Import/template smoke passes.
- NL preview/apply/rollback path passes.
- Full known failing dashboard typecheck gaps are either fixed or explicitly tracked outside the AppForge lane.

## Threadmaster Coordination Points

Needs Threadmaster before implementation:

- Phase 2 schema/data adapter files outside the current narrow AppForge lane.
- Phase 5 workflow approval-gate resume changes.
- Any `src/connectors/**` changes in Phase 7.
- Any release/update/version/package files.

Copy/paste handoff:

```text
THREADMASTER HANDOFF: AppForge 2.0 eight-phase rollout is documented at ops/HANDOFF_APP_FORGE_2_ROLLOUT.md in argentos-core dev.

Current safe next lane: Phase 1, AppForge workspace MVP, inside:
- dashboard/src/components/AppForge.tsx
- dashboard/src/components/app-forge/**
- dashboard/src/hooks/useForgeStructured*.ts

Upcoming coordination needed:
- Phase 2 needs core data-domain/server-method/schema write-scope approval.
- Phase 5 needs workflow event/approval bridge coordination.
- Phase 7 needs connector write-scope coordination before touching src/connectors/**.

Boundary remains metadata/events only between AppForge and Workflows. AppForge should not import Workflow dashboard internals.
```
