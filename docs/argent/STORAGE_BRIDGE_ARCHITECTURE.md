# Storage Bridge Architecture

> How ArgentOS migrates from SQLite to PostgreSQL + Redis without breaking anything.

## The Problem

ArgentOS has multiple subsystems that all talk directly to SQLite:

- **Contemplation Runner** — the always-on thinking loop (episodes, moods, reflections)
- **SIS** — Self-Improving System (lesson extraction, maintenance, pattern consolidation)
- **Heartbeat** — periodic checklist and accountability scoring
- **Channels** — Telegram, Discord, Slack, WhatsApp message handling
- **Agent Tools** — memory capture, task CRUD during conversations
- **Dashboard** — React frontend reading everything via WebSocket

We can't rip out SQLite overnight. We need both SQLite and PostgreSQL running
side-by-side during migration, with the ability to roll back at any point.

---

## The StorageAdapter Interface

The **StorageAdapter** (`src/data/adapter.ts`) is a single interface that both
SQLite and PostgreSQL implementations conform to. It has three sub-adapters:

```
StorageAdapter
  ├── memory: MemoryAdapter      (memories, lessons, reflections, entities, categories)
  ├── tasks: TaskAdapter          (task CRUD, projects, dependencies)
  └── teams: TeamAdapter          (team lifecycle, membership)
```

Every subsystem calls the adapter instead of directly calling MemuStore or TasksModule.

---

## The Bridge Pattern

```
                         ┌─────────────────────────┐
  Contemplation ────────→│                         │
  SIS ──────────────────→│    StorageAdapter        │
  Heartbeat ────────────→│    (feature flags)       │
  Agent Tools ──────────→│                         │
  Channels ─────────────→│                         │
                         └─────┬─────────────┬─────┘
                               │             │
                    ┌──────────▼───┐   ┌────▼───────────┐
                    │ SQLiteAdapter │   │   PgAdapter     │
                    │ (bridge)      │   │   (Drizzle ORM) │
                    └──────┬───────┘   └────┬────────────┘
                           │                │
                     memory.db         PostgreSQL:5433
                    dashboard.db
```

### SQLiteAdapter (The Bridge)

The **SQLiteAdapter** is a thin wrapper that takes the existing `MemuStore` class
and `TasksModule` class and makes them conform to the `StorageAdapter` interface.
It doesn't change any existing behavior — it just translates method calls:

```typescript
// Before (direct):
const store = getMemuStore();
store.createItem({ summary: "...", memoryType: "knowledge" });

// After (through adapter):
const adapter = getStorageAdapter();
adapter.memory.createItem({ summary: "...", memoryType: "knowledge" });
```

Under the hood, `SQLiteAdapter.memory.createItem()` just calls `memuStore.createItem()`.
Same code, same SQLite database, same behavior. The adapter adds zero overhead — it's
purely a routing layer.

### PgAdapter (The Destination)

The **PgAdapter** implements the same interface using Drizzle ORM and PostgreSQL.
Same method signatures, same input/output types, completely different backend.

### Feature Flag Control

The `storage` key in `~/.argentos/argent.json` controls which adapter(s) are active:

```json
{
  "storage": {
    "backend": "dual",
    "readFrom": "sqlite",
    "writeTo": ["sqlite", "postgres"],
    "postgres": { "connectionString": "postgres://localhost:5433/argentos" },
    "redis": { "host": "127.0.0.1", "port": 6380 }
  }
}
```

| Config                                  | Reads From    | Writes To     | Use Case                             |
| --------------------------------------- | ------------- | ------------- | ------------------------------------ |
| `backend: "sqlite"`                     | SQLiteAdapter | SQLiteAdapter | Current default, no change           |
| `backend: "dual", readFrom: "sqlite"`   | SQLiteAdapter | **Both**      | Step 1: PG gets writes, SQLite reads |
| `backend: "dual", readFrom: "postgres"` | PgAdapter     | **Both**      | Step 2: PG reads, SQLite backup      |
| `backend: "postgres"`                   | PgAdapter     | PgAdapter     | Final: SQLite deprecated             |

In **dual-write mode**, every `createItem()`, `createLesson()`, `reinforceItem()`
writes to BOTH SQLite and PostgreSQL simultaneously. Reads come from whichever
backend `readFrom` points to. If anything goes wrong with PG, flip one config
value back to `"sqlite"` — zero data loss, instant rollback.

---

## The Three Data Lanes

The migration adds two new data pathways alongside the existing one:

### Lane 1: StorageAdapter (SQLite ↔ PostgreSQL)

