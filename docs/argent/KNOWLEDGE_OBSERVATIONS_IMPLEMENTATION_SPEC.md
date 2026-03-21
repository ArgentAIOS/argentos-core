# Knowledge Observations Implementation Spec

**Date:** 2026-03-17  
**Status:** Proposed implementation spec  
**Scope:** Additive only. This spec is written against the current ArgentOS tree on `codex/core-business-boundary-audit` and does not require a branch switch.

## 1. Problem

ArgentOS currently has four adjacent but distinct memory substrates:

- raw durable facts in `memory_items`
- interpreted periodic summaries in `reflections`
- actionable compressions in `lessons`
- entity-level synthesized text in `entities.profileSummary`

What is missing is a first-class place for "current believed truth" with:

- explicit evidence links
- contradiction tracking
- revision/supersession chains
- freshness and revalidation semantics
- deterministic retrieval precedence over mixed raw substrates

Today, retrieval repeatedly infers truth from raw facts, lessons, reflections, and entity summaries at answer time. That is expensive, noisy, and hard to audit.

## 2. Goal

Add a new governed synthesis layer named `knowledge_observations` that stores current believed truth derived from raw substrates, while preserving source evidence and revision history.

The system should be able to answer:

- what it currently believes
- why it believes it
- what evidence supports or contradicts that belief
- which prior belief was superseded

## 3. Non-Goals

- Do not replace the existing `observations` table. That table remains session-event capture from Memo.
- Do not let agents manually author observations as a normal memory tool path.
- Do not derive new observations from old observations, except for `supersedes_observation_id`.
- Do not turn observations into a generic note-taking or scrapbook layer.
- Do not require PG cutover to be complete before the spec can be implemented incrementally.

## 4. Existing System Surfaces To Preserve

These existing substrates remain the source of truth for different layers:

- `src/data/pg/schema.ts`
  - `memory_items`
  - `entities`
  - `reflections`
  - `lessons`
  - legacy `observations`
- `src/data/adapter.ts`
  - `MemoryAdapter` is the seam to extend
- `src/data/pg-adapter.ts`
  - primary implementation target
- `src/data/sqlite-adapter.ts`
  - must remain safe under sqlite/dual mode
- `src/data/dual-adapter.ts`
  - must mirror adapter semantics cleanly
- `src/data/pg-write-mirror.ts`
  - must not double-enqueue consolidation work
- `src/memory/extract/pipeline.ts`
  - primary raw-fact creation path
- `src/infra/sis-runner.ts`
  - lesson/reflection synthesis path
- `src/agents/tools/memu-tools.ts`
  - `memory_recall` integration point
- `src/agents/tools/memory-timeline-tool.ts`
  - timeline integration point
- `src/agents/system-prompt.ts`
  - scoped runtime injection path

## 5. Terminology

To avoid confusion with the existing legacy table:

- `observations` means session-event capture from Memo
- `knowledge_observations` means the new synthesized truth layer

The new layer should use the full term `knowledge observation` in code, config, docs, and telemetry.

## 6. New Ontology

### 6.1 Observation Kinds

Start with a strict enum-like union:

- `operator_preference`
- `project_state`
- `world_fact`
- `self_model`
- `relationship_fact`
- `tooling_state`

These are intentionally not generic. Retrieval ranking, freshness rules, and revalidation cadence should differ by kind.

### 6.2 Subject Types

- `entity`
- `project`
- `tool`
- `agent`
- `global`

### 6.3 Status

- `active`
- `stale`
- `superseded`
- `invalidated`

### 6.4 Evidence Stance

- `support`
- `contradict`
- `context`

## 7. Hard Invariants

These are mandatory:

1. Knowledge observations may only derive from `memory_items`, `lessons`, `reflections`, and direct entity context.
2. Knowledge observations may not cite other knowledge observations as evidence.
3. The only permitted observation-to-observation relationship is `supersedes_observation_id`.
4. Material truth changes create a new row. Do not rewrite prior truth in place.
5. Contradiction evidence must be preserved.
6. Retrieval may surface observations first, but raw evidence must always remain reachable.
7. Generated answer text must never be ingested as evidence unless it resolves back to raw source IDs.
8. `canonical_key` generation must be deterministic and code-driven, not model-generated free text.

