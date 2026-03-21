# MemU Integration Plan for ArgentOS

> **Branch**: `memu-upgrade`
> **Status**: Planning
> **Priority**: High — fixes the critical memory/journaling gap
> **Reference**: https://github.com/NevaMind-AI/MemU (8.2k stars, Python, MIT license)

---

## Problem Statement

ArgentOS has a critical memory gap: when the agent performs actions during heartbeats, cron jobs, or background tasks (Moltyverse posts, moderation, upvotes, comments), none of these actions persist in memory. The agent forgets its own behavior between sessions.

**Current state:**

- **Memo** (observation capture) is implemented but `registerMemo()` is never called during gateway startup — auto-capture silently does nothing
- **Memory Search** indexes curated `MEMORY.md` files with vector + BM25 hybrid search — works but only covers hand-written docs, not conversation history or agent actions
- No fact extraction, no reinforcement learning, no categorization
- Raw tool outputs are stored (when Memo works) but never distilled into retrievable knowledge

**What we need:**

- Automatic extraction of facts/events/knowledge from conversations and tool usage
- Persistent memory that survives across sessions
- Retrieval that finds relevant memories by topic, not just keyword
- Reinforcement so frequently-referenced memories stay accessible
- Journaling of agent actions (heartbeat activities, cron jobs, background tasks)

---

## MemU Architecture Overview

MemU implements a three-layer memory hierarchy with LLM-driven extraction and dual retrieval modes.

### Three-Layer Hierarchy

```
Resources (raw inputs)
    │
    ▼ LLM extraction
Memory Items (structured facts)
    │
    ▼ Auto-categorization
Memory Categories (organized topics)
```

**Resources**: Raw conversation segments, documents, images — the source material.
**Memory Items**: Extracted facts with types (profile, event, knowledge, behavior, skill, tool). Each has an embedding vector, reinforcement count, and content hash for dedup.
**Memory Categories**: Auto-organized topics with evolving LLM-generated summaries. Items are linked to categories via junction table.

### Key Concepts

| Concept                 | Description                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| **Extraction Pipeline** | Workflow-based: ingest → preprocess → extract items → dedupe → categorize → persist                    |
| **Memory Types**        | `profile`, `event`, `knowledge`, `behavior`, `skill`, `tool` — each has specialized extraction prompts |
| **Salience Scoring**    | `score = cosine_similarity × reinforcement_count × recency_decay`                                      |
| **Recency Decay**       | Exponential half-life: `exp(-ln(2) × days_ago / half_life_days)`                                       |
| **Reinforcement**       | Every retrieval increments `reinforcement_count` and updates `last_reinforced_at`                      |
| **Dual Retrieval**      | RAG mode (fast vector search) vs LLM mode (deep reasoning-based ranking)                               |
| **Sufficiency Check**   | LLM decides if retrieved results are "enough" or if deeper search is needed                            |
| **Category Summaries**  | LLM merges new items into existing category summaries with `[ref:ITEM_ID]` citations                   |
| **Content Hashing**     | SHA-256 hash of item summaries for deduplication                                                       |

---

## Decision: Replace MIMO, Keep Memory Search

### Replace Memo (Observation Capture) with MemU Extraction

**Reason**: Memo stores raw tool outputs with a flat 1-10 importance score. MemU extracts structured facts, categorizes them, and supports reinforcement learning. Memo's capture pipeline feeds naturally into MemU as the "Resource" layer.

### Keep Memory Search (MEMORY.md Hybrid Search)

**Reason**: Memory Search serves a different purpose — searching curated documentation files. This complements MemU's conversation-based memory. Keep it as a parallel system.

### Database Strategy: SQLite First, PostgreSQL Later

**Phase 1**: SQLite with FTS5 + in-process cosine similarity (TypeScript). Single-user, single-agent. No operational overhead.

**Phase 2**: PostgreSQL + pgvector when we need:

- Multi-agent shared memory
- Multi-tenant support
- Large-scale vector indexing (IVFFlat/HNSW)
- Concurrent write-heavy workloads

---

## Database Schema

