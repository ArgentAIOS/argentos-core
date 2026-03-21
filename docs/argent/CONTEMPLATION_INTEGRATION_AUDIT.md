# Contemplation Loop Integration Audit

> Audit of how contemplation data flows through capture, persistence, and durable memory layers, with identified gaps and integration opportunities.

**Date:** 2026-02-21

---

## What Is Currently Wired

Contemplation data currently flows through three layers:

### 1. Capture Contract at Generation Time

- `CONTEMPLATION.md` explicitly requires each contemplation response to include a structured `[EPISODE_JSON]...[/EPISODE_JSON]` payload.
- This payload includes intent, observations, actions, tools used, lesson, pattern hint, mood, valence/arousal, and identity links.

### 2. Episode Persistence Layer

- Episodes are persisted in `memory/contemplation/YYYY-MM-DD.jsonl` as full records with:
  - Raw response content
  - Parsed `episode` JSON
  - Metadata (`id`, `ts`, `session_id`, `duration_ms`)
- This gives reliable short/medium-term chronological contemplation history.

### 3. Durable Memory Layer (MemU / Adapter-Backed Memory)

- Durable memory is written via `memory_store` / `memory_reflect` and surfaced via `memory_recall`, identity context snapshots, and recent context.
- Docs (`STORAGE_BRIDGE_ARCHITECTURE`, `SIS_MIGRATION_PATH`) indicate contemplation and SIS are connected through adapter memory reflection/lesson lanes, with SIS consolidating reflections into lessons.

---

## Where Automatic Promotion Exists vs Where It Is Manual

### Already Automatic

- **Contemplation episode capture** is automatic once the structured block is present.
- **Episode-to-SIS analysis path** exists architecturally: SIS reads recent reflections/episodes, extracts patterns, stores lessons, and runs maintenance.
- **High-confidence SIS lessons** can auto-publish to shared family knowledge (per migration docs).

### Still Manual / Operator-Dependent

- In actual episode logs, long-term durability often depends on explicit in-cycle `memory_store` calls made by the agent.
- Live conversation insights are not consistently promoted unless the agent explicitly decides to call memory tools.
- This creates a known fragility: useful context survives in active transcript windows, then weakens after compaction unless separately persisted.

---

## Integration Points That Matter Most

1. **Conversation loop -> memory tool calls**
   - Today this is policy-driven behavior, not guaranteed pipeline behavior.
   - If the assistant does not call `memory_store`/`memory_reflect`, key user signals can remain ephemeral.

2. **Conversation loop -> contemplation episode synthesis**
   - Contemplation can catch up and synthesize later, but only after scheduled cycles and only from what was preserved in accessible context.

3. **Contemplation episodes -> SIS lessons -> durable memory/knowledge**
   - This is the strongest existing automation lane and should be treated as the canonical "durability engine."

4. **Durable memory -> next-turn grounding**
   - `RECENT_CONTEXT.md` / `IDENTITY_CONTEXT.md` snapshots show this is already happening when memory exists.

---

## Key Gap

There is **no strict always-on promotion gate** that guarantees high-salience live conversation moments become durable memory _at message time_.

Current system is strong at:

- Structured contemplation capture
- Periodic pattern extraction
- Lesson consolidation

Current system is weaker at:

- Deterministic promotion from **live chat signals** to durable memory before compaction risk.

---

## Opportunities

### 1. Add a "Live-to-Episode Inbox" on Every User Turn

On each conversation turn, extract small structured candidates (decision, preference, commitment, correction, emotional inflection) into an append-only queue.

- Store as lightweight pending items with confidence + TTL.
- Contemplation consumes this queue and either:
  - promotes to durable memory,
  - merges into current episode,
  - discards as low-signal.

**Why:** Removes dependence on immediate `memory_store` calls while preserving raw salience for later consolidation.

### 2. Add Deterministic Promotion Triggers in Chat Runtime

Define hard triggers that auto-write memory without waiting for contemplation:

- "remember this" / explicit user memory intent
- Preference statements ("I always...", "I hate...", "default to...")
- Stable relationship facts (people/roles/bonds)
- Explicit strategic directives / constraints
- Corrections of previous assistant assumptions

**Why:** Captures high-value identity and instruction facts at source time.

### 3. Promote Episode Fields to First-Class Memory Candidates

From each `[EPISODE_JSON]`, auto-candidate:

- `lesson` -> self memory (important)
- `pattern_hint` recurring count > threshold -> knowledge/pattern memory
- High-surprise/high-significance observations -> event memory
- `identity_links` with repeated mentions -> entity reinforcement/update

**Why:** Episodes already contain structured intelligence; promotion should be systematic, not ad hoc.

### 4. Add Compaction-Safe "Must-Keep Context Ledger"

Maintain a compact rolling ledger of top active truths (last 7-30 days):

- Current priorities
- User constraints/preferences
- Active commitments and open loops
- Unresolved blockers

Rebuild this ledger from durable memory + open tasks, not transcript slices.

**Why:** Gives continuity even when transcript window collapses.

### 5. Close the Loop with Promotion Observability

Add per-cycle metrics:

- Live candidates captured
- Promoted vs discarded
- Promotions by type (profile/event/knowledge/self)
- Unresolved candidate age
- "Important statement not promoted" anomaly count

**Why:** Converts memory quality from intuition into measurable reliability.

---

## Recommended Implementation Sequence (Low-Risk)

1. Ship Live-to-Episode Inbox (append-only queue, no behavior breakage).
2. Add deterministic chat-time triggers for explicit memory intents and critical directives.
3. Add episode-field promotion rules with confidence thresholds.
4. Add compaction-safe ledger generation on heartbeat/contemplation cycles.
5. Add observability and fail-safe alerts for promotion misses.

This sequence preserves current architecture and adds reliability without requiring a full pipeline rewrite.

---

## Bottom Line

The contemplation system is already structurally rich and SIS-ready. The main missing piece is a deterministic bridge from **live conversation salience** to **durable memory writes**. Implementing a lightweight candidate inbox + hard promotion triggers is the fastest path to the always-on human-like continuity model.