## 8. Proposed Schema

### 8.1 New Types In `src/memory/memu-types.ts`

Add:

- `KnowledgeObservationKind`
- `KnowledgeObservationSubjectType`
- `KnowledgeObservationStatus`
- `KnowledgeObservationEvidenceStance`
- `KnowledgeObservation`
- `KnowledgeObservationEvidence`
- `CreateKnowledgeObservationInput`
- `UpdateKnowledgeObservationInput`
- `KnowledgeObservationSearchOptions`
- `KnowledgeObservationSearchResult`
- `KnowledgeObservationConsolidationResult`

These should live alongside existing memory-layer types, not inside gateway-only code.

### 8.2 New PG Tables In `src/data/pg/schema.ts`

Add `knowledgeObservations`:

- `id: text primary key`
- `agentId: text not null references agents.id`
- `kind: text not null`
- `subjectType: text not null`
- `subjectId: text null`
- `canonicalKey: text not null`
- `summary: text not null`
- `detail: text null`
- `confidence: real not null default 0.5`
- `confidenceComponents: jsonb default '{}'`
- `freshness: real not null default 1.0`
- `revalidationDueAt: timestamptz null`
- `supportCount: integer not null default 0`
- `sourceDiversity: integer not null default 0`
- `contradictionWeight: real not null default 0`
- `operatorConfirmed: boolean not null default false`
- `status: text not null default 'active'`
- `firstSupportedAt: timestamptz null`
- `lastSupportedAt: timestamptz null`
- `lastContradictedAt: timestamptz null`
- `supersedesObservationId: text null references knowledge_observations.id`
- `embedding: vector(768) null`
- `tags: jsonb default '[]'`
- `metadata: jsonb default '{}'`
- `visibility: text not null default 'private'`
- `createdAt: timestamptz not null`
- `updatedAt: timestamptz not null`

Add `knowledgeObservationEvidence`:

- `id: text primary key`
- `observationId: text not null references knowledge_observations.id on delete cascade`
- `stance: text not null`
- `weight: real not null default 1.0`
- `excerpt: text null`
- `itemId: text null references memory_items.id on delete set null`
- `lessonId: text null references lessons.id on delete set null`
- `reflectionId: text null references reflections.id on delete set null`
- `entityId: text null references entities.id on delete set null`
- `sourceCreatedAt: timestamptz null`
- `metadata: jsonb default '{}'`
- `createdAt: timestamptz not null`

### 8.3 Required Indexes

In `src/data/pg/migrations/0004_knowledge_observations.sql`:

- index on `(agent_id, kind, status)`
- index on `(agent_id, subject_type, subject_id, status)`
- index on `(agent_id, canonical_key)`
- index on `(agent_id, revalidation_due_at)`
- index on `(agent_id, last_supported_at)`
- index on `(agent_id, confidence desc, freshness desc)`
- HNSW index on `embedding`
- GIN FTS index over `summary || detail || tags`
- partial unique index:
  - `UNIQUE (agent_id, canonical_key) WHERE status = 'active'`

This partial unique index is what prevents duplicate competing active truths for the same canonical key.

## 9. Canonical Key Design

Canonical keys must be generated by code, not LLM output.

Add a new module family:

- `src/memory/observations/canonical-key.ts`
- `src/memory/observations/canonical-key.test.ts`

### 9.1 Key Rules

- lowercase only
- normalized separators
- ID-backed where possible
- explicit ontology slot in the key
- stable ordering for multi-part scopes

### 9.2 Initial Shapes

- `entity:<entityId>:operator_preference:<slot>`
- `entity:<entityId>:relationship_fact:<slot>`
- `project:<projectSlug>:project_state:<slot>`
- `tool:<toolName>:tooling_state:<slot>`
- `agent:self:self_model:<slot>`
- `global:world_fact:<slot>`

### 9.3 Slot Examples

