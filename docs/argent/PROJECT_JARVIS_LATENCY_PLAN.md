# Project Jarvis: Sub-2-Second Conversational Latency

> **Goal**: Make talking to Argent feel like Tony Stark talking to Jarvis.
> Zero perceptible delay between speaking and getting a response.
>
> **Author**: Jason Brashear + Claude
> **Date**: 2026-03-09
> **Branch**: Implement on `codex/*` branch off current development head

---

## The Problem

Current measured latency: **~12 seconds** from message send to first streamed token.

Breakdown of where time goes (estimated from code analysis):

| Phase                        | Time          | What's Happening                                                          |
| ---------------------------- | ------------- | ------------------------------------------------------------------------- |
| Gateway ACK + dispatch       | ~50ms         | Parse message, create run, dispatch async                                 |
| Reply preparation            | ~200ms        | Config load, workspace check, session state, directives                   |
| Skill snapshot loading       | ~150ms        | Read skill `.md` files from disk                                          |
| **Queue wait (contention)**  | **0-3000ms**  | Background tasks (MemU, heartbeat, SIS, contemplation) blocking Main lane |
| **Tool instantiation**       | **300-500ms** | 83+ tool creators called, zero caching                                    |
| Model routing                | ~100ms        | Complexity scoring, profile chain walking                                 |
| Bootstrap context loading    | ~150ms        | Alignment docs, workspace files from disk                                 |
| Agent session setup          | ~200ms        | Session manager load, message history, sanitization                       |
| **Tool schema tokenization** | **implicit**  | 30-50 tool defs = 6K-15K tokens → slower inference                        |
| **LLM time to first token**  | **1-3s**      | Network + inference (irreducible, but token count affects it)             |
| Reply dispatch               | ~50ms         | Stream first chunk to client                                              |

**Controllable latency: ~1.2-4s** (everything except LLM inference)
**Target: <500ms** pre-LLM overhead → total ~1.5-3.5s including inference

---

## Three-Prong Attack

### Prong 1: Background Lane Separation

**Impact: Eliminates 0-3s queue contention**
**Status: COMPLETE** — All wiring in place (server-lanes.ts, reload handlers, all callers)

### Prong 2: Tool Caching

**Impact: Would eliminate 300-500ms tool rebuild per call**
**Status: DEFERRED** — Tools capture per-run closures (session key, abort signal, config).
Cannot cache the full tool array across runs. Tool construction cost is mostly object
allocation (~80 lightweight factory calls), not I/O. Real savings come from Prong 3.

### Prong 3: Tool Search (Deferred Loading)

**Impact: Reduces tool tokens 60-85%, faster inference**
**Status: PHASE 1-3 COMPLETE** — Registry, deferred split, and background subsystem core sets implemented.
Feature-gated behind `agents.defaults.toolSearch.enabled` (default: false).

- Phase 1: `ToolSearchRegistry` class with keyword search scoring ✓
- Phase 2: Core/deferred split in `pi-tools.ts`, session-persisted discovery ✓
- Phase 3: Background subsystem core sets (heartbeat: 6, SIS: 3, contemplation: 4, exec-worker: 12) ✓
- Phase 4: Metrics & tuning — NOT STARTED

Combined projected improvement: **3-6 seconds** off the current 12-second path.

---

## Prong 1: Background Lane Separation

### What Exists Today

- `CommandLane.Background` enum value — **DONE** (`src/process/lanes.ts:6`)
- `yieldsTo` / `resumesLanes` mechanism — **DONE** (`src/process/command-queue.ts:26-28, 58-64, 182-198`)
- `setLaneYieldsTo()` / `setLaneResumes()` exports — **DONE**

### What's Missing

Nobody calls these functions. Background callers still run on `CommandLane.Main`.

### Implementation (8 files, ~30 lines of changes)

#### Step 1.1: Wire Background lane at gateway startup

**File**: `src/gateway/server-lanes.ts`

```typescript
import {
  setCommandLaneConcurrency,
  setLaneYieldsTo,
  setLaneResumes,
} from "../process/command-queue.js";
import { CommandLane } from "../process/lanes.js";

// Add after existing Main/Cron/Subagent setup:
setCommandLaneConcurrency(CommandLane.Background, resolveBackgroundMaxConcurrent(cfg));
setLaneYieldsTo(CommandLane.Background, CommandLane.Main);
setLaneResumes(CommandLane.Main, [CommandLane.Background]);
```

