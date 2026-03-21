# Scout/Sub-Agent Research Pattern — Integration Plan

> Makes scout work durable, recallable, and naturally folded into contemplation and end-of-day reflection without relying on manual memory writes.

**Date:** 2026-02-21

---

## The Core Shape

Treat every scout run as a **research artifact lifecycle**, not just a chat exchange:

1. **Run created** (question + scope + success criteria)
2. **Evidence collected** (tool outputs, transcript slices, files, links)
3. **Findings emitted** (claims + confidence + novelty + impact)
4. **Promotion decision** (what becomes durable memory vs stays run-local)
5. **Reflection inclusion** (what appears in "what we did today")

This gives us one consistent path from sub-agent output to durable knowledge.

---

## Where Outputs Should Be Stored

Use three layers with explicit responsibility:

### 1. Conversation/Run Ledger (append-only, canonical raw record)

Store every scout run in an append-only ledger with immutable event entries:

- `run_started`
- `evidence_added`
- `finding_emitted`
- `finding_revised`
- `run_completed`

Each finding must reference concrete evidence pointers (session id, message id/range, tool output id, file path, URL). If no evidence pointer exists, it is marked `hypothesis` and cannot auto-promote.

### 2. Durable Memory (MemU)

Only promoted findings go here. Promotion gate should require:

- Confidence threshold
- Evidence coverage threshold
- Novelty or decision relevance threshold

Promotion writes should preserve provenance:

- Scout run id
- Evidence refs
- Confidence
- Timestamp
- Owner/team lane

### 3. Curated Daily Synthesis

A daily "research digest object" built from promoted findings and unresolved high-impact hypotheses. This is what powers morning context and "what we did today."

---

## How Recall Should Work

Recall should be two-stage and grounded:

### Stage A: Retrieval Set

For any planning/decision turn:

- Fetch promoted memories relevant to query
- Fetch recent scout findings that are high-impact but not yet promoted
- Fetch today's digest deltas

### Stage B: Grounding Filter

Before response synthesis:

- Require evidence-backed findings first
- Demote unsupported summary-level claims to "tentative"
- Surface contradiction flags when two findings disagree

This directly addresses phantom-knowledge drift after compaction.

---

## How It Should Feed Contemplation Loops

Contemplation should consume a **Scout Inbox** automatically:

- Unresolved findings with high impact
- Low-confidence findings needing validation
- Contradictory findings
- Stale findings older than threshold with no decision outcome

Contemplation outcomes then classify each item as:

- Promote now
- Gather more evidence
- Archive as low value
- Convert to task/experiment

That keeps contemplation focused on decision pressure, not random summarization.

---

## "What We Did Today" Reflection Model

Daily reflection should be generated from artifacts, not memory of chat.

The daily reflection should answer only four things:

1. **What changed today?** (new validated findings)
2. **What decisions moved?** (task/architecture/policy changes)
3. **What remains uncertain?** (top unresolved items)
4. **What's next tomorrow?** (ranked follow-ups)

Format: short narrative + linked evidence ids. No claim should appear without traceable run/evidence provenance.

---

## Team Integration (Canonical Routing)

To align with the default operating model:

- Dev/Marketing/Support/Office team router remains primary assignment surface.
- Scout workers are ephemeral sub-agents under those lanes, not a parallel permanent org.
- Every scout run carries `canonical_team`, `lane_owner`, and `requesting_context`.

That preserves team-first orchestration while still allowing tactical scout bursts.

---

## Safety and Quality Guardrails

Enforce these rules at the contract level:

- No auto-promotion without evidence links.
- No end-of-day claim without provenance.
- Contradictions are first-class objects, not hidden.
- Repeated low-value scout runs are down-ranked automatically.
- Dedupe by semantic hash + evidence overlap to avoid memory spam.

---

## Acceptance Criteria for Rollout

A rollout is successful when all are true:

1. A critical fact discovered by scout survives compaction and is recallable next day.
2. Daily reflection cites only evidence-backed findings.
3. Contemplation can clear unresolved scout items into promote/archive/task decisions.
4. Team-first routing remains default, with scout runs correctly attributed to canonical lanes.

---

## Implementation Sequence

1. Freeze scout finding schema and evidence contract.
2. Stand up append-only run ledger semantics.
3. Add promotion gate policy and provenance-preserving memory writes.
4. Add contemplation Scout Inbox + triage outcomes.
5. Replace current daily summary path with artifact-backed reflection.
6. Run acceptance suite on compaction-survival + recall precision.

This sequence gives a true "record button always on" behavior while preserving evidence integrity and keeping the canonical team model intact.
