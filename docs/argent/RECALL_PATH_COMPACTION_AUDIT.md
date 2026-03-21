# Recall Path After Compaction Audit

> Audit of how recall works after session compaction, what is auto-injected vs manually recalled, and where facts disappear.

**Date:** 2026-02-21

---

## Current Recall Path (As Implemented)

### 1. Run Bootstrap/Context Assembly (Every Turn)

- ArgentOS rebuilds a system prompt each run.
- Injects workspace bootstrap files (`AGENTS.md`, `SOUL.md`, `TOOLS.md`, `IDENTITY.md`, `USER.md`, `HEARTBEAT.md`, first-run `BOOTSTRAP.md`) under Project Context.
- Injection is per-file capped by `bootstrapMaxChars` (default 20k chars), so oversized files are truncated.

### 2. Session History Layer

- Active context includes transcript history for the session key.
- Tool results and attachments enter context and contribute token pressure.

### 3. Compaction Layer (Persistent)

- On overflow or threshold pressure, older transcript segments are summarized into a persisted `compaction` entry; recent messages are retained.
- Future turns consume the compaction summary + post-compaction recent messages.

### 4. Pre-Compaction Memory Flush (Best-Effort)

- Before hard compaction threshold, a silent flush can run (`NO_REPLY`) instructing the agent to write durable memory to disk.
- One flush per cycle; skipped in read-only workspaces and CLI-backend paths.

### 5. Memory Retrieval Layer (Non-Automatic for Semantic Recall)

- Durable semantic retrieval depends on explicit memory tool usage (`memory_recall` / memory search family).
- There is no hard, mandatory "retrieve-before-answer" gate after compaction.

---

## What Gets Recalled Automatically vs Manually

### Automatic

- System prompt scaffolding and runtime metadata.
- Injected bootstrap/workspace files (subject to truncation).
- Compaction summaries persisted in transcript.
- Recent post-compaction conversation history.
- Best-effort pre-compaction memory flush prompt (if conditions allow).

### Manual / Agent-Initiated

- Semantic long-term fact retrieval via memory tools (`memory_recall`, memory search).
- Any explicit reconstruction of lost detail from memory store.
- Cross-session fact validation when summary confidence is uncertain.

---

## Architecture Gap List (With Severity)

### 1. Lossy Compaction Without Deterministic Fact Preservation — CRITICAL

Compaction is summary-first and inherently lossy. If a fact is not captured in summary and also not durably written to memory beforehand, it is effectively gone from active context.

### 2. Pre-Compaction Memory Flush Is Best-Effort, Not Guaranteed — HIGH

The flush can be skipped (read-only workspace, non-embedded/CLI paths, cycle conditions), so the system has no hard guarantee that key facts are persisted before compression.

### 3. No Mandatory Semantic-Recall Gate After Compaction — HIGH

Post-compaction turns can proceed without forced memory retrieval. Recall quality depends on agent initiative/prompting rather than architecture guarantees.

### 4. Bootstrap/Context Truncation Drops Potentially Critical Instructions/Facts — HIGH

Injected files are char-capped. Important context near file tails can be silently excluded, causing apparent "forgetting" unrelated to user behavior.

### 5. Split Memory Surfaces Create Coherence Drift — HIGH

Session transcript summaries, workspace markdown memory, and semantic memory retrieval can diverge. Without reconciliation, one surface may claim facts another cannot substantiate.

### 6. Subagent Minimal Prompt Mode Reduces Memory-Oriented Guidance — MEDIUM

Subagents run with slimmer prompt sections; this lowers automatic guidance pressure for deliberate memory retrieval and increases omission risk in delegated work.

### 7. Session Pruning + Compaction Interaction Can Hide Provenance — MEDIUM

Even when pruning is transient, it reduces visible tool-result evidence in run context. Combined with compaction, this weakens traceability for how a fact entered memory.

### 8. No Confidence/Provenance Contract for Recalled Facts — MEDIUM

The system lacks an enforced requirement that recalled assertions be tagged as transcript-summary-derived vs memory-store-verified, enabling "phantom certainty."

---

## Why Facts Disappear (Root-Cause Chain)

A fact disappears when **all** of these happen:

1. It lives only in transient conversation/tool output.
2. Compaction summarizes away the specific detail.
3. Pre-compaction flush does not durably persist it.
4. No explicit `memory_recall` path is executed later.

---

## Bottom Line

Current behavior is **summary-preserving**, not **fact-preserving**. The architecture optimizes token survival, but recall durability still depends on best-effort flushes and manual retrieval behavior.
