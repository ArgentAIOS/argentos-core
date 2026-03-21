# SIS Migration Path

> How the Self-Improving System moves from corrupting SQLite to thriving on PostgreSQL.

## Background

SIS is the system that motivated the entire PG+Redis migration. It's Argent's
ability to learn from experience — extracting patterns from contemplation episodes,
building a library of lessons, and (eventually) injecting those lessons back into
agent prompts to improve future behavior.

The problem: the SIS maintenance cycle was corrupting `memory.db` on every run.

---

## What SIS Does

SIS has two main phases that run on a periodic schedule:

### Phase 1: Consolidation

The consolidation phase reads recent contemplation episodes, finds patterns,
and extracts lessons:

1. **Read recent reflections** — gather episodes from the last N hours
2. **Search related memories** — find items that connect to the episode themes
3. **LLM pattern extraction** — send context to the model, ask for if-then-because lessons
4. **Store reflection** — save the consolidation as a reflection record
5. **Store lessons** — save each extracted lesson with confidence, tags, related tools

### Phase 2: Maintenance Cycle

The maintenance cycle keeps the lesson library healthy:

1. **Decay stale lessons** — reduce confidence on lessons not seen recently
2. **List all lessons** — read up to 500 lessons for analysis
3. **Deduplicate** — find near-duplicate lessons, merge them (reinforce winner, delete losers)
4. **Promote high-confidence lessons** — boost lessons that keep recurring
5. **Re-read** — verify the lesson library is consistent after changes

---

## The Corruption Problem

### What was happening

```
sis-runner.ts line 448: runMaintenanceCycle()
  │
  ├─ decayLessons()        ← bulk UPDATE on lessons table
  ├─ listLessons(500)      ← large SELECT
  ├─ reinforceLesson()     ← UPDATE in a loop (for each duplicate winner)
  ├─ deleteLesson()        ← DELETE (for each duplicate loser)
  └─ listLessons()         ← SELECT to verify
```

This heavy read-write-delete churn was running inside `memory.db` using the
experimental `node:sqlite` `DatabaseSync` driver. The WAL (Write-Ahead Log)
journal couldn't handle it — especially after unclean gateway shutdowns that
left the WAL in an inconsistent state.

### The error

```
Error: database disk image is malformed
  at runMaintenanceCycle (sis-runner.ts:448)
```

### What the logs showed

Every SIS cycle would show:

- Reflections stored: 1-3 (consolidation worked fine)
- Lessons extracted: 9 (pattern extraction worked fine)
- Lessons stored: 0 (dedup usually kicked in — this was normal)
- Maintenance cycle: **FAILED** — "database disk image is malformed"

The consolidation phase (reads + writes) succeeded because it was less intensive.
The maintenance cycle (bulk updates + deletes + re-reads) is where the WAL
corruption surfaced.

### The orphaned sis.db

There was a 0-byte `~/.argentos/sis.db` file that appeared to be an SIS database.
Code tracing confirmed SIS operates entirely on `memory.db` through the MemuStore
singleton — it never creates or uses a separate database. The `sis.db` file was
an orphaned artifact from an earlier development iteration.

---

## Phase 0 Fix: better-sqlite3 (Completed)

The immediate fix replaced `node:sqlite` with `better-sqlite3`:

- **Branch**: `fix/memu-better-sqlite3` (merged to main, commit `87d4203`)
- **Driver swap**: `node:sqlite` DatabaseSync → `better-sqlite3`
- **WAL checkpoint**: `closeDatabase()` now calls `PRAGMA wal_checkpoint(TRUNCATE)`
  before closing, preventing stale WAL state across restarts
- **Graceful shutdown**: Gateway shutdown sequence now calls `closeMemuStore()`

This fixed the immediate corruption, but the underlying architectural weakness
remains: SQLite is single-writer, and the maintenance cycle's read-write-delete
pattern is inherently risky under load.

---

## SIS Today (Post Phase 0)