**Durable data that must survive restarts.**

- Memories, lessons, reflections, entities, categories
- Tasks, projects, dependencies
- Teams, sessions, observations
- Model feedback and performance tracking

This is the same data ArgentOS stores today, just routed through a pluggable backend.

### Lane 2: Redis (port 6380)

**Hot ephemeral state and real-time coordination. Entirely new capabilities.**

- **Agent Presence**: "Is Argent alive?" — 30-second TTL key, expiry = agent down
- **Agent State**: Current mood, valence, arousal, what they're doing right now
- **Inter-Agent Streams**: Reliable persistent messaging between family members
  - "Scout found something interesting, passing to Argent"
  - "Argent learned a lesson with high confidence, sharing with the family"
- **Dashboard Pub/Sub**: Real-time event notifications (mood changes, task updates)
- **Session Cache**: Reduces PG reads for frequently accessed data

Redis is **optional** — if Redis is down, the system degrades gracefully. No presence
tracking or inter-agent messaging, but all durable operations continue via Lane 1.

### Lane 3: Direct WebSocket (gateway ↔ dashboard)

**Live UI updates. This already exists and stays as-is.**

- AEVP visual state (particle colors, orb behavior)
- Chat messages in real-time
- Live UI updates (task board, project kanban)

---

## How Each Subsystem Uses the Lanes

Subsystems don't choose between lanes — they use multiple lanes for different
classes of data:

### Contemplation Runner

```
contemplation-runner.ts
  │
  ├─ Lane 1: adapter.memory.createReflection()      ← durable episode storage
  │          adapter.memory.createItem()              ← episode memories
  │
  ├─ Lane 2: redis.setAgentState({ mood, valence })  ← hot emotional state
  │          redis.publishDashboardEvent()            ← real-time "mood changed"
  │
  └─ Lane 3: gateway WebSocket → dashboard           ← AEVP visual update
```

### SIS (Self-Improving System)

```
sis-runner.ts
  │
  ├─ Lane 1: adapter.memory.listReflections()         ← read episodes
  │          adapter.memory.searchItems()              ← find related memories
  │          adapter.memory.createLesson()             ← store extracted lessons
  │          adapter.memory.decayLessons()             ← maintenance cycle
  │
  ├─ Lane 2: redis.sendFamilyMessage("lesson_shared") ← notify sibling agents
  │          redis.publishDashboardEvent()             ← "lesson learned" event
  │
  └─ (no Lane 3 — SIS doesn't directly update dashboard UI)
```

### Heartbeat Runner

```
heartbeat-runner.ts
  │
  ├─ Lane 1: adapter.tasks.list()                     ← read tasks for scoring
  │          adapter.memory.createReflection()         ← journal heartbeat cycles
  │
  ├─ Lane 2: redis.refreshPresence()                  ← "I'm alive" (30s TTL)
  │          redis.setAgentState({ status })           ← "processing" / "idle"
  │
  └─ Lane 3: gateway WebSocket → dashboard            ← accountability updates
```

### Channels (Telegram, Discord, etc.)

```
channels/*
  │
  ├─ Lane 1: adapter.memory.createItem()              ← capture conversation memories
  │          adapter.tasks.create()                    ← task creation from chat
  │
  ├─ Lane 2: redis.setAgentState({ status })          ← "processing message"
  │
  └─ Lane 3: gateway WebSocket → dashboard            ← live chat display
```

### Agent Tools (during conversations)

```
agents/tools/*
  │
  ├─ Lane 1: adapter.memory.*                         ← all memory operations
  │          adapter.tasks.*                           ← all task operations
  │
  └─ Lane 2: redis.publishDashboardEvent()            ← "memory_stored" events
```

---

## Key Design Decisions

### Why not just swap SQLite for PG directly?

- **Risk**: If PG has issues, the entire system is down. Dual-write lets us validate
  PG behavior while SQLite continues serving reads.
- **Verification**: We can compare query results between backends before cutting over.
- **Rollback**: One config change reverts to pure SQLite.

### Why Redis instead of just PG for everything?

- **Latency**: Agent presence needs sub-millisecond TTL checks. PG polling is too slow.
- **Pub/Sub**: Redis pub/sub is purpose-built for real-time dashboard events.
- **Streams**: Redis Streams provide reliable, persistent inter-agent messaging with
  consumer groups — exactly what the multi-agent family needs.
- **Ephemeral data**: "Current mood" and "last heartbeat" shouldn't be in the
  permanent database. They're hot state with short lifespans.