- `response_style`
- `decision_preference`
- `delivery_preference`
- `status`
- `risk`
- `failure_mode`
- `best_path`
- `verification_pattern`

No free-form model-authored slot names in phase 1. Slot taxonomy should be a finite code-owned mapping.

## 10. Confidence Model

Confidence must be anatomical, not a vibe score.

Add:

- `src/memory/observations/confidence.ts`
- `src/memory/observations/confidence.test.ts`

Persist:

- `confidence`
- `confidenceComponents`

### 10.1 Required Components

- `sourceCount`
- `sourceDiversity`
- `supportWeight`
- `contradictionWeight`
- `recencyWeight`
- `operatorConfirmedBoost`

### 10.2 Initial Formula

The exact coefficients can be tuned, but phase 1 should use a deterministic composable function:

- start from a conservative base
- increase with source count using diminishing returns
- increase with source diversity
- increase with operator-confirmed evidence
- decrease with contradiction weight
- decrease when evidence is old
- clamp to `[0,1]`

The stored JSON anatomy should make the score explainable in governance tooling later.

## 11. Freshness And Revalidation

Add:

- `src/memory/observations/revalidation.ts`
- `src/memory/observations/revalidation.test.ts`

### 11.1 Freshness

Freshness is distinct from confidence.

- confidence asks "how well supported is this belief?"
- freshness asks "how current is this belief?"

### 11.2 Required Fields

- `freshness`
- `revalidationDueAt`
- `lastSupportedAt`
- `lastContradictedAt`

### 11.3 By-Kind Defaults

Initial defaults:

- `operator_preference`: revalidate every 45 days
- `project_state`: revalidate every 3 days
- `world_fact`: revalidate every 14 days
- `self_model`: revalidate every 21 days
- `relationship_fact`: revalidate every 30 days
- `tooling_state`: revalidate every 7 days

These live in config, with code defaults.

## 12. Adapter Changes

### 12.1 `src/data/adapter.ts`

Extend `MemoryAdapter` with mandatory methods so call sites stay simple:

- `getKnowledgeObservation(id: string): Promise<KnowledgeObservation | null>`
- `listKnowledgeObservations(filter?: {...}): Promise<KnowledgeObservation[]>`
- `searchKnowledgeObservations(query: string, options?: KnowledgeObservationSearchOptions): Promise<KnowledgeObservationSearchResult[]>`
- `getKnowledgeObservationEvidence(observationId: string): Promise<KnowledgeObservationEvidence[]>`
- `upsertKnowledgeObservation(input: CreateKnowledgeObservationInput): Promise<KnowledgeObservation>`
- `supersedeKnowledgeObservation(params: {...}): Promise<KnowledgeObservation>`
- `markKnowledgeObservationStale(id: string): Promise<void>`
- `invalidateKnowledgeObservation(id: string, reason?: string): Promise<void>`

### 12.2 `src/data/pg-adapter.ts`

Implement all methods in `PgMemoryAdapter`.

Notes:

- call `ensureRlsContext()` in observation search/read methods
- map rows to new memory types near existing `mapLesson` / `mapReflection` helpers
- keep writes small and explicit; do not hide supersession logic inside raw `update` calls

### 12.3 `src/data/sqlite-adapter.ts`

Phase 1 sqlite behavior should be safe and explicit:

- read methods return empty results / `null`
- write methods throw `Knowledge observations require PostgreSQL` only if called while feature is enabled

Do not attempt to implement full sqlite parity for this layer in phase 1.

### 12.4 `src/data/dual-adapter.ts`

Dual mode should:

- read from the configured reader
- mirror writes only when the feature is enabled
- prefer PG for truth-layer reads when `readFrom=postgres`

### 12.5 `src/data/pg-write-mirror.ts`

Do not add knowledge-observation writes here in phase 1.

Reason:

- this layer is synthesized, not raw durable capture
- mirroring raw writes is correct; mirroring second-order synthesis here would cause duplicate or timing-sensitive work

## 13. Consolidation Runner

Add a new module family:

- `src/memory/observations/consolidator.ts`
- `src/memory/observations/consolidator.test.ts`
- `src/memory/observations/index.ts`