```
sis-runner.ts
  │
  ├─ consolidate()
  │    ├─ memuStore.listReflections()         ← read recent episodes
  │    ├─ memuStore.searchItems()             ← find related memories
  │    ├─ LLM call (pattern extraction)
  │    ├─ memuStore.createReflection()        ← store consolidation     ✅
  │    └─ memuStore.createLesson()            ← store lessons           ✅
  │
  └─ runMaintenanceCycle()
       ├─ memuStore.decayLessons()            ← bulk UPDATE             ✅ (fixed)
       ├─ memuStore.listLessons(500)          ← large SELECT            ✅ (fixed)
       ├─ memuStore.reinforceLesson()         ← UPDATE loop             ✅ (fixed)
       ├─ memuStore.deleteLesson()            ← DELETE dupes            ✅ (fixed)
       └─ memuStore.listLessons()             ← re-read                 ✅ (fixed)
```

Works now with better-sqlite3. But still single-writer, still file-based, still
no multi-agent capability.

---

## SIS After Migration (PostgreSQL + Redis)

### Data Flow

```
sis-runner.ts
  │
  ├─ consolidate()
  │    │
  │    ├─ adapter.memory.listReflections()           ← PG: concurrent-safe reads
  │    ├─ adapter.memory.searchItems()                ← PG: pgvector HNSW search
  │    │                                                (faster than sqlite-vec)
  │    ├─ LLM call (pattern extraction)               ← unchanged
  │    │
  │    ├─ adapter.memory.createReflection()           ← PG: ACID transaction
  │    ├─ adapter.memory.createLesson()               ← PG: ACID transaction
  │    │
  │    └─ if lesson.confidence >= 0.8:                ← NEW: knowledge sharing
  │         adapter.memory.publishToSharedKnowledge()    ← PG: shared_knowledge table
  │         redis.sendFamilyMessage("lesson_shared")     ← Redis: notify siblings
  │         redis.publishDashboardEvent("memory_stored") ← Redis: dashboard event
  │
  └─ runMaintenanceCycle()
       │
       ├─ adapter.memory.decayLessons()               ← PG: bulk UPDATE, no WAL risk
       ├─ adapter.memory.listLessons(500)              ← PG: connection pool, no contention
       ├─ adapter.memory.reinforceLesson()             ← PG: individual UPDATEs, MVCC
       ├─ adapter.memory.deleteLesson()                ← PG: proper transactions
       └─ adapter.memory.listLessons()                 ← PG: clean read, no corruption
```

### Why PostgreSQL Fixes the SIS Problem

| SQLite Problem                         | PostgreSQL Solution                        |
| -------------------------------------- | ------------------------------------------ |
| Single-writer file lock                | MVCC — multiple concurrent writers         |
| WAL corruption on unclean shutdown     | WAL is crash-safe by design (pgdata)       |
| No connection pooling                  | postgres.js manages pool of 10 connections |
| Maintenance cycle blocks contemplation | Separate connections, no contention        |
| No transactions in node:sqlite         | Full ACID transactions via Drizzle         |
| sqlite-vec KNN is slow on 10K+ items   | pgvector HNSW indexes — O(log n) search    |

### The Maintenance Cycle Specifically

The dedup merge operation that was causing corruption can now be wrapped in a
proper PostgreSQL transaction:

```sql
BEGIN;
  -- Find near-duplicates (vector similarity)
  SELECT id, lesson, confidence, embedding <=> $1 AS distance
  FROM lessons
  WHERE agent_id = $agent AND embedding <=> $1 < 0.15
  ORDER BY confidence DESC;

  -- Reinforce the winner
  UPDATE lessons SET
    occurrences = occurrences + $loser_occurrences,
    confidence = LEAST(confidence + 0.05, 1.0),
    last_seen = NOW()
  WHERE id = $winner_id;

  -- Delete the losers
  DELETE FROM lessons WHERE id = ANY($loser_ids);
COMMIT;
```

If anything fails mid-operation, the entire transaction rolls back. No partial
state, no corruption, no orphaned rows.

---

## Family SIS Consolidation (Phase 5 — New)

This is the new capability that doesn't exist today. It runs across ALL agents
in the family, not just a single agent:

### How It Works

