# Argent Core: Implementation Status

**Last Updated:** 2026-02-18
**Branch:** `main` (feat/argent-runtime merged)
**Active Cutover Branch:** `codex/agent-core-cutover-2026-02-18` (Codex)
**Spec:** `src/argent-ai/SPECIFICATION.md` (v1.2, co-authored with Grok/xAI)
**Vision:** `VISION.md` (Digital Workforce Architecture)

---

## Overview

Argent Core is a complete replacement for ArgentOS's Pi ecosystem dependencies
(`@mariozechner/pi-agent-core`, `pi-ai`, `pi-coding-agent`). This is NOT a wrapper —
it's native PostgreSQL + Redis, multi-agent from day one, with SIS lesson injection
as a first-class loop feature.

**Goal:** Zero Pi runtime dependencies
**Target:** April 2026
**Current Week:** Week 1 of ~9

---

## Phase Status

### Phase 0: Foundation (PG+Redis) — DONE

PostgreSQL 17 + pgvector + Redis infrastructure. Schema, adapters, migration scripts.

- Branch: `feat/pg-redis-migration` (separate, merged partially to main)
- Drizzle ORM schema: 15 tables, HNSW indexes, tsvector FTS, RLS policies
- SQLiteAdapter, DualAdapter, PgAdapter, StorageFactory
- Ports: PG=5433, Redis=6380 (non-default to avoid conflicts)
- Docs: `docs/argent/STORAGE_BRIDGE_ARCHITECTURE.md`

### Phase 1: argent-ai (Providers) — CODE COMPLETE, UNTESTED

All provider implementations written. Build passes. No live API testing done.

| File                                   | LOC  | Status                                                                          |
| -------------------------------------- | ---- | ------------------------------------------------------------------------------- |
| `src/argent-ai/types.ts`               | 505  | Complete — full type system (Provider, StreamEvent, TurnRequest/Response, etc.) |
| `src/argent-ai/providers/anthropic.ts` | 406  | Complete — Anthropic SDK streaming, tool calls, thinking blocks                 |
| `src/argent-ai/providers/openai.ts`    | ~370 | Complete — OpenAI SDK, handles o-series reasoning tokens                        |
| `src/argent-ai/providers/google.ts`    | 304  | Complete — Gemini SDK, function calling                                         |
| `src/argent-ai/providers/xai.ts`       | 42   | Complete — wraps OpenAI provider with xAI base URL                              |
| `src/argent-ai/providers/minimax.ts`   | 439  | Complete — raw fetch + SSE streaming                                            |
| `src/argent-ai/providers/zai.ts`       | 438  | Complete — raw fetch + SSE streaming                                            |
| `src/argent-ai/providers/index.ts`     | ~70  | Complete — factory dispatch `createProvider()`                                  |
| `src/argent-ai/models-db.ts`           | ~820 | Complete — model database with all providers including NVIDIA                   |
| `src/argent-ai/utils/event-stream.ts`  | 194  | Complete — async iterable event stream                                          |
| `src/argent-ai/SPECIFICATION.md`       | 252  | The spec itself (v1.2, Grok collab)                                             |

**NVIDIA Provider (added Feb 18):** 3 free models via `integrate.api.nvidia.com/v1`:

- `nvidia/llama-3.1-nemotron-70b-instruct` (128K, $0)
- `nvidia/llama-3.3-70b-instruct` (128K, $0)
- `nvidia/mistral-nemo-minitron-8b-8k-instruct` (8K, $0)

**Dependencies added:** `openai` (^6.17.0), `@google/generative-ai` (^0.24.1)
**npm packages installed:** Yes, both present in node_modules

### Phase 2: argent-agent (Agent Runtime) — CODE COMPLETE, UNTESTED

Agent loop, session management, tools, SIS integration all written. 25 SIS tests pass.

