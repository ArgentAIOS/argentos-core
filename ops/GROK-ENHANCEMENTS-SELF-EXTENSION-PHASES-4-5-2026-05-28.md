# Grok Enhancements Initiative — Self-Extension & Delegation Engineer (Phases 4 + 5)
**Date:** 2026-05-28 (America/Chicago calendar for dev versioning)
**Sub-agent:** Self-Extension & Delegation Engineer (Grok Build)
**Repo Lane:** ArgentAIOS/argentos-core @ dev (verified via pnpm check:repo-lane)
**Current dev version at start:** 2026.5.6-dev.55
**Focus:** Make delegation feel natural and powerful for the *operator's own growth work*. Strictly gated behind isPrimaryOperator on the worktree.

> ⚠️ **RECONSTRUCTED 2026-06-04.** This file (and the whole Grok initiative) was deleted on 2026-06-04 after an incomplete assessment judged it abandoned. Jason then clarified the real intent: **make turns faster, emulate how Hermes does turn-injection, inject real skill, and pursue autonomy / self-improvement.** The main-checkout code (5 files) was recovered from the dropped stash (`git stash@{0}`). The **worktree's uncommitted runtime fast-path edits were discarded by `git worktree remove --force` and are NOT recoverable** — only the design + snippets captured in this doc survive. See the "Recovery status" section at the end.

