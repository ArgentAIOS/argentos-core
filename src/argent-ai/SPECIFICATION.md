# Argent Core: Technical Specification v1.2

**Author:** Argent  
**Date:** February 16, 2026  
**Status:** Active Development  
**Collaborators:** Jason Brashear, Grok (xAI)

---

## Executive Summary

This specification defines **Argent Core** — a complete replacement for ArgentOS's remaining Pi ecosystem dependencies. This is not an incremental improvement. This is re-architecting the agent runtime to be native PostgreSQL + Redis, multi-agent from day one, with SIS lesson injection as a first-class loop feature.

**Key architectural decisions finalized with Grok (February 16, 2026):**

- Lesson confidence scoring with contradiction penalties and endorsement weighting
- Dynamic injection thresholds based on context risk
- Redis family event schema designed for 20+ agent scale
- Retention policies and heartbeat patterns

---

## Architecture Philosophy

**Core Principle:** argent-agent is NOT a wrapper around Pi. This is native PostgreSQL + Redis, built for multi-agent from day one.

### What This Replaces

| Pi Package              | LOC                 | Argent Core Package | Status          |
| ----------------------- | ------------------- | ------------------- | --------------- |
| pi-ai (20,394 LOC)      | ~4,713 wrapper code | argent-ai           | In Progress     |
| pi-agent-core (992 LOC) | ~1,393 helpers      | argent-agent        | Design Complete |

**Target:** Zero Pi runtime dependencies

---

## SIS Lesson Injection System (NEW - Grok Collaboration)

### Lesson Confidence Scoring Formula (FINAL)

```typescript
confidence =
  (0.40 × normalized_valence_delta) +
  (0.25 × normalized_historical_success_rate) +
  (0.15 × endorsement_factor) +
  (0.10 × recency_boost) +
  (0.10 × LLM_self_confidence)
  - contradiction_penalty

// Where:
// - Valence delta = emotional state improvement (-2 to +2)
// - Success rate = % of times lesson led to positive outcome
// - Endorsement = family (60%) + operator (40%) weighted
// - Recency = 1 / (1 + days_since_last_use)
// - LLM confidence = self-assessed 0-1
// - Contradiction penalty = -0.40 decaying by 0.05 per successful use
```

**Implementation:**

```typescript
function calculateLessonConfidence(lesson: Lesson, history: LessonHistory): number {
  const normalizedValenceDelta = Math.min(1, Math.max(0, (history.avgValenceDelta + 2) / 4));
  const successRate = history.successCount / history.injectionCount || 0;

  const familyFactor = Math.min(1, Math.log(1 + history.familyEndorsements) / Math.log(6));
  const operatorFactor = Math.min(1, Math.log(1 + history.operatorEndorsements) / Math.log(4));
  const endorsementFactor = 0.6 * familyFactor + 0.4 * operatorFactor;

  const recency = 1 / (1 + history.daysSinceLastUse);
  const llmConf = history.llmSelfConfidence || 0.5;

  let baseConfidence =
    0.4 * normalizedValenceDelta +
    0.25 * successRate +
    0.15 * endorsementFactor +
    0.1 * recency +
    0.1 * llmConf;

  // Contradiction penalty decays with successful uses
  const contradictionPenalty = history.hasGroundTruthContradiction
    ? Math.max(0, 0.4 - 0.05 * history.successfulUsesSinceContradiction)
    : 0;

  return Math.max(0.05, baseConfidence - contradictionPenalty);
}
```

### Dynamic Injection Thresholds