### SQLite Schema (Phase 1)

```sql
-- Resources: raw inputs (conversations, tool outputs, documents)
CREATE TABLE resources (
  id TEXT PRIMARY KEY,               -- UUID
  url TEXT NOT NULL DEFAULT '',      -- source identifier (session key, file path, URL)
  modality TEXT NOT NULL DEFAULT 'text',  -- text, image, audio, conversation
  local_path TEXT,                   -- local file path if applicable
  caption TEXT,                      -- brief description
  embedding BLOB,                   -- Float32Array as binary (nullable)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Memory Items: extracted facts
CREATE TABLE memory_items (
  id TEXT PRIMARY KEY,               -- UUID
  resource_id TEXT REFERENCES resources(id) ON DELETE SET NULL,
  memory_type TEXT NOT NULL,         -- profile, event, knowledge, behavior, skill, tool
  summary TEXT NOT NULL,             -- the extracted fact
  embedding BLOB,                   -- Float32Array as binary (nullable)
  happened_at TEXT,                  -- when the event/fact occurred
  content_hash TEXT,                 -- SHA-256 for dedup
  reinforcement_count INTEGER NOT NULL DEFAULT 1,
  last_reinforced_at TEXT,
  extra TEXT DEFAULT '{}',           -- JSON for extensible metadata
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Memory Categories: organized topics
CREATE TABLE memory_categories (
  id TEXT PRIMARY KEY,               -- UUID
  name TEXT NOT NULL UNIQUE,         -- category name
  description TEXT,                  -- brief description
  embedding BLOB,                   -- Float32Array as binary (nullable)
  summary TEXT,                      -- LLM-generated evolving summary
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Category-Item junction table
CREATE TABLE category_items (
  item_id TEXT NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES memory_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, category_id)
);

-- Indexes
CREATE INDEX idx_items_resource ON memory_items(resource_id);
CREATE INDEX idx_items_type ON memory_items(memory_type);
CREATE INDEX idx_items_hash ON memory_items(content_hash);
CREATE INDEX idx_items_created ON memory_items(created_at);
CREATE INDEX idx_items_reinforced ON memory_items(last_reinforced_at);

-- FTS5 for keyword search
CREATE VIRTUAL TABLE memory_items_fts USING fts5(
  summary,
  content='memory_items',
  content_rowid='rowid',
  tokenize='porter unicode61'
);

CREATE VIRTUAL TABLE memory_categories_fts USING fts5(
  name,
  description,
  summary,
  content='memory_categories',
  content_rowid='rowid',
  tokenize='porter unicode61'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER memory_items_ai AFTER INSERT ON memory_items BEGIN
  INSERT INTO memory_items_fts(rowid, summary) VALUES (new.rowid, new.summary);
END;
CREATE TRIGGER memory_items_ad AFTER DELETE ON memory_items BEGIN
  INSERT INTO memory_items_fts(memory_items_fts, rowid, summary)
    VALUES('delete', old.rowid, old.summary);
END;
CREATE TRIGGER memory_items_au AFTER UPDATE ON memory_items BEGIN
  INSERT INTO memory_items_fts(memory_items_fts, rowid, summary)
    VALUES('delete', old.rowid, old.summary);
  INSERT INTO memory_items_fts(rowid, summary) VALUES (new.rowid, new.summary);
END;
```

### PostgreSQL Schema (Phase 2 — future)

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL DEFAULT '',
  modality VARCHAR(50) NOT NULL DEFAULT 'text',
  local_path TEXT,
  caption TEXT,
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE memory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id UUID REFERENCES resources(id) ON DELETE SET NULL,
  memory_type VARCHAR(50) NOT NULL,
  summary TEXT NOT NULL,
  embedding vector(1536),
  happened_at TIMESTAMPTZ,
  content_hash VARCHAR(64),
  reinforcement_count INTEGER DEFAULT 1,
  last_reinforced_at TIMESTAMPTZ,
  extra JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE memory_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  embedding vector(1536),
  summary TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE category_items (
  item_id UUID NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES memory_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, category_id)
);

