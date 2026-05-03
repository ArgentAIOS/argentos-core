# AppForge/TableForge Phase 1E Field Validation Handoff

## Scope

Phase 1E hardens AppForge structured table field behavior. This is not the full
Airtable-class field engine; it makes the existing single-user table builder
more truthful and less permissive around required fields, defaults, and select
options.

## User-Facing Changes

- Required fields now have live table-edit behavior in the AppForge dashboard:
  clearing a required cell keeps the previous valid value or falls back to a
  safe default.
- Blank or duplicate select options are discarded during field normalization.
- Invalid default values are not preserved for number, date, email, URL, and
  select fields.
- The field inspector copy now says required is live for table edits instead of
  metadata-only.

## Core Contract Changes

- `AppForgeField` now includes optional `defaultValue` and rich
  `selectOptions` metadata.
- `validateAppForgeFieldDefinitions(fields)` validates field model constraints:
  missing names, duplicate field ids, missing option labels, duplicate options,
  and invalid defaults.
- Record validation now accepts rich `selectOptions` as the canonical option
  source when present, while preserving legacy `options: string[]`.
- Durable store cloning and JSON hydration preserve normalized defaults and
  rich select option metadata.

## Changelog Draft

- Hardened AppForge field validation for required/default/options behavior.
- Added field-definition validation for AppForge core field models.
- Preserved rich select options and field defaults through AppForge durable
  store round trips.
- Prevented invalid field defaults and duplicate/blank select options from
  persisting through the dashboard normalization path.
- Updated AppForge field inspector and docs to truth-label required-field
  behavior as live for table edits, not permission/enforcement-complete.

## Verification

- `vitest run src/infra/app-forge-model.test.ts src/infra/app-forge-command.test.ts src/infra/app-forge-import.test.ts src/infra/app-forge-structured-data.test.ts src/infra/app-forge-structured-hook.test.ts src/infra/app-forge-store.test.ts src/gateway/server-methods/app-forge.test.ts`
  passed: 7 files, 51 tests.
- `pnpm --dir dashboard exec eslint src/components/AppForge.tsx src/hooks/useForgeStructuredData.ts`
  passed.
- `pnpm --dir dashboard exec tsc --noEmit` passed.
- `oxlint --type-aware` passed for touched AppForge source/test files.
- `oxfmt --check` passed for touched AppForge source/test/docs files.
- `pnpm check:repo-lane` passed.
- `git diff --check` passed.

## Known Gaps

- Required-field enforcement is live only for AppForge table edits. It is not
  yet field-level permission enforcement and is not a database constraint.
- Attachment defaults and linked-record defaults remain planned until asset and
  relation storage slices land.
- This slice does not add formula, lookup, rollup, relationship, automation, or
  multi-user validation behavior.