### 13.1 Trigger Model

Use a hybrid trigger model:

1. event hints from durable writes
2. periodic sweep over recent changes

Do not hook consolidation directly into raw capture hooks in `src/memory/memo.ts`.

Instead:

- emit lightweight internal signals after `createItem`, `createLesson`, and `createReflection`
- have the consolidator debounce those signals by subject scope
- also run a periodic sweep over recently updated:
  - `memory_items`
  - `lessons`
  - `reflections`

This avoids missing updates on restart while staying responsive.

### 13.2 Startup Wiring

Register a new sidecar in `src/gateway/server-startup.ts`:

- `startKnowledgeObservationRunner(params.cfg)`

This should be independent from Memo hooks and SIS runner startup.

### 13.3 Consolidation Inputs

For a scoped candidate, gather:

- supporting `memory_items`
- contradictory `memory_items`
- relevant `lessons`
- relevant `reflections`
- linked entities

The consolidator should not consume prior observations as evidence.

### 13.4 Consolidation Decision

For each candidate scope:

1. derive deterministic `canonicalKey`
2. load active observation by `(agentId, canonicalKey, status='active')`
3. compute evidence anatomy
4. ask a cheap model for a structured proposal
5. decide:
   - create
   - reinforce/update
   - supersede
   - skip

### 13.5 Model Contract

Add prompt/contracts in:

- `src/memory/observations/prompts.ts`

The model may propose:

- `summary`
- `detail`
- `kind`
- `slot`
- evidence classification
- whether the new evidence materially changes prior truth

The model may not choose the canonical key format itself. The system computes that.

### 13.6 Supersession Behavior

If the new belief materially changes current truth:

- create new observation row
- set `supersedesObservationId` to the old row
- mark old row `superseded`
- preserve contradiction evidence on the new row

Do not mutate the old row into the new truth.

## 14. Retrieval Integration

### 14.1 `src/agents/tools/memu-tools.ts`

Modify `memory_recall` to use:

1. active knowledge observations first
2. evidence expansion second
3. raw memory fallback third
4. lessons/reflections only when interpretation is needed

This should be query-class aware:

- identity/preference queries -> `operator_preference`, `relationship_fact`
- project queries -> `project_state`
- tool behavior queries -> `tooling_state`
- self/behavior queries -> `self_model`

### 14.2 Observation Search Merge Strategy

Observation search should return:

- observation summary
- confidence
- freshness
- canonical key
- status
- top evidence IDs / excerpts

Raw-memory result formatting should remain reachable and auditable.

### 14.3 `src/agents/tools/memory-timeline-tool.ts`

Timeline should remain raw-fact first.

Use knowledge observations only as:

- a short summary header
- a "current state vs prior state" hint

Do not let the truth layer replace chronology.

### 14.4 `src/agents/system-prompt.ts`

Phase 2 change:

- stop injecting global top-5 lessons via `listLessons()`
- inject scoped observations + scoped lessons based on current tool/query/session context

This is a later rollout step, not required for phase 1 schema landing.

## 15. Config Changes

### 15.1 `src/config/types.memory.ts`

Add:

```ts
observations?: {
  enabled?: boolean;
  consolidation?: {
    enabled?: boolean;
    debounceMs?: number;
    interval?: string;
    maxScopesPerRun?: number;
  };
  retrieval?: {
    enabled?: boolean;
    maxResults?: number;
    minConfidence?: number;
    minFreshness?: number;
  };
  revalidation?: {
    enabled?: boolean;
    interval?: string;
    kindDays?: Partial<Record<KnowledgeObservationKind, number>>;
  };
};
```

### 15.2 `src/config/zod-schema.ts`

Add schema validation for the new block.

### 15.3 `src/config/schema.ts`

Add labels/help text for:

- `memory.observations.enabled`
- `memory.observations.consolidation.enabled`
- `memory.observations.consolidation.debounceMs`
- `memory.observations.consolidation.interval`
- `memory.observations.consolidation.maxScopesPerRun`
- `memory.observations.retrieval.enabled`
- `memory.observations.retrieval.maxResults`
- `memory.observations.retrieval.minConfidence`
- `memory.observations.retrieval.minFreshness`
- `memory.observations.revalidation.enabled`
- `memory.observations.revalidation.interval`

