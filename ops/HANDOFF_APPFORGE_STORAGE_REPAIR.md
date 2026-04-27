# AppForge Storage Deployment Repair

LANE LOCK:
Repo: ArgentAIOS/argentos-core
Local path: /Users/sem/code/argent-core/worktrees/appforge-storage-deployment-repair
Target branch: dev
Forbidden repo for this task: ArgentAIOS/argentos
Reason: pure core foundation repair during merge-custody freeze

## Problem

Dev-channel installs could serve AppForge durable-storage gateway methods before the
AppForge Postgres tables existed. The observed failure was:

```text
PostgresError: relation "appforge_bases" does not exist
code: 42P01
method: appforge.bases.list
```

The migration file existed, but upgraded installs still needed a reliable deployment
and runtime recovery path.

## Fix

- Added an idempotent AppForge storage schema ensure step in the Postgres AppForge
  store before every read/write method.
- Cached the schema ensure promise per store instance and reset it after failures so
  a later retry can recover.
- Added the AppForge durable tables and indexes to `scripts/ensure-pg-tables.sh`
  so the normal install/update table ensure path creates the schema for upgraded
  installs.
- Added regression coverage that proves `appforge.bases.list` ensures the schema
  before it queries `appforge_bases`.
- Extended schema alignment coverage so the migration, runtime schema SQL, and
  ensure script all include the AppForge tables and key indexes.

## Files

- `src/infra/app-forge-store.ts`
- `src/infra/app-forge-store.test.ts`
- `scripts/ensure-pg-tables.sh`
- `ops/HANDOFF_APPFORGE_STORAGE_REPAIR.md`

## Verification

Passed:

```sh
pnpm check:repo-lane
pnpm exec oxfmt --check src/infra/app-forge-store.ts src/infra/app-forge-store.test.ts
pnpm exec oxlint --type-aware src/infra/app-forge-store.ts src/infra/app-forge-store.test.ts
pnpm exec vitest run src/infra/app-forge-store.test.ts src/gateway/server-methods/app-forge.test.ts
bash -n scripts/ensure-pg-tables.sh
git diff --check
```

Focused test result:

```text
src/infra/app-forge-store.test.ts: 3 passed
src/gateway/server-methods/app-forge.test.ts: 18 passed
21 tests passed total
```

Additional diagnostic:

```sh
pnpm exec tsc --noEmit
```

This still fails repo-wide on current dev with unrelated existing type errors in
other areas (`src/agents/*`, `src/agents/pi-embedded-runner/*`, Redis typing, and
missing module declarations). The focused AppForge repair files passed type-aware
`oxlint`.

## Known Gaps

- Not yet live-smoked on an operator machine that already has the broken missing-table
  state. The fix is designed to recover that state idempotently on the next gateway
  call or update ensure run.
- This is a repair-only freeze exception. It does not include new TableForge/AppForge
  UX or feature work.

## Merge Notes

Threadmaster should merge only this storage repair branch during the freeze exception.
After merge, proof should be:

```sh
git branch -r --contains <repair-commit>
```

and `origin/dev` should contain the repair commit.