```
familyConsolidation()
  │
  ├─ 1. Gather recent episodes from ALL agents
  │      SELECT r.*, a.name as agent_name
  │      FROM reflections r
  │      JOIN agents a ON r.agent_id = a.id
  │      WHERE r.created_at > NOW() - INTERVAL '24 hours'
  │      (RLS bypassed for family-scoped query)
  │
  ├─ 2. LLM finds cross-agent patterns
  │      "Argent noticed X during contemplation,
  │       Scout discovered Y during research,
  │       Forge encountered Z while coding —
  │       there's a connection here..."
  │
  ├─ 3. Store as shared_knowledge
  │      INSERT INTO shared_knowledge (
  │        source_agent_id, category, title, content,
  │        embedding, confidence
  │      ) VALUES (...)
  │
  └─ 4. Broadcast to family via Redis Streams
       XADD stream:family * sender "sis" type "lesson_shared"
         payload '{"title":"...", "confidence":0.9}'
       │
       └─ Each agent picks up shared lessons on next heartbeat
            XREADGROUP GROUP agent:argent argent
              COUNT 10 STREAMS stream:family >
```

### Shared Knowledge Table

High-confidence lessons (>= 0.8) are automatically published to the
`shared_knowledge` table, which is readable by ALL agents (no RLS restriction):

```sql
CREATE TABLE shared_knowledge (
  id TEXT PRIMARY KEY,
  source_agent_id TEXT NOT NULL,     -- who discovered this
  source_item_id TEXT,                -- original lesson/memory ID
  category TEXT NOT NULL,             -- 'lesson', 'fact', 'tool_tip', 'pattern'
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1536),             -- for semantic search
  confidence REAL DEFAULT 0.5,
  endorsements INTEGER DEFAULT 0,     -- how many agents found this useful
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

When another agent finds a shared lesson useful, they "endorse" it — increasing
its visibility and confidence in the shared library.

---

## SIS Active Injection (Still TODO)

The biggest remaining gap in SIS is **active injection** — automatically inserting
relevant lessons into agent prompts before they respond. The file
`src/infra/sis-active-lessons.ts` is currently a stub.

The vision:

```
User sends message
  │
  ├─ Agent receives message
  ├─ Before generating response:
  │    ├─ Extract tool names from message context
  │    ├─ adapter.memory.getRelevantLessons({ toolNames, query })
  │    ├─ Search shared_knowledge for family lessons
  │    └─ Inject top N lessons into system prompt:
  │         "From your experience:
  │          - When using X tool, always Y because Z
  │          - Avoid doing A because it leads to B"
  │
  └─ Agent generates response (informed by lessons)
```

This is Phase 5 work — depends on the PG migration being complete and the
shared knowledge library being populated.

---

## Migration Timeline for SIS

```
Phase 0 ✅  better-sqlite3 swap — fixed corruption
Phase 1 ✅  StorageAdapter interface — adapter.memory.* methods defined
Phase 2 ✅  PG schema — lessons table with pgvector HNSW + tsvector FTS
Phase 3     SQLiteAdapter wrapper — bridge existing MemuStore calls
Phase 4     PgAdapter implementation — Drizzle ORM lesson operations
            Data migration — copy lessons from SQLite to PG
            Dual-write — verify both backends get lesson writes
Phase 5     Family SIS consolidation — cross-agent patterns
            Shared knowledge publishing — auto-publish high-confidence lessons
            Active injection — inject lessons into prompts (stub → real)
Phase 6     Cutover — SIS reads/writes exclusively from PG
```

---

## Key Files

| File                                | Purpose                                             |
| ----------------------------------- | --------------------------------------------------- |
| `src/infra/sis-runner.ts`           | Main SIS consolidation + maintenance loop (659 LOC) |
| `src/infra/sis-lesson-extractor.ts` | LLM-based pattern extraction from episodes          |
| `src/infra/sis-self-eval.ts`        | Self-evaluation scoring                             |
| `src/infra/sis-active-lessons.ts`   | Active injection into prompts (**STUB**)            |
| `src/memory/memu-store.ts`          | Current lesson CRUD (SQLite)                        |
| `src/data/pg/schema.ts`             | PostgreSQL lessons table + shared_knowledge         |
| `src/data/adapter.ts`               | StorageAdapter.memory interface                     |
| `src/data/redis-client.ts`          | sendFamilyMessage() for lesson broadcasting         |