Default:

- feature off by default in phase 1
- PG-only activation

## 16. Rollout Plan

### Phase 1: Schema And Background Consolidation

Files:

- `src/memory/memu-types.ts`
- `src/data/pg/schema.ts`
- `src/data/pg/migrations/0004_knowledge_observations.sql`
- `src/data/adapter.ts`
- `src/data/pg-adapter.ts`
- `src/data/sqlite-adapter.ts`
- `src/data/dual-adapter.ts`
- `src/config/types.memory.ts`
- `src/config/zod-schema.ts`
- `src/config/schema.ts`
- new `src/memory/observations/*`
- `src/gateway/server-startup.ts`

Behavior:

- create/search knowledge observations
- run consolidator in background
- no prompt injection changes yet
- no user-facing recall precedence changes yet

### Phase 2: `memory_recall` Integration

Files:

- `src/agents/tools/memu-tools.ts`
- `src/agents/tools/memu-recall-quality.test.ts`
- `src/agents/tools/memu-recall-telemetry.test.ts`

Behavior:

- observation-first retrieval for supported query classes
- evidence expansion merged into output

### Phase 3: Runtime Injection

Files:

- `src/agents/system-prompt.ts`
- `src/agents/system-prompt.test.ts`
- optionally `src/infra/contemplation-runner.ts`

Behavior:

- scoped observation injection replaces global lesson-only injection

### Phase 4: Governance And UI

Out of scope for the first code landing, but expected later:

- operator inspection of confidence anatomy
- stale observation review
- supersession chains
- evidence browser

## 17. Test Plan

### 17.1 New Tests

- `src/memory/observations/canonical-key.test.ts`
  - deterministic keys
  - no duplicate active key drift
- `src/memory/observations/confidence.test.ts`
  - composable confidence anatomy
- `src/memory/observations/revalidation.test.ts`
  - per-kind scheduling
- `src/memory/observations/consolidator.test.ts`
  - create vs reinforce vs supersede
  - contradiction preservation
  - no observation-as-evidence feedback loop

### 17.2 Existing Test Neighborhoods To Extend

- `src/config/schema.test.ts`
  - new config keys
- `src/infra/sis-runner.test.ts`
  - observation hints from lesson/reflection writes
- `src/infra/contemplation-discovery.test.ts`
  - future observation-aware discovery behavior
- `src/agents/tools/memu-recall-quality.test.ts`
  - observation-first recall quality
- `src/agents/tools/memory-timeline-tool.test.ts`
  - summary header without chronology loss
- `src/agents/system-prompt.test.ts`
  - scoped observation injection

## 18. Acceptance Criteria

1. Argent can store an active belief with explicit supporting and contradictory evidence.
2. A materially changed belief creates a new row and supersedes the old one.
3. Active belief lookup by canonical key is deterministic and unique.
4. `memory_recall` can return current believed truth plus raw evidence.
5. No code path allows generated answer text to become observation evidence directly.
6. The system remains safe in sqlite and dual modes while the feature is disabled or unsupported.

## 19. Recommended First Implementation Slice

Implement this exact vertical slice first:

1. schema + migration
2. types + adapter methods
3. deterministic canonical key builder
4. confidence/revalidation helpers
5. PG adapter CRUD/search for knowledge observations
6. background consolidator over `operator_preference` and `tooling_state` only
7. no runtime injection changes yet
8. no UI work yet

This is the smallest slice that proves:

- governed truth storage
- revision chains
- evidence anatomy
- retrieval readiness

without touching the most volatile prompt and UI surfaces.

## 20. Explicit Risks

- canonical key drift will create competing truths
- over-broad kinds will collapse ontology and hurt ranking
- in-place mutation will erase auditability
- observation-to-observation derivation will create feedback loops
- prompt injection before retrieval hardening will make the feature look better than it is

For that reason, the implementation order in Section 19 should be followed strictly.
