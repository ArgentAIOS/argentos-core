# Thread C - Memory Issue Pack #3 Lock (SIS JSON Reliability)

Date: 2026-03-05
Issue:

- Memory + SIS Sprint Issue Pack #3
- docs/argent/MEMORY_SIS_ISSUE_PACK.md
  Branch:
- codex/sprint-memory-sis-reliability-3
  Commit:
- 157a4d6dc
  Status:
- done
  Locks:
- released

## Scope

- Harden SIS consolidation parsing with a strict structured contract and fallback parser.
- Emit typed error reasons and metrics on parse failure.
- Eliminate silent consolidation drops.

## Planned files (owned by Thread C)

- src/infra/sis-runner.ts
- src/infra/sis-lesson-extractor.ts
- src/infra/sis-self-eval.ts
- src/infra/episode-types.ts
- src/infra/sis-runner.test.ts
- src/infra/sis-lesson-extractor.test.ts
- docs/sprint-locks/thread-c-memory-3.md

## Explicit non-goals / do-not-edit

- Do not edit ConfigPanel or MemU selector config files (owned by Thread B for #2).
- Do not edit dashboard chat rendering/attachments files.
- Do not broaden to lane-isolation work (#7) in this task.

## Acceptance targets

- Regression parse success target >=95% for SIS consolidation fixtures/tests.
- Parse failures emit typed reason codes and increment metrics counters.
- No silent drops; every failed consolidation path is logged + counted.

## Thread prompt (copy/paste)

Implement Memory Issue Pack #3 (SIS JSON Reliability Hardening) only.

Scope:

1. Define strict SIS structured output contract and validator.
2. Add fallback parser for near-valid outputs (e.g., fenced JSON, trailing text).
3. Add typed parse error reasons and metrics increments for each failure class.
4. Ensure every failed consolidation emits structured log/telemetry event (no silent drop).
5. Add regression tests/fixtures proving >=95% parse success target under noisy outputs.

Constraints:

- Only edit files listed in this lock.
- Do not touch MemU config UI/validators (owned by Thread B).
- Keep behavior changes limited to SIS consolidation reliability.

Validation:

- `pnpm vitest run src/infra/sis-runner.test.ts src/infra/sis-lesson-extractor.test.ts`
- Include pass-rate summary from fixtures in completion note.

Deliver:

- File list changed
- Parse-success metrics from test run
- Residual risks and follow-up recommendations