### Why Drizzle ORM instead of raw SQL?

- **Type safety**: Schema definitions generate TypeScript types automatically.
- **pgvector support**: Built-in distance functions (cosineDistance, l2Distance).
- **Migration management**: Auto-generated migration SQL from schema changes.
- **Zero runtime overhead**: Compiles to raw SQL, no ORM abstraction penalty.

---

## Port Configuration

ArgentOS uses non-default ports to avoid conflicts with other services:

| Service    | ArgentOS Port | Default Port |
| ---------- | ------------- | ------------ |
| PostgreSQL | **5433**      | 5432         |
| Redis      | **6380**      | 6379         |

Constants defined in `src/data/storage-config.ts`:

- `ARGENT_PG_PORT = 5433`
- `ARGENT_REDIS_PORT = 6380`

---

## Current Migration Status (2026-02-16)

The migration is in **dual-write mode** with reads from PostgreSQL:

```json
{
  "storage": {
    "backend": "dual",
    "readFrom": "postgres",
    "writeTo": ["sqlite", "postgres"]
  }
}
```

### What's Working Now

- **PG Write Mirror** — All MemuStore writes (createItem, createLesson, etc.) are
  automatically mirrored to PG via method wrapping. No call-site changes needed.
- **Redis Agent State Bridge** — Heartbeat cycles, contemplation episodes, and memory
  stores fire real-time events to Redis for dashboard updates.
- **Multi-Agent Family** — 4 agents registered (Argent, Scout, Forge, Lens) with shared
  knowledge library, vector search, and inter-agent Redis Streams.
- **SIS → Shared Knowledge** — High-confidence lessons (>=0.8) are auto-published to
  the family shared knowledge library after SIS consolidation.
- **24,808 rows migrated** — All SQLite data live in PG with HNSW vector indexes.

### PG Write Mirror Pattern

Instead of changing 24+ call sites that use `getMemuStore()` directly, a write mirror
wraps MemuStore's 10 write methods at gateway startup:

```
getMemuStore().createItem(...)
  │
  ├─ SQLite write (synchronous, original behavior)
  │
  └─ PG write (async fire-and-forget via MemoryAdapter)
      └─ Redis onMemoryStored event (dashboard notification)
```

This gives us dual-write with zero call-site migration. Reads still go through SQLite
for direct MemuStore callers, while the DualAdapter serves PG reads for code using
`getStorageAdapter()`.

### What Remains for Full Cutover

1. **Async read migration** — 24 files use `getMemuStore()` synchronously. To fully
   cut over to PG-only, these need async adapters or the MemuStore backend needs to
   be swapped to PG.
2. **Gateway stop SQLite writes** — Change `writeTo` to `["postgres"]` only.
3. **Deprecate SQLite** — Remove MemuStore dependency once all reads go through PG.

---

## Files

| File                               | Purpose                                            |
| ---------------------------------- | -------------------------------------------------- |
| `src/data/adapter.ts`              | StorageAdapter interface definition                |
| `src/data/storage-config.ts`       | Feature flags, port constants, config resolution   |
| `src/data/storage-factory.ts`      | Config-driven adapter creation singleton           |
| `src/data/sqlite-adapter.ts`       | SQLite adapter (wraps MemuStore + DataAPI)         |
| `src/data/pg-adapter.ts`           | PostgreSQL adapter (Drizzle ORM, 980 LOC)          |
| `src/data/dual-adapter.ts`         | Dual-write adapter routing                         |
| `src/data/pg-write-mirror.ts`      | Wraps MemuStore writes → PG (10 methods)           |
| `src/data/pg-client.ts`            | PostgreSQL connection pool (postgres.js)           |
| `src/data/redis-client.ts`         | Redis connection + agent state + streams + pub/sub |
| `src/data/redis-agent-state.ts`    | Redis event bridge for heartbeat/contemplation/SIS |
| `src/data/agent-family.ts`         | Multi-agent family: registry, shared knowledge     |
| `src/data/pg/schema.ts`            | Drizzle ORM schema (16 tables)                     |
| `src/data/pg/migrations/`          | SQL migrations (pgvector, HNSW, FTS, RLS)          |
| `src/data/migrate/sqlite-to-pg.ts` | One-shot SQLite → PG data migration script         |
| `drizzle.config.ts`                | Drizzle Kit configuration                          |
| `scripts/setup-postgres.sh`        | PG17 + pgvector + pg_trgm installation             |
| `scripts/setup-redis.sh`           | Redis installation + LaunchAgent                   |
