# OpenClaw Memory Hardening Port Plan

## Purpose

Port high-signal memory reliability improvements from OpenClaw into ArgentOS without disrupting the MemU pipeline.

This branch focuses on hardening the legacy memory backends (`MemoryIndexManager` and `QmdMemoryManager`) that still affect retrieval quality, availability, and prompt injection reliability.

## Baseline

- Source repo compared: `/Users/sem/code/openclaw-official/openclaw` (origin/main)
- Target repo: `/Users/sem/code/argentos`
- Candidate upstream commits:
  - `544c213d4` Memory/QMD: diversify mixed-source search results
  - `a305dfe62` Memory/QMD: harden multi-collection search and embed scheduling
  - `be756b9a8` Memory: fix async sync close race
  - `5542a4362` Memory: share ENOENT helpers

## Port Map

### 1) QMD search robustness and result quality

Upstream source:

- `/Users/sem/code/openclaw-official/openclaw/src/memory/qmd-manager.ts`
- `/Users/sem/code/openclaw-official/openclaw/src/memory/qmd-query-parser.ts`

ArgentOS targets:

- `/Users/sem/code/argentos/src/memory/qmd-manager.ts`
- new: `/Users/sem/code/argentos/src/memory/qmd-query-parser.ts`

Changes:

1. Add resilient QMD JSON parser:

- Handle noisy stdout/stderr and "no results" markers safely.
- Parse first valid JSON array if logs are interleaved.

2. Harden multi-collection search:

- Use managed collection scoping consistently.
- Support fallback from `search`/`vsearch` to `query` when option support differs by QMD build.
- Resolve doc location using collection/file hints, not hash-only first-hit behavior.

3. Diversify mixed-source recall:

- Interleave `memory` and `sessions` result streams when both exist.
- Maintain score-aware source ordering.

4. Embed/update scheduling hardening:

- Add update retry policy for timeout/sqlite-busy style failures.
- Add embed lock and backoff window to avoid repeated embed storms.
- Keep forced update queue semantics for high-priority sync requests.

### 2) Built-in memory manager shutdown/read safety

Upstream source:

- `/Users/sem/code/openclaw-official/openclaw/src/memory/manager.ts`
- `/Users/sem/code/openclaw-official/openclaw/src/memory/fs-utils.ts`
- `/Users/sem/code/openclaw-official/openclaw/src/memory/internal.ts`
- `/Users/sem/code/openclaw-official/openclaw/src/memory/sync-memory-files.ts`

ArgentOS targets:

- `/Users/sem/code/argentos/src/memory/manager.ts`
- new: `/Users/sem/code/argentos/src/memory/fs-utils.ts`
- `/Users/sem/code/argentos/src/memory/internal.ts`
- `/Users/sem/code/argentos/src/memory/sync-memory-files.ts`

Changes:

1. Close/sync race fix:

- If `close()` is called during sync, await pending sync before DB close.
- Ignore sync requests when manager is already closed.

2. ENOENT-safe file read behavior:

- `readFile()` returns empty text for missing files instead of throwing.
- Shared helper `isFileMissingError()` and `statRegularFile()` used across memory paths.

3. Sync pipeline missing-file tolerance:

- Filter missing files out of batch entry creation instead of failing sync pass.

### 3) Optional stream: hybrid quality knobs

Upstream reference:

- `/Users/sem/code/openclaw-official/openclaw/src/agents/memory-search.ts`
- `/Users/sem/code/openclaw-official/openclaw/src/memory/hybrid.ts`

ArgentOS targets:

- `/Users/sem/code/argentos/src/agents/memory-search.ts`
- `/Users/sem/code/argentos/src/memory/hybrid.ts`

Changes (optional phase):

- Add config-driven MMR and temporal decay knobs to legacy manager path.
- Keep defaults disabled to avoid behavior shock.

## Expected Improvements

### Operator-facing

1. Fewer memory retrieval incidents:

- Fewer "invalid JSON"/empty parse failures from QMD query output drift.
- Better resilience during startup churn and background indexing.

2. Better session continuity:

- Mixed-source (sessions + memory) recall produces less one-source domination.

3. Lower operational noise:

- Missing/deleted markdown files stop causing noisy read/sync failures.

### Agent-facing

1. Better retrieval composition:

- More balanced evidence set improves response grounding and reduces repetitive references.

2. Better uptime of retrieval backend:

- Less chance of retrieval stall from embed/update contention.

3. Safer lifecycle handling:

- Manager close no longer races in-flight sync and causes intermittent follow-on errors.

## Performance and Cost Impact

### Latency

- QMD search path: slight overhead from parser robustness and multi-collection fallback checks.
- Expected net: neutral to slightly improved p95 due to fewer failed/retried query attempts.

### Token cost

- Better retrieval precision/diversity should reduce unnecessary long-context retries and reduce over-injection churn.
- Expected net: modest reduction in downstream response-token waste in retrieval-heavy sessions.

### CPU/IO

- Embed backoff + lock reduces pathological repeated embeds; lowers burst CPU/IO during unstable periods.
- Missing-file tolerance reduces wasted sync work from repeated ENOENT exceptions.

## Suggested Rollout Sequence

### Phase A (safe reliability)

- Port ENOENT helpers + manager close/sync race fix.
- Add tests for missing files and close-during-sync.

### Phase B (QMD hardening)

- Add qmd-query-parser module.
- Port multi-collection search fallback, doc resolution hints, embed backoff/lock.
- Port source diversification.

### Phase C (optional quality tuning)

- Add MMR/temporal-decay config knobs in legacy path.
- Keep default off; enable behind config toggle for controlled validation.

## Test Plan

1. Unit tests

- `src/memory/qmd-manager.test.ts`
- `src/memory/manager.async-search.test.ts`
- `src/memory/manager.sync-errors-do-not-crash.test.ts`
- Add new tests for:
  - noisy qmd stdout/stderr parse
  - mixed-source diversification ordering
  - close() while sync in progress
  - missing-file read and sync behavior

2. Integration checks

- Start gateway with QMD backend and multiple collections.
- Run repeated retrieval requests under concurrent sync load.
- Verify no persistent embed loop/backoff thrash.

3. Regression checks

- Existing MemU retrieval flows remain unchanged.
- Prompt injection character budget clamp still respected.

## Branching and Execution

- Working branch: `codex/memory-hardening-port-plan`
- Next implementation branch after approval:
  - `codex/memory-hardening-port-impl`
