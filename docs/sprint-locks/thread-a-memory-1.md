# Thread A - Memory Issue Pack #1 Lock (Backend Health Slice)

Date: 2026-03-05
Issue:

- Memory + SIS Sprint Issue Pack #1
- docs/argent/MEMORY_SIS_ISSUE_PACK.md
  Branch:
- codex/sprint-memory-health-1
  Status:
- done
  Locks:
- released
  Commit:
- 4c17c654d

## Scope

- Add backend memory health aggregation service/API contract.
- Expose typed lane health (green/yellow/red).
- Add tests for status mapping and missing-data behavior.
- Add docs note for API contract.

## Planned files (owned by Thread A)

- src/memory/health.ts
- src/memory/health.test.ts
- src/commands/health.ts
- src/commands/health.snapshot.test.ts
- docs/argent/MEMORY_SIS_ISSUE_PACK.md
- docs/sprint-locks/thread-a-memory-1.md

## Explicit non-goals / do-not-edit

- Do not edit dashboard/src/components/ConfigPanel.tsx (Thread B).
- Do not edit SIS parser files (Thread C):
  - src/infra/sis-runner.ts
  - src/infra/sis-lesson-extractor.ts
  - src/infra/sis-self-eval.ts
  - src/infra/episode-types.ts
- Do not include dashboard UI wiring in this slice.

## Files changed

- src/memory/health.ts
- src/memory/health.test.ts
- src/commands/health.ts
- src/commands/health.snapshot.test.ts
- docs/argent/MEMORY_SIS_ISSUE_PACK.md
- docs/sprint-locks/thread-a-memory-1.md

## Validation run

- `pnpm vitest run src/memory/health.test.ts src/commands/health.snapshot.test.ts`
- `pnpm vitest run src/commands/health.test.ts`