**Behavior**: Background lane pauses whenever Main has any queued or active items.
When Main completes a task, it kicks Background to resume. Chat always goes first.

#### Step 1.2: Add `backgroundConcurrency` config

**File**: `src/config/types.agent-defaults.ts` — Add `backgroundConcurrency?: number`
**File**: `src/config/agent-limits.ts` — Add resolver (default: 1)
**File**: `src/config/load-profile.ts` — Add to presets (desktop: 2, laptop: 1)

#### Step 1.3: Route background callers to Background lane

**Direct callers** (add `lane: CommandLane.Background`):

| File                                  | Current Lane   | Change               |
| ------------------------------------- | -------------- | -------------------- |
| `src/memory/extract/extract-items.ts` | Main (default) | `lane: "background"` |
| `src/memory/categories/manager.ts`    | Main (default) | `lane: "background"` |
| `src/memory/identity/llm.ts`          | Main (default) | `lane: "background"` |
| `src/infra/contemplation-runner.ts`   | `"main"`       | `"background"`       |

**Reply pipeline callers** (thread `lane` through opts):

| File                                             | Change                                   |
| ------------------------------------------------ | ---------------------------------------- |
| `src/auto-reply/types.ts`                        | Add `lane?: string` to `GetReplyOptions` |
| `src/auto-reply/reply/agent-runner-execution.ts` | Thread `lane` to `runEmbeddedPiAgent`    |
| `src/infra/heartbeat-runner.ts`                  | Pass `lane: "background"`                |
| `src/infra/sis-runner.ts`                        | Pass `lane: "background"`                |

#### Step 1.4: Config reload handler

**File**: `src/gateway/server-reload-handlers.ts` — Update background lane concurrency on hot-reload.

### Verification

1. `pnpm build` — type-check passes
2. Start gateway, send chat message
3. Logs show: chat runs = `lane=main`, MemU extraction = `lane=background`
4. Background pauses when chat is active, resumes when idle
5. No more 2-3s queue waits on interactive messages

---

## Prong 2: Tool Caching

### Problem

`createArgentTools()` is called on **every agent run**. It instantiates 83+ tool
creators, each building tool objects with schemas, descriptions, and handler closures.
This costs 300-500ms per call and the output is identical across calls for the same
agent configuration.

### Solution: Memoized Tool Factory

Cache the tool array keyed by the inputs that affect tool composition:

- Agent ID
- Config hash (tools policy, provider, enabled features)
- Plugin manifest hash

**File**: `src/agents/argent-tools.ts`

```typescript
// Cache structure
interface ToolCacheEntry {
  tools: AnyAgentTool[];
  configHash: string;
  createdAt: number;
  ttl: number; // 60s default — long enough for a conversation turn
}

const toolCache = new Map<string, ToolCacheEntry>();

export function createArgentTools(params: ArgentToolsParams): AnyAgentTool[] {
  const cacheKey = `${params.agentId}:${hashToolConfig(params)}`;
  const cached = toolCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < cached.ttl) {
    return cached.tools;
  }
  // ... existing tool creation logic ...
  toolCache.set(cacheKey, { tools, configHash, createdAt: Date.now(), ttl: 60_000 });
  return tools;
}
```

**Invalidation**: Cache entry expires after 60s (configurable). Config reload
clears the cache. This is conservative — tools are rebuilt at most once per
minute, not once per message.

### Implementation (2 files)

| File                         | Change                                       |
| ---------------------------- | -------------------------------------------- |
| `src/agents/argent-tools.ts` | Add cache layer around `createArgentTools()` |
| `src/agents/pi-tools.ts`     | Add cache invalidation on config change      |

### What NOT to cache

- Tool **execution** closures that capture per-run state (session, abort controller)
  → These are bound at call time, not at construction time. The tool objects themselves
  are stateless schema+handler pairs. The handler receives context at invocation.

### Verification

1. Add timing log: `diag.debug(\`tool creation: ${ms}ms (cached=${!!cached})\`)`
2. First call: ~300ms. Subsequent calls within 60s: <5ms.
3. Config change → cache miss → full rebuild → subsequent hits

---

## Prong 3: Tool Search (Deferred Loading)

> Full spec: `docs/argent/TOOL_SEARCH_ADOPTION_PLAN.md`

### Summary

Split 83+ tools into ~12 always-loaded core tools and ~70+ deferred tools
discoverable via a `tool_search` meta-tool.

### Impact on Latency

Tool tokens per interactive call: **6K-15K → 2K-4K** (60-75% reduction)