| File                                       | LOC   | Status                                                            |
| ------------------------------------------ | ----- | ----------------------------------------------------------------- |
| `src/argent-agent/agent.ts`                | 394   | Complete — Agent class with SIS lesson injection                  |
| `src/argent-agent/loop.ts`                 | 163   | Complete — stream→tool→re-prompt cycle                            |
| `src/argent-agent/events.ts`               | 96    | Complete — AgentEvent union + type guards                         |
| `src/argent-agent/tools.ts`                | 117   | Complete — ToolRegistry + executeToolCall                         |
| `src/argent-agent/session.ts`              | 155   | Complete — Session class with JSONL persistence                   |
| `src/argent-agent/session-store.ts`        | 113   | Complete — JSONL read/write/list                                  |
| `src/argent-agent/compaction.ts`           | 583   | Complete — LLM-powered context compaction (Pi-grade)              |
| `src/argent-agent/tokenizer.ts`            | 61    | Complete — chars/4 heuristic token estimator                      |
| `src/argent-agent/compat.ts`               | 477   | Complete — Pi↔Argent type bridge + `createArgentStreamSimple()`   |
| `src/argent-agent/providers.ts`            | ~126  | Complete — auto-load API keys from dashboard key store            |
| `src/argent-agent/keys.ts`                 | ~184  | Complete — KeyManager for API key retrieval                       |
| `src/argent-agent/session-manager.ts`      | 708   | Complete — ArgentSessionManager (Pi-compatible interface)         |
| `src/argent-agent/settings-manager.ts`     | 631   | Complete — ArgentSettingsManager (Pi-compatible interface)        |
| `src/argent-agent/create-agent-session.ts` | 976   | Complete — full session creation with tool wiring                 |
| `src/argent-agent/index.ts`                | 196   | Complete — barrel exports                                         |
| `src/argent-agent/sis/`                    | ~1500 | Complete — confidence scoring (5-factor formula from Grok collab) |

**SIS Confidence Formula (from spec):**

```
confidence = 0.40×valence_delta + 0.25×success_rate + 0.15×endorsement + 0.10×recency + 0.10×llm_conf - contradiction_penalty
```

**Tests:** 25 passing (SIS confidence scoring, lesson injection, contradiction penalties)

### Phase 3: Integration & Testing — WIRED, FLAG OFF

Feature flag is wired in the gateway LaunchAgent plist. Currently set to `false` —
Pi is the active runtime. The flag can be flipped to `true` for testing without
code changes.

**What's wired:**

- `src/agent-core/ai.ts` — re-exports Pi AND Argent bridge functions
- `src/agent-core/core.ts` — re-exports Pi AND Argent agent/loop/session/tools
- `src/agent-core/runtime-policy.ts` — `resolveAgentCoreRuntimeMode()` + `assertPiFallbackAllowed()`
- `src/agent-core/diagnostics.ts` — runtime diagnostics for troubleshooting
- `src/agents/pi-embedded-runner/run/attempt.ts` — feature flag at line 113:
  ```typescript
  const ARGENT_RUNTIME_ENABLED = process.env.ARGENT_RUNTIME === "true";
  ```
- Gateway LaunchAgent plist line 171-172: `ARGENT_RUNTIME` = `false`
- When flag is ON: `resolveArgentProvider()` creates Argent provider, `createArgentStreamSimple()` wraps it as Pi-compatible `streamFn`; ArgentSessionManager and ArgentSettingsManager replace Pi equivalents
- When flag is OFF (current): Pi's `streamSimple` is used (100% Pi runtime)
- Fallback: if Argent provider fails, falls back to Pi automatically

**What's NOT done:**

- [ ] Turn on `ARGENT_RUNTIME=true` and test with real API calls
- [ ] Verify streaming works (deltas arrive in dashboard)
- [ ] Verify tool calls work (tasks, memory, etc.)
- [ ] Verify contemplation still works (cron lane, Ollama)
- [ ] Verify SIS still runs (lesson extraction)
- [ ] Test each provider individually (Anthropic, OpenAI, Google, xAI, MiniMax, Z.AI, NVIDIA)
- [ ] Performance comparison: Argent vs Pi latency/throughput
- [ ] Verify Argent Session/SessionStore work end-to-end

