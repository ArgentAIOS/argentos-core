# AppForge Phase 4 Airtable Gap Rollout

## Current Branch

- Branch: `codex/appforge-phase-4-airtable-gaps`
- Depends on Phase 3D browser-save branch: `codex/appforge-phase-3d-browser-save-fix`
- Phase 3D ready commit: `ad45aeb9 Make AppForge browser edits persist in core preview`

## Product Target

AppForge should move from "desktop plus early table editor" toward an Airtable-like core MVP:

- structured bases and tables
- saved named views
- richer field configuration
- editable generated interfaces
- durable AppForge event producers
- actor-aware permissions
- import/sync substrate
- natural-language base/interface editing

## What Works Today

- Desktop-style AppForge modal with left navigation.
- Base cards and active-base selection.
- Multiple tables per base.
- Grid editing for visible fields.
- Add, duplicate, delete for tables, fields, and records.
- Local filter, sort, group controls.
- Prototype kanban, form, and review modes.
- Core field model with text, long_text, single_select, multi_select, number, date, checkbox, url, email, attachment, and linked_record types.
- Gateway-backed base/table/record methods with revision checks.
- Browser-safe metadata persistence route from Phase 3D.
- Workflow capability metadata extraction and normalized AppForge event shapes.
- Permission model and audit event helpers.

## Known Gaps Versus Airtable-Like MVP

1. Saved named views are not durable table metadata yet.
2. View settings are localStorage-only and not shareable across operators.
3. The field inspector exposes only a subset of supported field types.
4. Multi-select, URL, email, attachment, and linked-record field UX is incomplete.
5. Interfaces are view-mode cards, not editable interface documents.
6. Automations/events are partially declared, but producer events are not fully durable.
7. Permissions are modeled but not consistently enforced at every write boundary.
8. Import/sync exists as product intent, not core import planning/execution.
9. Natural-language editing has no command plan/apply substrate yet.

## Active Subagent Lanes

- Saved views: add saved named view model/helpers/tests.
- Rich fields: expand model/hook support for Airtable-like field types.
- Interfaces: define interface page/layout/widget schema and metadata path.
- Event bridge: wire AppForge producer points for record/table/review/capability events.
- Permissions: harden actor/ACL enforcement and audit coverage.
- Import/NL substrate: add CSV import preview and natural-language edit intent helpers.

## Integration Rule

Keep Phase 4 separate from the Phase 3D merge packet. Product commits from Phase 4 should not include `ops/threadmaster-bus/**` coordination state.

Do not import Workflow dashboard internals. Workflows consumes AppForge only through metadata and normalized local events.

## Suggested Merge Order

1. Core schemas/helpers with tests: saved views, interfaces, imports, command plans.
2. Gateway/server producer events and permission enforcement.
3. Dashboard UI wiring for saved views and richer fields.
4. Browser smoke on `127.0.0.1:8092`.
5. Threadmaster merge packet with exact intended files, verification, and known gaps.