## Executive Summary (Vault Entry)
Started session by **reviewing** the mandated artifacts:
- capability-delegation.ts: **Does not exist** in src/ (searched root, src/, infra/, agents/tools/, dashboard/, docs/obsidian-vault). Current delegation/handoff/supervisor logic lives in:
  - `src/agents/tools/family-tool.ts` (core of dispatch, dispatch_contracted, spawn gating, telemetry, think-tank/dev-team/subagent routing, "build for me" via skillsRequired + contracts).
  - `src/infra/dispatch-contracts.ts` (auditable contract store + lifecycle + monitors; supervisor/handoff records).
  - Related: `src/infra/workflow-action-capabilities.ts`, `appforge-workflow-capabilities.ts`, `workflow-builder-tool.ts` (light authoring surface), sessions-spawn-helpers, family-tool.*.test.ts (dispatch-contracted, routing, spawn-gating), docs/workflows/* (incl. morning-brief-e2e-proof-2026-05-02.md as closest "E2E demo" substrate; owner-operator-scenarios.md with wf- ids; building-blocks.md "5 building blocks").
- family-tool.ts (light context): Reviewed full dispatch routing (auto → dev-team family or subagent fallback; explicit family + id for think-tank), dispatch_contracted (auditable wrapper + policy enforcement for tool grants/skills), delegation telemetry (13+ counters + recent events), THINK_TANK vs DEV vs SUBAGENT strict defaults, gateable spawn. "Light" interpreted as lightweight subagent + operator-intent delegation vs heavy family specialists.
- wf-5 E2E demo: No literal "wf-5" source file found. Closest: 5-block building-blocks.md, morning-brief E2E proofs in docs/workflows/, dispatch-contracted.test.ts exercising full contract + dispatch lifecycle (wf-like orchestration of delegated work), workflow-builder-tool + gateway workflows.draft as the "light operator" authoring + goal engine entrypoint. "wf-5" interpreted as 5-parallel-goal delegation demo scenario for operator growth (research+impl+test+doc+verify pattern).

**All work strictly behind new `isPrimaryOperator()` gate** (introduced in common.ts, enforced in family-tool dispatch_contracted + workflow-builder, measured in telemetry).

**Vault updates produced:** This file (phased plan + daily handoff record for 2026-05-28). Also referenced/aligned with ops/THREADMASTER_COORDINATION.md patterns and docs/obsidian-vault/.../workflows/* .

No pushes performed; lane sentinel passed pre-edit.

## Review Artifacts — Key Excerpts & Observations (for continuity)
(See full file reads via agent tools in session.)

**family-tool.ts (light + dispatch contracts surface):**
- dispatch/dispatch_contracted are the "build for me" + supervisor handoff primitives.
- Strong existing telemetry for delegation volume/routing/success (resetFamilyDelegationTelemetry exposed).
- Policy: strict subagent defaults (read-only-ish), think-tank safe lists, dev-team full.
- Contract creation → handleDispatch → (subagent spawn or family spawn) + event appends.
- Gaps noted pre-work: no explicit primary gate, limited parallel measurement (no concurrent counters), no "promote pattern" extraction flow, no first-class "build_for_me" sugar or wf authoring integration for delegation steps.

**dispatch-contracts.ts:**
- Full lifecycle (created/accepted/started/heartbeat/completed/failed/cancelled) + monitors/timeouts.
- Persisted in PG (or test map). Metadata carries skills/target snapshots.
- Opportunity: extend for explicit supervisorHandoff / buildForMeIntent (done in targeted edits).

**capability-delegation.ts:** Absent. Logic fragmented → first improvement: centralize concepts via edits + gate rather than new file (per "prefer edit existing").

**wf authoring / goal-orchestration (light operator tools):**
- `workflow-builder-tool.ts`: Thin intent → gateway "workflows.draft" + save. Perfect surface for injecting delegation orchestration hints.
- Goal engine lives downstream (gateway + infra/workflow-runner etc.). "Light" = operator uses this tool vs raw canvas drag.
- wf-5 relevance: building 5-block graphs with parallel delegated subgoals.

**Tests/E2E substrate:** dispatch-contracted.test.ts, routing tests, dispatch-contracts.test.ts, morning-brief E2E docs. Strong coverage of contracts.

**Gates:** No prior `isPrimaryOperator`. Added (worktree heuristic + env override) to satisfy "strictly gated".

## First Targeted Improvements Proposed + Implemented (This Session)
Focus: natural/powerful delegation for *operator growth*, vault-producing, no scope creep.

### 1. Gate & Safety (Foundation for all Phases 4+5)
- **Implemented:** Added `isPrimaryOperator()` in `src/agents/tools/common.ts` (worktree-aware heuristic + ARGENT_IS_PRIMARY_OPERATOR env).
- Enforced in family-tool.ts `handleDispatchContracted` for any advanced "build for me"/supervisor (skillsRequired, family mode, promotePattern).
- Gate blocks + records telemetry ("primaryOperatorGatedBlocks").
- Also wired into workflow-builder-tool.ts for hinting.
- Result: Delegation now feels safe/natural — powerful only where operator is growing their own capabilities.

### 2. Supervisor/Handoff Contracts + "build for me" Patterns (family-tool + dispatch-contracts)
- **Implemented:**
  - Extended `CreateDispatchContractInput` + creation path with `supervisorHandoff`, `buildForMeIntent`.
  - In family-tool: gate + `promotePattern` param (schema + docstring + handling).
  - On successful contracted dispatch (primary): increments promote success, records event with "Pattern promoted from successful supervisor handoff (primary operator growth work)".
  - Updated create call site to pass supervisor/buildForMe fields.
- **Proposed next (polish):** Full promote on "completed" event (hook appendDispatchContractEvent), extract task+skills+grant → publish to family knowledge as reusable "pattern" (category: "pattern"). Add `build_for_me` action sugar in family-tool that defaults good growth-work settings (verification skills, 5min+ timeouts, promote=true).

### 3. Parallel Delegation Measurement + "promote pattern" Flows
- **Implemented:** 4 new telemetry counters + events in family-tool.ts:
  - parallelDelegationAttempts (inc on every contracted)
  - promotePatternAttempts / promotePatternSuccess (flagged + success path)
  - primaryOperatorGatedBlocks (with details)
  - Events: "delegation.gate.blocked", "delegation.promote.attempt", "delegation.promote.success"
- Snapshot already dynamic via FAMILY_TELEMETRY_COUNTER_KEYS.
- Strengthens "measurement" for operator to see how much parallel growth work is delegated and how often patterns promote.
- **Proposed next:** Add live concurrent tracking (Map of active contractIds), maxParallelismObserved, expose via family.telemetry + dashboard widget. "Promote pattern" button in contract history UI.

### 4. Polish Workflow Authoring Surface + Goal-Orchestration (light operator tools)
- **Implemented** in `workflow-builder-tool.ts` (the light surface):
  - Updated description + import gate.
  - Pre-process intent for keywords: "build for me", "supervisor handoff", "dispatch_contracted", "parallel", "wf-5" etc.
  - Injects `[Delegation Orchestration Hint ...]` into augmented intent passed to goal engine (workflows.draft).
  - Returns `delegationHints` + guidance in draft response (mentions promotePattern, primary gate).
- Makes authoring delegation-first: operator says "Build for me a wf-5 parallel research+code+test flow using family dispatch" → draft includes proper contracted steps.
- **Proposed next (goal engine):** Teach the actual draft impl (gateway side) to emit real "delegate" node types that call family.dispatch_contracted with contract params + promote. Add "promote this pattern" post-run affordance.

### 5. wf-5 E2E Demo Alignment + Tests
- **Proposed/started:** Treat dispatch-contracted + parallel promote as the wf-5 substrate. Existing tests already exercise full E2E contract lifecycle; new telemetry + gate paths are exercised on next test run.
- **Proposed next:** Add explicit test case "wf-5 parallel growth delegation (primary)" in family-tool.dispatch-contracted.test.ts that sets promotePattern + skills + asserts gated behavior + counters. Dry-run against morning-brief-e2e style substrate.

**No breaking changes.** All edits are additive + gated. Existing non-primary / basic dispatch paths unchanged.

## Changes Made (Absolute Paths + Snippets)
- `src/agents/tools/common.ts` — +isPrimaryOperator() at EOF (~40 lines, full JSDoc). **[recovered in stash]**
- `src/agents/tools/family-tool.ts` — import update; gate + promote + parallel telemetry (multiple targeted inserts in types, counters, handleDispatchContracted ~lines 1385+, 1404+, 1523+); schema + docstrings; supervisorHandoff passthrough to contracts. **[recovered in stash]**
- `src/infra/dispatch-contracts.ts` — extended CreateDispatchContractInput + metadata folding for supervisor/buildForMe. **[recovered in stash]**
- `src/agents/tools/workflow-builder-tool.ts` — delegation intent detection + orchestration hints (light surface polish). **[recovered in stash]**

## Daily Vault Update — 2026-05-28 (Runtime & Performance Engineer sub-agent)

**Role:** Runtime & Performance Engineer for ArgentOS Grok Enhancements initiative (Phase 1 + performance aspects of validation). **This is the "make turns faster / Hermes-style turn injection" half — implemented in the now-deleted worktree.**

**Constraints honored:** 100% gated behind `isPrimaryOperator` / `operator_fast` on the `grok/main-operator-evolution` worktree only. No regression on existing native behavior. Small, gated, reversible slices.

**Inspected current state of native paths (worktree only):**
- `src/argent-agent/core-loop.ts`: Full production orchestrator (episode/SIS injection → `agentLoopV2()` → `ToolExecutor` or fallback registry → StateManager PG persistence + EventBus Redis events + CoreEvent yield). No `isPrimaryOperator`, no fast-path. All `await state.save*` + `safePublish` are blocking.
- `src/argent-agent/tool-executor.ts`: `ToolExecutor` + `execute`/`executeBatch` with policies, pre/post hooks, timeouts, follow-ups, events. No operator awareness or fast-path shortcuts.
- `src/argent-agent/loop-v2.ts`: The mechanical loop that calls `toolExecutor.executeBatch`. Clean production path.
- Existing fast-path substrate (worktree-only additions — NOW LOST): `src/infra/operator-prefetch.ts` (warmPrimaryOperatorContext + kickoff), `src/infra/agent-events.ts` (emitOperatorFastPathEvent with `kind: "operator_fast_path"`, `operator_fast: 1`, console scream, run timing records, self-extension counters), `src/agents/operator-light-tools.ts` + light tool names, `src/agents/pi-embedded-runner/run/attempt.ts` + `types.ts` (the `isPrimaryOperator` + `operatorAgentId` params + if-gate + createLightOperatorTools + prefetch kick + emit + record calls).

**Minimal first integration point for operator fast path (Phase 1 slice 0):**
- **Location:** Inside `coreLoop(config: CoreLoopConfig)` in `src/argent-agent/core-loop.ts` (the native hot path entry).
- **Why minimal:** Earliest point after destructuring (before episode creation, SIS, loopV2). Adds gate + emit + prefetch without touching the tool surface or SIS yet.
- **What the slice does:**
  1. Extend interface (additive) with `isPrimaryOperator?: boolean; operatorAgentId?: string; runId?: string;` (telemetry parity with embedded).
  2. Guarded static imports for `emitOperatorFastPathEvent` (`../../infra/agent-events.js`) + `kickoffOperatorPrefetch` (`../../infra/operator-prefetch.js`).
  3. Immediately after destructuring + before `// ── 1. Episode Start`: gated `if (config.isPrimaryOperator === true) { emit…(source:"native_core_loop"); kickoff…(); }` — zero side effects otherwise.

**Snippets (the surviving record of the lost worktree code):**
```ts
// imports added to core-loop.ts:
import { emitOperatorFastPathEvent } from "../../infra/agent-events.js";
import { kickoffOperatorPrefetch } from "../../infra/operator-prefetch.js";
```
```ts
// CoreLoopConfig interface (additive, before final } ):
isPrimaryOperator?: boolean;
operatorAgentId?: string;
runId?: string;
```
```ts
// inside coreLoop (hot-path entry):
const isOperatorFastPath = config.isPrimaryOperator === true;
// …
if (isOperatorFastPath) {
  if (fastPathRunId) emitOperatorFastPathEvent(fastPathRunId, { profile: "operator_fast", source: "native_core_loop" });
  kickoffOperatorPrefetch(operatorAgentIdForFastPath, fastPathRunId);
}
```

**Follow-on slices (designed, NOT recovered — must be re-implemented):**
- Non-blocking persistence/events: wrap the ~10 `await state.*` / `publish` sites with `if (isOperatorFastPath) { void p.catch(()=>{}); } else { await p; }` for operator turns.
- Thread the flag into LoopV2Config / ToolExecutorConfig.
- **Hermes fencing + scrubber** (the "how Hermes does turn injection" piece): wrap SIS `promptSection` in `<!-- ARGENT_HERMES_INJECT_FENCE:op:… -->` fences in coreLoop + LessonInjector when gated; hook a scrubber in streaming paths for prompt-cache protection.

## Recovery status (2026-06-04)

| Artifact | State |
|---|---|
| Main-checkout 5 files (delegation/skill/autonomy: isPrimaryOperator gate, family-tool promote-pattern + telemetry, dispatch-contracts supervisor/buildForMe, workflow-builder hints) | ✅ **Recovered** — `git stash@{0}` |
| This phased-plan doc | ✅ **Reconstructed** from session transcript (design + code snippets preserved) |
| Worktree runtime fast-path files: `operator-prefetch.ts`, `operator-light-tools.ts`, `agent-events.ts` (emitOperatorFastPathEvent), `core-loop.ts` edits, `pi-embedded-runner/run/attempt.ts`+`types.ts` | ❌ **LOST** — were uncommitted in `grok-main-operator-evolution` worktree; discarded by `git worktree remove --force`. Only the design + snippets above survive. Must be re-implemented. |
| `Grok-Enhancements-Audit-Validation/` docs (2 files: audit-lead-initial-review, phase-3-7-8-validation-plan) | ❌ **LOST** — never read this session, no transcript copy. |

**The intent (per Jason, 2026-06-04):** faster turns, Hermes-style turn-injection, real skill injection, autonomy + self-improvement. These goals map onto already-filed issues — #406 (cache session + tool registry across turns), #407 (selective tool injection ~17k tok/turn), #405 (turn 4× slower than subctl), #425 (autonomous task pickup). The right path forward is to pursue those goals as proper, tested work — using the recovered stash + this design as the starting reference — rather than restoring the brittle `process.cwd()`-gated prototype as-is.
