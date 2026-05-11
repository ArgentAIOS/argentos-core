# AppForge/TableForge Phase 1D Field Configuration Handoff

## Scope

Phase 1D adds live TableForge field configuration panels for structured AppForge bases. This is a focused foundation slice, not an Airtable-complete field system.

## User-Facing Changes

- Field inspector is labeled as a live structured-base surface.
- Field labels, descriptions, required metadata, and supported default values are editable.
- Select fields now manage stable option objects with ids, labels, and color metadata while preserving legacy `options: string[]` labels.
- Field type changes no longer apply silently from the dropdown; the operator sees a conversion warning and must explicitly apply.
- Attachment and linked-record defaults are marked planned because the relation/asset storage slice is not in this phase.
- Text field configuration changes commit on blur/Enter instead of saving every keystroke.

## Changelog Draft

- Added live TableForge field configuration for AppForge structured tables.
- Added persistent field default values for supported field types.
- Added stable select option metadata with ids, labels, and colors while maintaining legacy option-label compatibility.
- Added explicit field type conversion warning/confirmation before existing record values are coerced.
- Clarified unsupported default-value cases for attachment and linked-record fields.
- Fixed a real gateway smoke failure where metadata-only base seed writes claimed `expectedRevision: 0` and conflicted with an existing durable mirror at revision `1`.
- Changed browser metadata fallback to use the same-origin metadata route first, with direct dashboard API XHR only as a fallback.
- Made workflow event emission best-effort after persistence so a workflow-event failure cannot turn a successful structured-base save into a red timeout.

## Files Changed

- `dashboard/src/components/AppForge.tsx`
- `dashboard/src/hooks/useForgeStructuredData.ts`
- `src/infra/app-forge-structured-data.test.ts`
- `src/infra/app-forge-structured-hook.test.ts`
- `docs/tools/tableforge-field-settings.md`
- `ops/HANDOFF_APP_FORGE_PHASE_1D_FIELD_CONFIG.md`

## Timeout Investigation

Operator smoke reported `Gateway load failed` and `Timed out while saving structured base changes`.
The current root causes found and fixed in this slice:

- The field inspector previously saved label edits on every keystroke, which made field edits feel like a flood of gateway/metadata writes. Label, description, select-option label, and default edits now commit on blur/Enter.
- The dashboard metadata fallback previously depended on a direct dashboard API XHR first. It now uses the same-origin metadata route first and keeps direct XHR as fallback.
- Workflow event emit failures happened after persistence but could still surface as save failures. Event emission is now best-effort and logged after persistence.
- Live browser smoke found the durable gateway store rejecting metadata-only base seed writes with `Expected revision 0, found 1`. Metadata-only bases no longer send `expectedRevision`; gateway-loaded bases still preserve revision preconditions.

Important nuance: `/api/apps` metadata can still show older legacy field metadata when the gateway store is the live structured source of truth. The gateway read contract is `appforge.bases.list` / `appforge.tables.list`.

## Verification

Completed during implementation:

- `pnpm check:repo-lane` passed.
- `pnpm exec vitest run src/infra/app-forge-structured-hook.test.ts src/infra/app-forge-structured-data.test.ts src/infra/app-forge-store.test.ts src/gateway/server-methods/app-forge.test.ts` passed: 4 files, 35 tests.
- `pnpm --dir dashboard exec eslint src/components/AppForge.tsx src/hooks/useForgeStructuredData.ts` passed.
- `pnpm --dir dashboard exec tsc --noEmit` passed.
- `pnpm exec oxlint --type-aware dashboard/src/components/AppForge.tsx dashboard/src/hooks/useForgeStructuredData.ts src/infra/app-forge-structured-data.test.ts src/infra/app-forge-structured-hook.test.ts` passed.
- `pnpm exec oxfmt --check dashboard/src/components/AppForge.tsx dashboard/src/hooks/useForgeStructuredData.ts src/infra/app-forge-structured-data.test.ts src/infra/app-forge-structured-hook.test.ts ops/HANDOFF_APP_FORGE_PHASE_1D_FIELD_CONFIG.md docs/tools/tableforge-field-settings.md` passed.
- `git diff --check` passed.
- `pnpm docs:list` passed and lists `tools/tableforge-field-settings.md`.
- Browser/Computer Use smoke on `http://127.0.0.1:8098/` showed:
  - field label `S` changed to `Smoke Status 1358`;
  - grid column header updated;
  - save state reached `Saved`;
  - no red timeout or stale-revision banner appeared;
  - reload/reopen still showed `Smoke Status 1358`;
  - gateway `appforge.bases.list` returned revision `2` with field `Smoke Status 1358`;
  - changing type from single select to number displayed the conversion warning and Apply/Cancel controls.

## Known Gaps

- Required fields are metadata-only until validation rules land.
- Attachment and linked-record defaults require the future asset/relation storage slice.
- Field type conversion is still coercive once confirmed; this phase adds warning/confirmation, not a reversible conversion preview.
- Legacy app metadata and gateway-backed structured data can temporarily diverge for apps already promoted to the durable store. AppForge should continue moving toward the gateway store as the single structured-data source of truth.