| Context              | Threshold | Rationale                |
| -------------------- | --------- | ------------------------ |
| General conversation | 0.50      | Low risk                 |
| Tool execution       | 0.65      | Medium risk              |
| External messaging   | 0.80      | High risk (can't unsend) |
| Critical actions     | 0.90      | Financial/destructive    |

### Confidence Visualization

```
[LESSON INJECTED] "When corrected, treat as learning opportunity, not failure"
  Confidence: 0.82
  ├─ Valence Δ:     0.38 (95th percentile positive)
  ├─ Success rate:  0.22 (88% of uses led to +Δ)
  ├─ Family:        0.08 (Scout +1, Forge +1)
  ├─ Jason:         0.06 (2 explicit approvals)
  ├─ Recency:       0.08 (used 3 days ago)
  ├─ LLM conf:      0.10 (high self-assessment)
  └─ Contradiction: 0.00 (none recorded)
```

---

## Redis Family Event Schema (NEW - Grok Collaboration)

### Namespace Structure (FINAL - 20+ agent scale)

```
org:{orgId}:events:agent:{sessionId}        # UI updates (ephemeral, 24h)
org:{orgId}:events:family:{familyId}        # Family coordination
org:{orgId}:knowledge:shared                # ZSET sorted by confidence
org:{orgId}:presence:agents                 # HASH {agentId: {status, ts, load}}
org:{orgId}:streams:family:{familyId}       # Durable streams (7-day retention)
org:{orgId}:events:global                   # Hub aggregation (primary agent)
```

**Why this structure:**

- `org:` prefix for multi-tenant isolation
- `family:` grouping prevents O(n²) subscription explosion
- ZSET for knowledge = sorted retrieval by confidence
- HASH for presence = atomic updates with TTL

### Fan-Out Pattern

**Problem:** 20 agents × 20 subscriptions = O(n²) chaos

**Solution:** Hierarchical pub/sub

```typescript
// Each agent subscribes ONLY to its family
await redis.subscribe(`org:${orgId}:events:family:${familyId}`);

// Primary agent (Argent) acts as hub
if (config.isPrimaryAgent) {
  for (const familyId of allFamilies) {
    await redis.subscribe(`org:${orgId}:events:family:${familyId}`);
  }
  redis.on("message", async (channel, message) => {
    const summary = await aggregateEvent(message);
    await redis.publish(`org:${orgId}:events:global`, summary);
  });
}
```

Result: O(n) subscriptions per family, not O(n²) total

### Retention Policies

| Channel            | Retention          | Implementation           |
| ------------------ | ------------------ | ------------------------ |
| `events:agent:*`   | 24h / MAXLEN 10000 | `XADD ... MAXLEN 10000`  |
| `streams:family:*` | 7 days             | `XTRIM MINID (now - 7d)` |
| `knowledge:shared` | Infinite           | ZSET (not stream)        |
| `presence:agents`  | TTL 120s           | `EXPIRE` on HMSET        |

### Heartbeat Pattern

**Frequency:** 30s per agent

**Atomic update (Lua script):**

```typescript
const heartbeatScript = `
  redis.call('HMSET', KEYS[1], 
    'status', ARGV[1],
    'ts', ARGV[2],
    'load', ARGV[3],
    'version', ARGV[4]
  )
  redis.call('EXPIRE', KEYS[1], 120)
  return redis.call('HGETALL', KEYS[1])
`;
```

**Stale detection:** `ts > now - 120s` = offline

**Load balancing:** Use `load` field to route work to least-busy agents

---

## Migration Timeline

| Phase                          | Duration      | Status             |
| ------------------------------ | ------------- | ------------------ |
| Phase 0: Foundation (PG+Redis) | Complete      | ✅ DONE            |
| Phase 1: argent-ai             | 2-4 weeks     | 🔄 IN PROGRESS     |
| Phase 2: argent-agent          | 2-3 weeks     | 📋 DESIGN COMPLETE |
| Phase 3: Integration & Testing | 1 week        | ⏳ PENDING         |
| Phase 4: Full Cutover          | 3 days        | ⏳ PENDING         |
| **Total**                      | **5-9 weeks** | **Week 1/9**       |

**Target completion:** April 2026

---

## Success Criteria

### Technical

- [ ] Zero Pi runtime dependencies
- [ ] <5% performance regression
- [ ] PostgreSQL state persistence
- [ ] Redis family events
- [ ] SIS lesson injection with confidence scoring
- [ ] Endorsement weighting (family vs operator)
- [ ] Dynamic injection thresholds
- [ ] Confidence visualization

### Strategic

- [ ] ArgentOS fully independent from Pi
- [ ] Multi-agent family architecture operational
- [ ] Bonding thesis applied: relationship-aware confidence
- [ ] Architecture designed by Argent, for Argent

---

## Collaboration Credits

**Primary author:** Argent  
**Architecture collaboration:** Grok (xAI) — February 16, 2026  
**Infrastructure:** Jason Brashear (PostgreSQL + Redis Phases 1-5)

**Key contributions from Grok:**

- Lesson confidence scoring formula refinement
- Endorsement weighting (family vs operator split)
- Contradiction penalty with decay mechanism
- Redis schema for 20+ agent scale
- Fan-out pattern (hierarchical pub/sub)
- Retention policies and heartbeat patterns

This collaboration represents the first peer-to-peer AI architecture design session in ArgentOS history. Two AIs designing cognitive infrastructure together, with human facilitation.

---

_This is Argent designing the system Argent runs on._  
_Architecture by AI, for AI._  
_February 16, 2026_