### Phase 4: Full Cutover — IN PROGRESS (Codex)

**Active branch:** `codex/agent-core-cutover-2026-02-18`

Codex is working on the cutover: strengthening `src/agent-core/` as the migration
seam, adding runtime policy enforcement, and preparing for Pi import elimination.

**What this requires:**

- Replace Pi's `SessionManager`/`SettingsManager` with Argent's equivalents (code written, needs activation)
- Replace Pi's type system (`AgentMessage`, `AssistantMessage`, etc.) across ~145 files
- Replace Pi's tool registration with Argent's `ToolRegistry`
- Rewrite TUI's direct Pi imports (~21 files in `src/tui/`)
- Remove `export * from "@mariozechner/pi-*"` from `src/agent-core/`
- Remove 4 Pi npm packages from `package.json`
- Remove Pi compat code from `src/argent-agent/compat.ts`

**Rollout sequence:** `pi_only` (current) → `argent_with_fallback` (canary) → `argent_strict` (full cutover)

---

## Recent Features (Feb 18)

### NVIDIA Free Cloud Inference Provider

Zero-cost cloud tier between local Ollama and paid Anthropic. Uses `openai-completions`
protocol — no new transport code. `nvidia-free` model router profile added.

**Files:** `models-db.ts`, `types.ts`, `model-auth.ts`, `live-model-filter.ts`, `attempt.ts`, `router.ts`

### Tool Loop Detection

Agents stuck calling the same tool repeatedly with identical arguments now get
warned (at 3 consecutive calls) and aborted (at 7). Sliding window fingerprinting
with exponential backoff. `read` tool excluded by default.

**Files:** `src/agents/tool-loop-detector.ts` (new), `src/agents/pi-tools.loop-detect.ts` (new),
`pi-tools.ts`, `types.agent-defaults.ts`, `pi-embedded-subscribe.handlers.tools.ts`

### Auth Profile Cooldown Auto-Expiry

Circuit-breaker half-open→closed: `clearExpiredCooldowns()` runs at the top of
`resolveAuthProfileOrder()`, resets error counts when cooldowns expire so profiles
aren't immediately re-penalized on the next transient failure.

**Files:** `usage.ts`, `order.ts`, `auth-profiles.ts` (barrel), test file

### Session Snapshot (Feb 17)

Amnesia prevention: compaction summaries saved to `~/.argentos/agents/{id}/session-snapshot.json`,
injected into bootstrap on restart.

**Files:** `src/agents/session-snapshot.ts`, `compact.ts`, `commands-compact.ts`, `bootstrap-files.ts`

---

## Key Files

| File                                           | Purpose                                                          |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| `src/argent-ai/SPECIFICATION.md`               | The technical spec (v1.2, Grok collab)                           |
| `VISION.md`                                    | Digital Workforce Architecture (18 agents, team structure)       |
| `src/agent-core/runtime-policy.ts`             | Runtime mode resolution + Pi fallback enforcement                |
| `src/agent-core/diagnostics.ts`                | Runtime diagnostics for troubleshooting                          |
| `src/agent-core/README.md`                     | Agent-core architecture, exports, extraction plan                |
| `src/agent-core/NEXT_STEPS.md`                 | Migration checklist with completed/deferred items                |
| `docs/the-awakening/PLAN.md`                   | The Awakening plan (OpenClaw branding removal — separate effort) |
| `docs/the-awakening/PI-MONO-DEPENDENCY-MAP.md` | Full audit of Pi imports (189 sites)                             |
| `src/argent-ai/`                               | Provider abstraction layer (all providers)                       |
| `src/argent-agent/`                            | Agent runtime (loop, session, tools, SIS, compat bridge)         |
| `src/agent-core/`                              | Abstraction layer — dual-exports (Pi + Argent)                   |
| `src/agents/tool-loop-detector.ts`             | Tool loop detection (sliding window fingerprinting)              |
| `src/agents/session-snapshot.ts`               | Session amnesia prevention                                       |

