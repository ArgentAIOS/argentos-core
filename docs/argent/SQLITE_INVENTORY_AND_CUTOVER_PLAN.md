# SQLite Inventory And PG Cutover Plan (Frozen Snapshot)

Date: 2026-02-26

Snapshot root:

- `/Users/sem/Backups/argentos-freeze-20260225-184421`

Backup artifacts created:

- Full copy: `~/.argentos` -> `/Users/sem/Backups/argentos-freeze-20260225-184421/home/.argentos`
- Full copy: `~/argent` -> `/Users/sem/Backups/argentos-freeze-20260225-184421/home/argent`
- Full copy: repo -> `/Users/sem/Backups/argentos-freeze-20260225-184421/workspace/argentos`
- PG dump (server v17): `/Users/sem/Backups/argentos-freeze-20260225-184421/postgres/argentos.sql`
- Raw SQLite inventory TSV: `/Users/sem/Backups/argentos-freeze-20260225-184421/inventory/sqlite-inventory.tsv`

## Runtime mode at freeze time

From `~/.argentos/argent.json`:

- `storage.backend = "dual"`
- `storage.readFrom = "postgres"`
- `storage.writeTo = ["sqlite", "postgres"]`

Operational implication:

- Reads are intended to come from PG where adapter paths are wired.
- SQLite remains in the write path and in several direct dashboard stores.

## SQLite files discovered

### Core/active (used by running services and/or core code paths)

1. `/Users/sem/.argentos/memory.db` (~167 MB)

- MemU canonical SQLite store (resources, memory_items, categories, entities, lessons, vectors, FTS).
- Used by `getMemuStore()` default path.
- PG mirror is enabled from gateway startup, but this file is still active.

2. `/Users/sem/.argentos/observations.db` (~60 KB)

- Memo/observations capture + FTS.
- Used by memo capture and cross-search surfaces.

3. `/Users/sem/.argentos/data/dashboard.db` (~1.4 MB)

- Dashboard tasks/apps/widgets/teams (+ FTS tables).
- Used by dashboard DB modules and API server.

4. `/Users/sem/.argentos/data/memo.db` (~4 KB)

- Data API attached DB (memo sidecar).

5. `/Users/sem/.argentos/data/sessions.db` (~4 KB)

- Data API attached DB (sessions sidecar).

6. `/Users/sem/argent/memory/canvas.db` (~6.1 MB)

- Canvas documents + embeddings + FTS.
- Current `/api/knowledge/ingest` writes here (separate from MemU/PG memory path).

7. `/Users/sem/.argentos/memory/main.sqlite` (~68 KB)

- File-memory index DB (`chunks`, `embedding_cache`, FTS).

8. `/Users/sem/.argentos/memory/argent.sqlite` (~68 KB)

- File-memory index DB for agent scope (`chunks`, `embedding_cache`, FTS).

### Stale/legacy or non-core

1. `/Users/sem/.argentos/dashboard.db` (0 B)

- Legacy root DB path, appears unused.

2. `/Users/sem/.argentos/memory/memu.db` (0 B)

- Empty/legacy artifact, appears unused.

3. `/Users/sem/.argentos/workspace-main/data/atera_papertrade.db` (~12 KB)

- App-specific DB, not core memory substrate.

4. `/Users/sem/.argentos/backups/memory-20260225-063202.db` (~165 MB)

- Backup artifact, not active runtime DB.

## Why this feels fragmented

- The codebase is in migration state: PG adapter + dual-write are present, but there are still direct SQLite-backed stores in dashboard and memory tooling.
- `knowledge/ingest` is currently routed to `canvas.db` instead of the core memory/storage adapter path.
- This creates multiple "knowledge-like" surfaces (MemU vs Canvas docs) with separate indexing and backup semantics.

## Cutover order (recommended)

### Phase 0: Freeze and checkpoints (done)

- Services stopped.
- Full filesystem snapshots taken.
- PG dump taken with matching version binary.

### Phase 1: Single knowledge ingress

- Move `/api/knowledge/ingest` from `canvas.db` to core memory ingest path (MemU/storage adapter).
- Preserve citation metadata in memory item `extra`.
- Keep Canvas as presentation layer only (DocPanel viewer), not as source-of-truth knowledge store.

### Phase 2: Read-path unification

- Ensure `memory_recall`, `argent_search`, and `sessions_search` resolve against the same storage adapter semantics.
- Remove or clearly isolate direct SQLite reads that bypass adapter routing for core memory queries.

### Phase 3: Dashboard DB split decision

- Keep `dashboard.db` for UI product entities (apps/widgets/tasks) or migrate tasks/teams fully to PG adapter.
- If kept, mark as non-memory operational store in backup and docs.

### Phase 4: Deprecation cleanup

- Remove/ignore stale files (`dashboard.db` root, `memory/memu.db`) once verified unused.
- Add startup guard/log warning if legacy DBs are detected with writes.

### Phase 5: Exit dual-write

- After validation window, flip config to `backend = "postgres"` and remove SQLite from write path.
- Keep one rollback snapshot and one migration replay script.

## Validation gates before each phase promotion

1. No data loss:

- Item counts, category counts, entity counts, lessons counts match within expected drift.

2. Retrieval quality parity:

- Golden queries return same/better relevance and citation fidelity.

3. Operational stability:

- No startup ABI errors.
- No hanging requests in config/dashboard panes.

4. Recovery:

- Restore drill from frozen backup + PG dump succeeds.