Fewer input tokens = faster LLM inference. At ~50 tokens/second processing speed,
saving 10K tokens saves ~200ms of inference processing time. On LOCAL tier
(Qwen3, 32K context), the effect is even larger since attention is O(n²).

Background loops benefit more: tool tokens drop from 6K-15K to 800-1,500.
This means contemplation/heartbeat/SIS runs are cheaper AND faster.

### Implementation Phases

1. **Tool Registry & Search** — `ToolSearchRegistry` class + `tool_search` tool ✅
2. **Split Core vs. Deferred** — Modify `createArgentTools()` pipeline, feature-gated ✅
3. **Background Loop Core Sets** — Minimal tool sets per subsystem ✅
   - Subsystem detected from `sessionKey` patterns (`:contemplation`, `:sis`) + `isHeartbeat` flag
   - `SUBSYSTEM_CORE_TOOLS` in `tool-search-registry.ts` defines per-subsystem sets
   - Heartbeat: 6 tools, SIS: 3 tools, Contemplation: 4 tools, Exec-worker: 12 tools
   - Interactive sessions: 20 core tools (unchanged from Phase 2)
4. **Metrics & Tuning** — Track discovery patterns, refine classifications — NOT STARTED

### Dependency

Prong 3 builds naturally on Prong 2 (tool caching). Once tools are cached, the
deferred/core split is a filter operation on the cached set rather than a
rebuild. The two prongs compose well.

---

## Quick Wins (Bonus Optimizations)

These are small changes that shave additional milliseconds:

### QW-1: Parallelize pre-LLM setup

**Current**: Skill snapshot → model routing → bootstrap loading → tool creation
happen serially.

**Fix**: Run in parallel with `Promise.all()`:

```typescript
const [skills, routingDecision, bootstrapContext, tools] = await Promise.all([
  ensureSkillSnapshot(),
  routeModel(params),
  resolveBootstrapContextForRun(params),
  createArgentTools(params), // from cache after Prong 2
]);
```

**Estimated savings**: 200-400ms (these operations are independent)

**File**: `src/agents/pi-embedded-runner/run.ts`

### QW-2: Skill snapshot caching

**Current**: Reads skill `.md` files from disk every call (~150ms).

**Fix**: Cache skill entries in memory, invalidate on file change (fs.watch).

**File**: `src/agents/pi-embedded-runner/run/attempt.ts` or wherever `ensureSkillSnapshot` lives

### QW-3: Bootstrap context caching

**Current**: Reads alignment docs (SOUL.md, IDENTITY.md, etc.) from disk every call (~150ms).

**Fix**: Cache with 60s TTL or fs.watch invalidation.

**File**: `src/agents/pi-embedded-runner/run.ts` (bootstrap resolution)

### QW-4: Remove artificial reply delays

**Current**: `reply-dispatcher.ts` adds 800-2500ms "human delay" between block replies.

**Fix**: Make this configurable and default to 0 for interactive chat. The delay
was added to make the agent feel more "natural" but in a Jarvis UX, speed IS natural.

**File**: `src/auto-reply/reply/reply-dispatcher.ts`

---

## Implementation Order

```
Week 1: Prong 1 (Background Lanes) + QW-4 (Remove delays)
         ↓
         Immediate relief: chat no longer blocked by background work

Week 2: Prong 2 (Tool Caching) + QW-1/2/3 (Parallel + caching)
         ↓
         Tool creation drops from 300ms to <5ms
         Pre-LLM setup runs in parallel: 600ms → 200ms

Week 3-4: Prong 3 Phase 1-2 (Tool Search foundation + split)
         ↓
         Tool tokens drop 60-75%, faster inference

Week 5: Prong 3 Phase 3-4 (Background core sets + metrics)
         ↓
         Background loops run lean: 800-1500 tool tokens
```

### Projected Latency After All Prongs

| Phase                   | Before     | After                                 |
| ----------------------- | ---------- | ------------------------------------- |
| Gateway + dispatch      | 50ms       | 50ms                                  |
| Reply preparation       | 200ms      | 100ms (cached)                        |
| Skill/bootstrap loading | 300ms      | <10ms (cached)                        |
| Queue wait              | 0-3000ms   | **0ms** (background on separate lane) |
| Tool instantiation      | 300-500ms  | **<5ms** (cached)                     |
| Model routing           | 100ms      | 50ms (parallel)                       |
| Agent session setup     | 200ms      | 150ms                                 |
| Reply delay             | 800-2500ms | **0ms** (disabled for interactive)    |
| LLM time to first token | 1-3s       | **0.8-2s** (fewer tool tokens)        |
| **Total**               | **3-12s**  | **~1.4-2.4s**                         |