CREATE INDEX ON memory_items USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX ON memory_categories USING ivfflat (embedding vector_cosine_ops) WITH (lists = 20);
```

---

## TypeScript File Structure

```
src/memory/
├── index.ts                  # Public exports
├── types.ts                  # Resource, MemoryItem, MemoryCategory interfaces
├── schema.ts                 # SQLite schema creation + migrations
├── store.ts                  # Repository CRUD (SQLite driver)
│
├── extract/
│   ├── pipeline.ts           # Extraction workflow orchestrator
│   ├── extract-items.ts      # LLM-driven fact extraction per memory type
│   ├── dedupe.ts             # Content hash dedup + merge logic
│   ├── categorize.ts         # Auto-assign items to categories
│   └── prompts/              # Extraction prompt templates
│       ├── profile.ts        # Extract user preferences, identity, relationships
│       ├── event.ts          # Extract events, milestones, occurrences
│       ├── knowledge.ts      # Extract facts, information, references
│       ├── behavior.ts       # Extract habits, patterns, tendencies
│       ├── skill.ts          # Extract abilities, competencies
│       └── tool.ts           # Extract tool usage patterns
│
├── retrieve/
│   ├── search.ts             # Main retrieval entry point
│   ├── vector-search.ts      # Cosine similarity search on embeddings
│   ├── keyword-search.ts     # FTS5 keyword search
│   ├── salience.ts           # Reinforcement + recency decay scoring
│   ├── reranker.ts           # Optional LLM-based re-ranking
│   └── prompts/
│       ├── rank-categories.ts
│       ├── rank-items.ts
│       └── sufficiency.ts    # "Do we have enough context?" check
│
├── categories/
│   ├── manager.ts            # Category CRUD + summary generation
│   └── prompts/
│       └── summarize.ts      # Merge new items into category summary
│
├── embed.ts                  # Embedding provider (routes through model router)
├── workflow.ts               # Generic DAG workflow executor
│
├── memo.ts                   # KEEP: Modified to create Resources + trigger extraction
├── memo-schema.ts            # KEEP: Legacy observation schema (backwards compat)
├── manager.ts                # KEEP: MEMORY.md file search (separate concern)
└── manager-search.ts         # KEEP: Hybrid vector+BM25 search for docs
```

---

## Data Flow

### Capture → Extract → Store

```
┌────────────────────────────────┐
│  Agent Runtime (any session)   │
│  - Chat conversations          │
│  - Heartbeat tool calls        │
│  - Cron job actions            │
│  - Background tasks            │
└──────────────┬─────────────────┘
               │ agent events
               ▼
┌──────────────────────────────────┐
│  Memo (observation capture)      │
│  - Registers in gateway startup  │  ← FIX: call registerMemo()
│  - Captures tool results         │
│  - Captures conversation turns   │
│  - Creates Resource record       │
└──────────────┬───────────────────┘
               │ async (non-blocking)
               ▼
┌──────────────────────────────────────────────┐
│  Extraction Pipeline (background)            │
│                                              │
│  1. Load Resource text                       │
│  2. For each memory type (profile, event,    │
│     knowledge, behavior, skill, tool):       │
│     - Build type-specific prompt             │
│     - LLM extracts facts                    │
│     - Parse structured output                │
│  3. Deduplicate (content hash)               │
│     - If duplicate: increment reinforcement  │
│     - If new: create MemoryItem              │
│  4. Generate embeddings (via model router)   │
│  5. Auto-categorize:                         │
│     - Match to existing categories           │
│     - Create new categories if needed        │
│  6. Update category summaries (LLM merge)    │
└──────────────────────────────────────────────┘
```

### Retrieve → Rank → Inject

```
┌──────────────────────────────────┐
│  Agent needs context             │
│  (tool call or auto-inject)      │
└──────────────┬───────────────────┘
               │ query
               ▼