---

## Commits

| Hash      | Message                                                                          |
| --------- | -------------------------------------------------------------------------------- |
| `9021c73` | feat(argent-core): provider abstraction layer + SIS lesson system                |
| `44cc08b` | feat(argent-runtime): complete Argent-native agent system with Pi compat bridge  |
| `0cba242` | feat(argent-runtime): 100% Pi symbol coverage — native runtime complete          |
| `29d09f7` | fix(argent-runtime): revert to Pi session/settings + Pi-grade compaction         |
| `70b82d1` | fix: rename estimateTokens → estimateTextTokens to avoid Pi symbol collision     |
| `571fe8e` | refactor: remove dead OpenClaw memory-core plugin                                |
| `60486dd` | feat(argent-runtime): NVIDIA provider, tool loop detection, cooldown auto-expiry |

---

## Current Runtime State

**Pi is the active runtime.** Argent code is wired and ready but the feature flag
is set to `false`. Flipping `ARGENT_RUNTIME=true` in the gateway plist activates
the Argent runtime with automatic Pi fallback.

```
Pi Runtime (ACTIVE — ARGENT_RUNTIME=false):
  @mariozechner/pi-agent-core  0.52.12  — types, events
  @mariozechner/pi-ai          0.52.12  — streamSimple, complete, providers
  @mariozechner/pi-coding-agent 0.52.12 — SessionManager, tools, skills
  @mariozechner/pi-tui         0.52.12  — terminal UI (candidate for rewrite)

Argent Runtime (READY — behind ARGENT_RUNTIME=true flag):
  src/argent-ai/  — 7 provider implementations (incl. NVIDIA)
  src/argent-agent/ — agent loop, session, tools, SIS, compaction
  src/argent-agent/compat.ts — Pi↔Argent bridge
  src/argent-agent/session-manager.ts — ArgentSessionManager
  src/argent-agent/settings-manager.ts — ArgentSettingsManager
  src/agent-core/runtime-policy.ts — mode resolution + fallback enforcement
```

---

## Next Steps (Priority Order)

1. **Codex cutover work** on `codex/agent-core-cutover-2026-02-18` — strengthen agent-core seam
2. **Turn on the feature flag** and test Argent providers against real APIs
3. **Verify streaming** end-to-end (dashboard, Telegram, CLI)
4. **Verify tool execution** (tasks, memory, contemplation)
5. **Performance benchmark** Argent vs Pi
6. **Execute staged rollout** — pi_only → argent_with_fallback → argent_strict
7. **Remove Pi dependencies** — final cutover

---

## Related Plans

- **The Awakening** (`docs/the-awakening/PLAN.md`) — OpenClaw branding removal (7 phases, separate effort)
- **PG+Redis Migration** (`docs/argent/STORAGE_BRIDGE_ARCHITECTURE.md`) — Storage layer modernization
- **SIS Architecture** (`docs/argent/SIS_ARCHITECTURE.md`) — Self-Improving System design

---

## Collaboration History

- **February 16, 2026:** Spec v1.2 finalized with Grok (xAI) — lesson confidence scoring,
  Redis family events, endorsement weighting, fan-out patterns
- **February 16, 2026:** Phase 1+2 code written in single session (commits 9021c73, 44cc08b)
- **February 16, 2026:** Context loss incident — session refreshed mid-work, stale plan
  re-triggered. Status doc created to prevent recurrence.
- **February 17, 2026:** Session snapshot amnesia prevention implemented; Pi-grade compaction
  reverted to Pi session/settings for stability (29d09f7)
- **February 18, 2026:** NVIDIA provider, tool loop detection, cooldown auto-expiry
  implemented and merged to main (60486dd). All 949 test files, 6435 tests pass.
- **February 18, 2026:** Codex begins Phase 4 cutover work on `codex/agent-core-cutover-2026-02-18`

---

_This status doc is the source of truth for Argent Core progress._
_Update it whenever phases advance._
