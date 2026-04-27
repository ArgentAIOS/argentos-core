# AppForge / TableForge Phase 1C Saved Views Handoff

LANE LOCK:
Repo: ArgentAIOS/argentos-core
Local path: /Users/sem/code/argent-core
Target branch: dev
Forbidden repo for this task: ArgentAIOS/argentos
Reason: pure core foundation work

## Summary

Phase 1C adds the first durable TableForge-style saved views for structured AppForge tables. This is still early against the 2026 Airtable-class TableForge spec, roughly 10-15% overall, but it moves the live table surface beyond one transient browser-only grid.

## Changed

- Added per-table saved view metadata:
  - `id`
  - `name`
  - `type`
  - `filterText`
  - `sortFieldId`
  - `sortDirection`
  - `groupFieldId`
  - `visibleFieldIds`
  - `createdAt`
  - `updatedAt`
- Added `activeViewId` to structured tables.
- Normalized legacy tables with no views into a default `Grid` saved view.
- Persisted saved view settings through the existing AppForge structured metadata path.
- Added UI affordances to create, select, rename, duplicate, and delete saved views.
- Moved filter/sort/group settings out of browser-local storage and into saved view metadata.
- Hardened rapid saved-view edits so fast create/filter edits use the freshest in-flight table state.

## Changelog Draft

### AppForge / TableForge

- Added durable saved views for structured tables, including saved filter, sort, group, and view type metadata.
- Added saved-view controls in the AppForge desktop for creating, selecting, renaming, duplicating, and deleting views.
- Replaced browser-only filter/sort/group storage with persisted TableForge metadata so views survive reloads.
- Preserved legacy AppForge tables by automatically creating a default Grid saved view when older metadata has no views.

## Verification

- `pnpm check:repo-lane`
- `pnpm exec oxfmt --check dashboard/src/components/AppForge.tsx dashboard/src/hooks/useForgeStructuredData.ts src/infra/app-forge-structured-data.test.ts`
- `pnpm exec vitest run src/infra/app-forge-structured-data.test.ts src/gateway/server-methods/app-forge.test.ts`
- `pnpm --dir dashboard exec eslint src/components/AppForge.tsx src/hooks/useForgeStructuredData.ts`
- `pnpm --dir dashboard exec tsc --noEmit`
- `pnpm exec oxlint --type-aware dashboard/src/components/AppForge.tsx dashboard/src/hooks/useForgeStructuredData.ts src/infra/app-forge-structured-data.test.ts`
- `git diff --check`
- Browser smoke on `http://127.0.0.1:8092/`:
  - opened AppForge
  - selected an existing structured base
  - created a saved view
  - set a persisted filter
  - confirmed the saved view exists through `/api/apps`
  - opened a fresh browser session and confirmed the saved view renders again
  - screenshot: `/tmp/appforge-phase1c-saved-views-verified.png`

## Known Gaps

- This is not yet Airtable-class saved-view breadth. Calendar, gallery, timeline, saved column visibility UI, advanced filter builders, formulas, linked records, rollups, permissions enforcement, forms, and interface designer remain unbuilt.
- Headless browser still reports the existing dashboard WebGL/Live2D errors and Gateway `NOT_PAIRED` noise. The saved-view smoke uses metadata fallback persistence because no paired operator Gateway token is available in headless.

## Recommended Phase 1D

Build true field configuration panels next: field labels, descriptions, required flags, select options, default values, and field-type conversion warnings. This is the next TableForge foundation slice before advanced views or formulas.