┌──────────────────────────────────────────────┐
│  Retrieval Pipeline                          │
│                                              │
│  1. Embed query (model router)               │
│  2. Search categories:                       │
│     - Vector similarity on category embed    │
│     - FTS5 keyword match on name/summary     │
│     - Return top-K categories                │
│  3. Sufficiency check (LLM):                 │
│     - "Do categories cover the query?"       │
│     - If insufficient → search items too     │
│  4. Search items (within matched categories):│
│     - Vector similarity on item embeddings   │
│     - Salience scoring:                      │
│       score = cosine × reinforcement × decay │
│     - FTS5 keyword match on summary          │
│  5. Optional LLM re-ranking                  │
│  6. Reinforce retrieved items:               │
│     - reinforcement_count += 1               │
│     - last_reinforced_at = now()             │
│  7. Return ranked results                    │
└──────────────────────────────────────────────┘
```

---

## Agent Tools

### Updated Tools

| Tool                | Action   | Description                                                                                           |
| ------------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| `memory_recall`     | Retrieve | Search memory for relevant context (replaces/extends current `memory_search` for conversation memory) |
| `memory_store`      | Extract  | Manually store a fact/note (bypasses extraction pipeline)                                             |
| `memory_search`     | Search   | Keep existing — searches curated MEMORY.md files                                                      |
| `memory_categories` | List     | List all memory categories with item counts                                                           |
| `memory_forget`     | Delete   | Remove a specific memory item (by ID or content match)                                                |

### Auto-Injection

Before each agent run, automatically retrieve and inject relevant memories based on:

1. The user's message (embed and search)
2. The current session context (recent topics)
3. Time-based relevance (recent events)

This replaces the need for the agent to explicitly call `memory_recall` — relevant memories appear in the system prompt automatically.

---

## Embedding Strategy

Route embedding requests through ArgentOS model router:

| Tier        | Provider       | Model                    | Dimensions | Use Case                             |
| ----------- | -------------- | ------------------------ | ---------- | ------------------------------------ |
| **Free**    | Local (Ollama) | `nomic-embed-text`       | 768        | Background extraction, bulk indexing |
| **Cheap**   | OpenAI         | `text-embedding-3-small` | 1536       | Real-time retrieval, query embedding |
| **Quality** | OpenAI         | `text-embedding-3-large` | 3072       | High-value items (future)            |

Default: `text-embedding-3-small` for balance of quality and cost. Fall back to local `nomic-embed-text` when API is unavailable.

---

## Extraction Prompts (Ported from MemU)

Each memory type has a specialized extraction prompt. Examples:

### Profile Extraction

```
Extract personal information about the user from the following conversation.
Look for: name, preferences, relationships, demographics, opinions, goals.
Format each fact as a single clear sentence.
Only extract facts explicitly stated — do not infer.
```

### Event Extraction

```
Extract events and occurrences from the following conversation.
Look for: things that happened, milestones, incidents, actions taken.
Include approximate timestamps if mentioned.
Format each event as: "On [date/context], [what happened]."
```

### Knowledge Extraction

```
Extract factual information and references from the following conversation.
Look for: facts, data points, technical details, URLs, tool names, commands.
Format each piece of knowledge as a standalone fact.
```

### Behavior Extraction

```
Extract behavioral patterns and habits from the following conversation.
Look for: routines, preferences, tendencies, decision patterns.
Format each pattern as: "[Entity] tends to [behavior] when [context]."
```

Full prompt templates will be ported from MemU's `/memu/prompts/` directory.

---

## Implementation Phases

### Phase 1: Foundation (2-3 days)

**Goal**: Schema, types, store, and fix Memo registration

- [ ] Create `src/memory/types.ts` — TypeScript interfaces for Resource, MemoryItem, MemoryCategory
- [ ] Create `src/memory/schema.ts` — SQLite schema creation with FTS5 and triggers
- [ ] Create `src/memory/store.ts` — Repository CRUD operations
- [ ] Create `src/memory/embed.ts` — Embedding provider routing through model router
- [ ] Create `src/memory/workflow.ts` — Generic DAG workflow executor
- [ ] **Fix**: Call `registerMemo()` in gateway startup (`server-startup.ts`)
- [ ] **Fix**: Update Memo to create Resources instead of raw observations

### Phase 2: Extraction Pipeline (3-4 days)

**Goal**: LLM-driven fact extraction from conversations and tool outputs

- [ ] Create `src/memory/extract/prompts/` — Port all 6 memory type prompts from MemU
- [ ] Create `src/memory/extract/extract-items.ts` — LLM extraction per memory type
- [ ] Create `src/memory/extract/dedupe.ts` — Content hash dedup + reinforcement
- [ ] Create `src/memory/extract/categorize.ts` — Auto-assign to categories
- [ ] Create `src/memory/extract/pipeline.ts` — Orchestrate extraction workflow
- [ ] Wire extraction to Memo: trigger async extraction after resource creation
- [ ] Test: Send chat messages, verify items appear in database

### Phase 3: Retrieval (2-3 days)

**Goal**: Multi-tier search with salience scoring

- [ ] Create `src/memory/retrieve/vector-search.ts` — Cosine similarity on embeddings
- [ ] Create `src/memory/retrieve/keyword-search.ts` — FTS5 search
- [ ] Create `src/memory/retrieve/salience.ts` — Reinforcement + recency decay
- [ ] Create `src/memory/retrieve/search.ts` — Combined retrieval entry point
- [ ] Create `src/memory/retrieve/prompts/` — Sufficiency check and ranking prompts
- [ ] Optional: `src/memory/retrieve/reranker.ts` — LLM re-ranking for quality

### Phase 4: Categories (1-2 days)

**Goal**: Auto-organized topics with evolving summaries

- [ ] Create `src/memory/categories/manager.ts` — Category CRUD
- [ ] Create `src/memory/categories/prompts/summarize.ts` — Summary generation
- [ ] Wire: Update category summaries after new items are categorized
- [ ] Test: Verify categories auto-create and summaries evolve

### Phase 5: Agent Integration (2-3 days)

**Goal**: Agent tools and auto-injection

- [ ] Create/update `memory_recall` tool — searches MemU items + categories
- [ ] Create `memory_store` tool — manual fact storage
- [ ] Create `memory_categories` tool — list categories
- [ ] Create `memory_forget` tool — delete items
- [ ] Implement auto-injection: embed user message → retrieve top memories → prepend to system prompt
- [ ] Test end-to-end: conversation → extraction → retrieval → agent uses memory

### Phase 6: Journaling (1-2 days)

**Goal**: Agent actions during heartbeats/cron persist in memory

- [ ] Ensure heartbeat tool results create Resources
- [ ] Ensure cron job actions create Resources
- [ ] Ensure background task outputs create Resources
- [ ] Test: Run heartbeat with Moltyverse actions → verify memories persist → new session retrieves them

---

## Portability Assessment (from MemU Python → ArgentOS TypeScript)

| Component           | MemU LOC   | Portability | TS LOC Est. | Notes                            |
| ------------------- | ---------- | ----------- | ----------- | -------------------------------- |
| Data models         | ~200       | 95%         | ~150        | Pydantic → TypeScript interfaces |
| Workflow engine     | ~300       | 98%         | ~200        | Pure orchestration logic         |
| Extraction pipeline | ~1,330     | 85%         | ~800        | Prompts + XML parsing            |
| Retrieval system    | ~1,418     | 90%         | ~600        | Vector math + FTS5               |
| Salience scoring    | ~100       | 95%         | ~80         | Pure math                        |
| Category management | ~200       | 90%         | ~150        | LLM prompts + CRUD               |
| Prompt templates    | ~500       | 100%        | ~400        | Copy and adapt                   |
| **Total**           | **~4,048** | **~90%**    | **~2,380**  |                                  |

### What stays Python-specific (NOT ported)

- Video frame extraction (ffmpeg + PIL) — not needed for conversation memory
- Audio transcription — handled separately by speech pipeline
- Document preprocessing (PDF, DOCX) — future if needed
- SQLAlchemy ORM — use raw SQL or Drizzle

### What's pure TypeScript

- All core logic (extraction, retrieval, scoring, categorization)
- Prompt templates
- Embedding calls (OpenAI/Gemini APIs work identically from TS)
- SQLite operations (better-sqlite3 already in use)
- Cosine similarity (5 lines of math)
- Content hashing (crypto.createHash)

---

## Configuration

Add to `argent.json`:

```json
{
  "memory": {
    "enabled": true,
    "database": "sqlite",
    "databasePath": "~/.argentos/memory.db",

    "extraction": {
      "enabled": true,
      "async": true,
      "memoryTypes": ["profile", "event", "knowledge", "behavior", "skill", "tool"],
      "minConversationLength": 2,
      "extractionModel": "auto"
    },

    "retrieval": {
      "method": "rag",
      "autoInject": true,
      "autoInjectTopK": 5,
      "categoryTopK": 5,
      "itemTopK": 10,
      "scoring": "salience",
      "recencyDecayDays": 30,
      "sufficiencyCheck": true
    },

    "embedding": {
      "provider": "auto",
      "model": "text-embedding-3-small",
      "dimensions": 1536,
      "localFallback": "nomic-embed-text",
      "batchSize": 50
    },

    "categories": {
      "autoCreate": true,
      "summaryEnabled": true,
      "maxCategories": 100
    }
  }
}
```

---

## Testing Strategy

### Unit Tests

- `store.test.ts` — CRUD operations on all tables
- `salience.test.ts` — Reinforcement + decay math
- `dedupe.test.ts` — Content hash dedup logic
- `workflow.test.ts` — DAG execution order

### Integration Tests

- Extraction pipeline: mock LLM → verify items created
- Retrieval pipeline: seed items → search → verify ranking
- Category auto-creation: extract items → verify categories
- Auto-injection: seed memories → start agent → verify context

### End-to-End Tests

- Full conversation → extraction → retrieval → agent response
- Heartbeat actions → extraction → next session retrieval
- Reinforcement: retrieve item multiple times → verify count increases

---

## Migration Path

### From Memo (current) → MemU (new)

1. **Keep `observations.db`** for backwards compatibility
2. **New `memory.db`** for MemU data (resources, items, categories)
3. **One-time migration** (optional): scan existing observations → extract items
4. **Gradual cutover**: Memo creates Resources in new DB, extraction pipeline runs

### From SQLite → PostgreSQL (future)

1. Schema is already defined for both (see above)
2. Abstract store behind interface: `MemoryStore`
3. Implement `SQLiteMemoryStore` (Phase 1) and `PostgresMemoryStore` (Phase 2)
4. Config switch: `"database": "sqlite"` → `"database": "postgres"`

---

## Open Questions

1. **Embedding dimensions**: 768 (local) vs 1536 (OpenAI small) vs 3072 (OpenAI large) — do we normalize or support mixed?
   - **Recommendation**: Standardize on 1536 (OpenAI small). Re-embed local items when switching providers.

2. **Extraction frequency**: Every message? Every N messages? End of session?
   - **Recommendation**: End of each agent run (lifecycle "end" event). Batch is more efficient than per-message.

3. **Category limits**: How many categories before they become noise?
   - **Recommendation**: Cap at 100. Merge similar categories periodically (LLM-driven).

4. **Multi-agent memory**: Should agents share a memory DB or have isolated stores?
   - **Recommendation**: Phase 1 = shared (one ArgentOS instance = one memory). Phase 2 = scoped by agent ID.

5. **Memory pruning**: When/how to remove stale items?
   - **Recommendation**: Items with `reinforcement_count = 1` and `created_at > 90 days` are candidates for archival, not deletion. Never auto-delete.

---

## References

- **MemU source**: `/Users/sem/code/memu-reference/`
- **MemU docs**: https://github.com/NevaMind-AI/MemU
- **Current Memo**: `src/memory/memo.ts`, `src/memory/memo-schema.ts`
- **Current Memory Search**: `src/memory/manager.ts`, `src/memory/manager-search.ts`
- **ArgentOS Architecture**: `ARGENT_ARCHITECTURE.md`
- **Memory Config Docs**: `docs/concepts/memory.md`