That's Jarvis territory: you speak, and by the time you finish your sentence,
Argent is already responding.

---

## Files Changed (All Prongs)

### Prong 1: Background Lanes (~30 lines across 8 files)

| #   | File                                             | Action                      |
| --- | ------------------------------------------------ | --------------------------- |
| 1   | `src/gateway/server-lanes.ts`                    | Wire background lane        |
| 2   | `src/gateway/server-reload-handlers.ts`          | Hot-reload support          |
| 3   | `src/config/types.agent-defaults.ts`             | Add `backgroundConcurrency` |
| 4   | `src/config/agent-limits.ts`                     | Add resolver                |
| 5   | `src/config/load-profile.ts`                     | Presets + merge             |
| 6   | `src/memory/extract/extract-items.ts`            | `lane: "background"`        |
| 7   | `src/memory/categories/manager.ts`               | `lane: "background"`        |
| 8   | `src/memory/identity/llm.ts`                     | `lane: "background"`        |
| 9   | `src/infra/contemplation-runner.ts`              | `lane: "background"`        |
| 10  | `src/auto-reply/types.ts`                        | Add `lane` to reply options |
| 11  | `src/auto-reply/reply/agent-runner-execution.ts` | Thread lane                 |
| 12  | `src/infra/heartbeat-runner.ts`                  | `lane: "background"`        |
| 13  | `src/infra/sis-runner.ts`                        | `lane: "background"`        |

### Prong 2: Tool Caching (~50 lines across 2 files)

| #   | File                         | Action             |
| --- | ---------------------------- | ------------------ |
| 14  | `src/agents/argent-tools.ts` | Cache layer        |
| 15  | `src/agents/pi-tools.ts`     | Cache invalidation |

### Prong 3: Tool Search (per `TOOL_SEARCH_ADOPTION_PLAN.md`)

| #   | File                                      | Action                      |
| --- | ----------------------------------------- | --------------------------- |
| 16  | `src/agents/tool-search-registry.ts`      | **Create** — Registry class |
| 17  | `src/agents/tools/tool-search-tool.ts`    | **Create** — Meta-tool      |
| 18  | `src/agents/tool-search-metrics.ts`       | **Create** — Usage tracking |
| 19  | `src/agents/argent-tools.ts`              | Add tool group metadata     |
| 20  | `src/agents/pi-tools.ts`                  | Wire registry into pipeline |
| 21  | `src/auto-reply/types.ts`                 | Add `subsystem` field       |
| 22  | `src/infra/contemplation-runner.ts`       | Pass subsystem hint         |
| 23  | `src/infra/heartbeat-runner.ts`           | Pass subsystem hint         |
| 24  | `src/infra/sis-runner.ts`                 | Pass subsystem hint         |
| 25  | `src/infra/execution-worker-runner.ts`    | Pass subsystem hint         |
| 26  | `src/config/types.agent-defaults.ts`      | Add `toolSearch` config     |
| 27  | `src/config/zod-schema.agent-defaults.ts` | Add Zod schema              |

### Quick Wins

| #   | File                                       | Action                    |
| --- | ------------------------------------------ | ------------------------- |
| 28  | `src/agents/pi-embedded-runner/run.ts`     | Parallelize pre-LLM setup |
| 29  | `src/auto-reply/reply/reply-dispatcher.ts` | Configurable reply delay  |

---

## Risk Assessment

| Risk                                              | Mitigation                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------- |
| Background task starved if Main is always busy    | `resumesLanes` ensures background resumes immediately when Main idles           |
| Tool cache serves stale tools after config change | TTL (60s) + explicit invalidation on config reload                              |
| Agent can't find tool via `tool_search`           | Feature-gated, core set includes most-used tools, rollback is one config toggle |
| Session discovered tools list grows unbounded     | `maxDiscovered` cap (default 20)                                                |
| Parallel setup introduces race conditions         | All parallelized operations are read-only (config, disk reads)                  |

---

## Success Criteria

- [ ] Interactive chat: message-to-first-token < 3 seconds consistently
- [ ] No queue wait on interactive messages when background tasks are running
- [ ] Tool creation cost < 10ms on cached hits
- [ ] Tool tokens per interactive call < 4,000
- [ ] Background loop tool tokens < 1,500
- [ ] All existing tests pass
- [ ] No regression in tool selection accuracy (manual spot-check)
