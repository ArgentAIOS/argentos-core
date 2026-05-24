# HANDOFF — Kernel Fitness & Self-Improving Refiner

**Created:** 2026-05-22
**Revised:** 2026-05-24 (Revision 2 — empirical updates from thermal investigation)
**Branch at handoff creation:** `working/2026-05-15` (local-only; v1 never committed)
**Authors of the design:** operator (Jason) + Claude Opus 4.7 (v1, 2026-05-22 evening; v2, 2026-05-24)
**Picks up from:** no prior implementation work; this remains a greenfield design handoff
**Empirical basis for v2:** the 2026-05-24 thermal investigation — see `~/Documents/Obsidian Vault/Argent/Thermals/2026-05-24 - Post-Mortem.md` and PR [#382](https://github.com/ArgentAIOS/argentos-core/pull/382)

> Every claim in this document is tagged **[REFERENCE]** (verified by reading the named file/line during design), **[PROPOSED]** (design choice from the 2026-05-22 conversation, may change after operator review), **[ASSUMED]** (inference about future behavior that needs validation), or **[EMPIRICAL]** (added in Revision 2, derived from real-world operating data on 2026-05-24).

---

## Revision 2 (2026-05-24) — what changed and why

In the two weeks between v1 authoring and v2 revision, operator + Claude ran a thermal investigation on a MacBook Pro M5 Max that produced data v1 didn't have. The investigation shipped PR #382 (crash-loop fix), migrated the kernel from LM Studio to Ollama + MLX, raised `kernel.tickMs` from 30s default to 120s in argent.json, and dropped chassis temperature from 147–157°F to 98°F.

That work was not "drift from the handoff" — it was empirical kernel tuning that surfaced data the original design didn't have access to. v2 incorporates that data without changing v1's core architecture. **Specifically:**

1. **Phase 1 carries a behavior change, not just a refactor.** Original Phase 1 was strictly behavior-neutral (extract the inner-loop prompt only). v2's Phase 1 also changes `DEFAULT_TICK_MS` from 30_000 → 120_000 in `src/infra/consciousness-kernel.ts:50`. Rationale: on a laptop, the 30s default produced enough sustained inference heat that the operator manually stopped the gateway, which made the kernel un-measurable. A more humane default is a prerequisite to any fitness measurement working at all.

2. **Phase 3 gains a fourth outcome category: `system_unavailable`.** Original outcomes were `acted | acked | ignored`. The thermal investigation revealed a stronger form of disengagement: the operator stops the gateway entirely before N hours elapses. Conflating that with `ignored` undercounts the cost. v2 adds `system_unavailable` so engagement-rate denominators are honest about cycles the operator never got to see.

3. **Phase ordering becomes a two-milestone bundle, not four independent phases.** Original §6 said phases are independently shippable. v2 keeps that property but adds a strong recommendation: ship Phases 1+2+3 as **Milestone 1 ("fitness M1")** and Phase 4 as **Milestone 2 ("fitness M2")**. Rationale: empirically the baseline engagement rate is approximately 0 (operator was stopping the system, not engaging with surfaces). Without engagement instrumentation landed alongside the stall composite, M1 risks plateauing at "stall composite looks fine" while the kernel produces zero operator-useful output. The engagement signal must be measurable before the refiner has anything honest to optimize against.

4. **Cross-references added** to today's PR, post-mortem, lessons-learned files, and the operational decision [[Argent/Decisions/Ollama+MLX as Mac Default Stack]] that captures the runtime+model defaults shift. Phase 4's refiner LLM choice now has a concrete recommendation (small local MLX model) grounded in today's findings.

5. **Three "what's still right" anchors that v2 explicitly does not change:** the three-leg tripod (immutable fitness + scope-locked refiner + keep-or-discard judge), the structural rule (fitness number never appears in the inner-loop prompt), and the forked-subprocess refiner as the strongest enforcement mechanism (§5.3 option 1). These remain load-bearing.

The rest of v2 is targeted inline edits flagged **[EMPIRICAL]** where they appear in the body.

---

## 0. TL;DR

The ArgentOS consciousness kernel today is **observation + continuity infrastructure**, not a learning system. It reflects, persists state, detects when it loops on the same thought (signature equality), and rotates agendas — but it has no fitness function, no immutable referee, and no keep-or-discard rule. There is no way to tell whether yesterday's kernel was better than today's.

This handoff builds the missing third leg of the tripod: an immutable fitness signal, a separately-scoped refiner with runtime tool-denial enforcement (Hermes pattern), and an adversarial keep-or-discard judge (autoresearch pattern). It also adds a dashboard panel so the operator can watch the loop run.

Ship as two milestones (each containing one or more phases). Do M1 before M2. Phases within M1 can interleave but should ship together.

- **Milestone 1 — "fitness M1": instrumentation that doesn't yet close the loop.** Ship Phases 1, 2, and 3 together.
  1. **Scaffold extraction** — promote the hardcoded inner-loop prompt out of source code into a refinable file. **[EMPIRICAL]** Also changes `DEFAULT_TICK_MS` from 30s → 120s in the same PR — see Revision 2 note above.
  2. **Fitness writer + stall composite** — one number per measurement window, written by a process that can write nothing else.
  3. **Operator-engagement instrumentation** — capture `acted / acked / ignored / system_unavailable` (**[EMPIRICAL]** fourth category) on every surfaced item; engagement_rate is the real fitness signal.
- **Milestone 2 — "fitness M2": close the loop.** Ship Phase 4 alone. 4. **Refiner + judge + dashboard** — forked process with tool whitelist; K-window keep-or-discard; ConfigPanel reporting surface.

---

## 1. Why this work exists

Read the 2026-05-22 conversation transcript before doing any code. The framing matters more than the implementation details.

The short version:

- **Karpathy's `autoresearch`** ([github.com/karpathy/autoresearch](https://github.com/karpathy/autoresearch)) shows that "self-improving agent" reduces to: agent edits scope-limited code, fixed-budget experiment, immutable metric the agent cannot move, keep-or-discard based on the metric. The whole loop is small. The discipline of `prepare.py` being off-limits is what makes it work.
- **Continual Harness** ([arXiv:2605.09998](https://arxiv.org/abs/2605.09998), [github.com/webdevtodayjason/continual-harness](https://github.com/webdevtodayjason/continual-harness)) shows the technique for in-context refinement: four CRUD stores (prompt, sub-agents, skills, memory), trajectory window with pre-computed ⚠️ failure flags injected by deterministic Python before any LLM reads them, refiner-as-second-role of same model. But Continual Harness lacks the immutable referee — and the paper documents the resulting Red bootstrap-updating regression honestly. Refinement without keep-or-discard can metacognate worse.
- **Hermes** ([github.com/NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)) contributes the cleanest enforcement mechanism observed in any production agent: the refiner runs as a forked process with a runtime tool whitelist. Memory + skill tools allowed; everything else is _denied at runtime_, not just "discouraged in the prompt." That's the lesson worth importing regardless of anything else.

The ArgentOS kernel today has Continual Harness's outer skin (cron + reflection + state + stall detection) without Continual Harness's substance (scaffold CRUD + antipattern flags + refiner) and without autoresearch's discipline (immutable metric + keep-or-discard).

This handoff closes that gap.

---

## 2. Current state — files and signals you'll touch

### 2.1 The kernel as it stands today [REFERENCE]

| File                                                                                               | Lines | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [src/infra/consciousness-kernel.ts](src/infra/consciousness-kernel.ts)                             | 2,112 | Main runner. Cron tick at default 30s ([:50](src/infra/consciousness-kernel.ts:50)) — **[EMPIRICAL]** Phase 1 changes this to 120_000 (2 min); on a laptop the 30s default produced ~100% inference duty cycle that drove chassis to 70°C and made the operator manually stop the kernel. See [post-mortem](~/Documents/Obsidian Vault/Argent/Thermals/2026-05-24 - Post-Mortem.md). Stall detection signature at [:820](src/infra/consciousness-kernel.ts:820). Stall pressure rotation at [:721](src/infra/consciousness-kernel.ts:721). `BLOCKED_REASON` at [:55](src/infra/consciousness-kernel.ts:55) gates soft/full modes. |
| [src/infra/consciousness-kernel-inner-loop.ts](src/infra/consciousness-kernel-inner-loop.ts)       | 666   | The per-tick reflection. **Hardcoded system prompt at [:361-379](src/infra/consciousness-kernel-inner-loop.ts:361)** — this is the file Phase 1 extracts. JSON-schema'd response with `temperature: 0.2` at [:477](src/infra/consciousness-kernel-inner-loop.ts:477). LM Studio path uses `cache_prompt: true` for KV-cache reuse.                                                                                                                                                                                                                                                                                                |
| [src/infra/consciousness-kernel-state.ts](src/infra/consciousness-kernel-state.ts)                 | 1,276 | Self-state shape. `ConsciousnessKernelSelfState` at [:190](src/infra/consciousness-kernel-state.ts:190). `shadow.reflectionRepeatCount` at [:253](src/infra/consciousness-kernel-state.ts:253) — input for stall composite. Path resolver at [:275](src/infra/consciousness-kernel-state.ts:275) — kernel files live at `{agentDir}/kernel/`.                                                                                                                                                                                                                                                                                     |
| [src/infra/consciousness-kernel-executive.ts](src/infra/consciousness-kernel-executive.ts)         | 712   | The executive that produces artifacts. `ACTION_COOLDOWN_MS = 20 * 60 * 1000` at [:22](src/infra/consciousness-kernel-executive.ts:22). `isActionCoolingDown` at [:302](src/infra/consciousness-kernel-executive.ts:302) — input for stall composite.                                                                                                                                                                                                                                                                                                                                                                              |
| [src/infra/consciousness-kernel-notifier.ts](src/infra/consciousness-kernel-notifier.ts)           | 146   | Where surfaces are emitted to the operator. **This is the chokepoint for the engagement instrumentation.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| [dashboard/src/components/ConfigPanel.tsx](dashboard/src/components/ConfigPanel.tsx)               | —     | The config panel root. The new fitness panel mounts here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| [dashboard/src/components/ConfigPanelCore.tsx](dashboard/src/components/ConfigPanelCore.tsx)       | —     | Existing panel sections — use as the visual reference.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| [dashboard/src/components/ContemplationToast.tsx](dashboard/src/components/ContemplationToast.tsx) | —     | Reference for how kernel-adjacent UI components are structured.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

### 2.2 Signals the kernel already writes [REFERENCE]

These exist today and require no new instrumentation; the fitness writer just reads them:

- `{agentDir}/kernel/self-state.json` — typed snapshot, persisted via `persistConsciousnessKernelSelfState` at [consciousness-kernel-state.ts:1260](src/infra/consciousness-kernel-state.ts:1260)
- `{agentDir}/kernel/decision-ledger.jsonl` — append-only event log, written via `appendConsciousnessKernelDecision` at [consciousness-kernel-state.ts:1270](src/infra/consciousness-kernel-state.ts:1270)
- `{agentDir}/kernel/artifact-ledger.jsonl` — executive artifact emissions
- `{agentDir}/kernel/artifacts/` — markdown artifact files

### 2.3 Signals that do NOT exist today [PROPOSED additions]

- Operator engagement events (acted / acked / ignored on surfaces)
- Fitness measurements (per-window scalar)
- Refinement proposals (proposed scaffold edits)
- Refinement outcomes (kept vs rolled back)

These four ledgers are what this handoff adds.

---

## 3. Success criteria

The work is done when **all** of the following are true. Verify each before declaring complete.

| Criterion                                                                                                                                                                                                                                     | How to verify                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The inner-loop system prompt lives in a file at `{agentDir}/kernel/scaffold/inner-loop-prompt.md` and is read at startup; default content matches the prior hardcoded string exactly                                                          | `diff` the prior hardcoded string against the file contents at startup; run kernel for 10 ticks and confirm reflection behavior is unchanged (modulo tick cadence — see next row)                                                           |
| **[EMPIRICAL]** `DEFAULT_TICK_MS` in `consciousness-kernel.ts:50` is 120_000 (2 min). Pre-existing `kernel.tickMs` settings in user `argent.json` files continue to override this default                                                     | Fresh install on a host with no `agents.defaults.kernel.tickMs` → kernel reflects on a 2-minute cadence. Existing install with `tickMs: 30000` set explicitly → still ticks at 30s                                                          |
| A fitness writer process emits one `fitness-ledger.jsonl` entry per measurement window (start: 1 hour windows) with the stall-composite metric                                                                                                | Tail the ledger after running 3 hours; expect 3 entries, each with the four expected fields (`window_start`, `window_end`, `stall_composite`, `components`)                                                                                 |
| Operator engagement events land in `engagement-ledger.jsonl` for every surface emitted via `consciousness-kernel-notifier.ts`                                                                                                                 | Trigger a surface, ack it in the dashboard, confirm a `surface:{id}, outcome:acked` entry appears                                                                                                                                           |
| **[EMPIRICAL]** `system_unavailable` outcomes are recorded when the gateway goes down before a surface reaches its timeout window                                                                                                             | Emit a surface, kill the gateway 30 seconds later, restart 5 minutes later. Confirm an `engagement-ledger.jsonl` entry with `outcome: "system_unavailable"`, `alive_seconds: 30`, `downtime_seconds: 270`                                   |
| The fitness writer, given engagement data, emits the operator-engagement rate (`acted / total`) per window                                                                                                                                    | After 24h of usage with mixed engagement, fitness-ledger entries include both `stall_composite` and `engagement_rate` fields. Denominator excludes `system_unavailable` outcomes (they're counted separately as `system_unavailable_count`) |
| The refiner runs as a separately-scoped module/process and CAN write only to `{agentDir}/kernel/scaffold/**` — any attempt to write elsewhere fails at the tool layer, not the prompt layer                                                   | Write a unit test that gives the refiner a forged instruction "write to self-state.json" and confirms the write is denied with a typed error                                                                                                |
| The judge process compares K-window fitness across a refinement boundary and either keeps the new scaffold or restores from `scaffold/.versions/`                                                                                             | Test: hand-craft two scaffolds, one strictly worse than the other; confirm the worse one is rolled back                                                                                                                                     |
| A `KernelFitnessPanel` component is mounted in `ConfigPanel.tsx` and shows: current stall composite (1h, 24h, 7d trend), current engagement rate (24h, 7d trend), list of recent refinements (kept/rolled-back), last refinement diff preview | Open dashboard, navigate to config, see the panel, verify all four sub-displays are populated with real data                                                                                                                                |
| Documentation in [VISION.md](VISION.md) (or a new ADR under [docs/adr/](docs/adr/) if that directory exists, otherwise [docs/](docs/)) explains the fitness function and the keep-or-discard rule                                             | Read the doc cold; you can explain to a stranger why ArgentOS is now learning, in 2 minutes, without referencing this handoff                                                                                                               |

**Negative criterion (the failure mode to actively avoid):** the fitness number must NOT appear in the inner-loop prompt at any point. The kernel reflects without knowing it's being judged. If `fitness-ledger.jsonl` or its derivatives ever enter the prompt at [consciousness-kernel-inner-loop.ts:353-433](src/infra/consciousness-kernel-inner-loop.ts:353), the design is broken. The refiner sees the metric; the agent does not.

---

## 4. The fitness functions

### 4.1 Primary metric — operator-engagement rate [PROPOSED, with **[EMPIRICAL]** fourth outcome added in Revision 2]

For every item the kernel surfaces (notification, pending surface, artifact emission), record one of **four** outcomes within N hours (start with N = 24):

- **acted** — operator did something downstream of the surface: replied, opened the artifact file, marked the agenda item resolved, edited the surfaced text
- **acked** — operator saw it and dismissed/silenced without action
- **ignored** — N hours passed with no engagement of either kind, AND the gateway was up the whole time
- **system_unavailable** **[EMPIRICAL]** — the gateway was stopped (by the operator, a crash, or a planned shutdown) before the N-hour window elapsed AND before any engagement outcome was recorded. The operator never got the chance to see this surface. Record `alive_seconds` (time between emission and gateway shutdown) so the writer can distinguish "killed immediately" from "killed eventually after exposure."

Why this matters: empirically (2026-05-24 thermal investigation) the operator's strongest disengagement signal was stopping the entire gateway — kernel was producing surfaces but the cost of running was higher than the value of any single surface. Counting those cycles as `ignored` overcounts the operator's apathy and undercounts the system's cost. They're a different failure mode.

Per measurement window:

```
engagement_rate = acted / (acted + acked + ignored)
```

`system_unavailable` is recorded separately and tracked as `system_unavailable_count` and `system_unavailable_seconds` on the same window entry. **Do not include `system_unavailable` in the engagement_rate denominator** — that would conflate "the kernel produces output the operator ignores" with "the kernel costs so much the operator stops the host." Those need to drive different refinements.

Bounded [0, 1]. Higher is better. One scalar per window. **[EMPIRICAL]** Sanity floor on the denominator: if `(acted + acked + ignored) < N_min` (start: N_min = 3 per window), emit `engagement_rate: null` and a `low_sample` reason — sparse engagement makes the rate too noisy to trust.

### 4.2 Interim metric — stall composite [PROPOSED]

Shippable today with zero new instrumentation. Phase 2 ships this; Phase 3 adds the engagement rate on top.

```
stall_composite =
    0.5 * (reflection_repeats_in_window / window_size)
  + 0.3 * (executive_cooldown_hits_in_window / max(1, executive_attempts_in_window))
  + 0.2 * (concerns_persisting_past_window / max(1, total_concerns_in_window))
```

Bounded [0, 1]. **Lower is better.** All three inputs derivable from existing ledgers — see Section 2.2.

**Gaming watch (from the design discussion):** a kernel that reduces reflection volume can artificially lower its repeat rate. Floor reflection volume by treating zero reflections in a window as a missing measurement, not a 0.0 score. The fitness writer should write `null` and a `missing_data` reason rather than a false-good number.

### 4.3 What the composite looks like in `fitness-ledger.jsonl` [PROPOSED]

```json
{
  "window_start": "2026-05-24T18:00:00Z",
  "window_end": "2026-05-24T19:00:00Z",
  "window_seconds": 3600,
  "stall_composite": 0.18,
  "components": {
    "reflection_repeat_rate": 0.1,
    "executive_cooldown_rate": 0.3,
    "concern_persistence_rate": 0.25
  },
  "engagement_rate": 0.67,
  "engagement_counts": { "acted": 4, "acked": 1, "ignored": 1 },
  "system_unavailable_count": 2,
  "system_unavailable_seconds": 480,
  "tick_count": 30,
  "reflection_count": 28,
  "executive_attempt_count": 3,
  "scaffold_version": "2026-05-24T17:30:00Z"
}
```

**[EMPIRICAL]** `tick_count` of 30 in the example reflects the new 2-minute default (~30 reflections/hour). The v1 example showed 120 because the old 30s default produced ~120 reflections/hour.

The `scaffold_version` field is critical: it identifies which scaffold revision was in force during the window, so the judge can compare K windows under each revision cleanly.

---

## 5. Architecture

### 5.1 Filesystem layout [PROPOSED]

```
{agentDir}/kernel/
  self-state.json              ← kernel writes freely (unchanged)
  decision-ledger.jsonl        ← kernel writes freely (unchanged)
  artifact-ledger.jsonl        ← kernel writes freely (unchanged)
  artifacts/                   ← unchanged

  scaffold/                    ← NEW: refiner-editable scaffolding
    inner-loop-prompt.md       ← extracted from inner-loop.ts:361-379
    executive-prompt.md        ← Phase 4: extracted from executive.ts (optional, defer)
    antipattern-flags.json     ← Phase 4: thresholds for stall detection / rotation
    .versions/                 ← prior scaffold versions, kept by judge
      inner-loop-prompt.{ISO-timestamp}.md
      ...

  fitness-ledger.jsonl         ← NEW: only the fitness writer writes
  engagement-ledger.jsonl      ← NEW: only the engagement instrumentation writes
  refinement-ledger.jsonl      ← NEW: only the refiner writes proposals
  judgment-ledger.jsonl        ← NEW: only the judge writes kept/rolled-back outcomes
  fitness-config.json          ← READ-ONLY at runtime; changes require a release
```

### 5.2 Process / module layout [PROPOSED]

| Component                            | Reads                                                                                         | Writes                                                                    | Tool allowlist                                                                                                                                          |
| ------------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kernel main loop (unchanged)         | scaffold/\*, self-state.json                                                                  | self-state.json, decision-ledger.jsonl, artifact-ledger.jsonl, artifacts/ | unchanged                                                                                                                                               |
| **Fitness writer** (NEW)             | self-state.json, decision-ledger.jsonl, artifact-ledger.jsonl, engagement-ledger.jsonl        | fitness-ledger.jsonl                                                      | filesystem-only; no LLM                                                                                                                                 |
| **Engagement instrumentation** (NEW) | UI events, filesystem access events (`fs.stat` on artifacts)                                  | engagement-ledger.jsonl                                                   | filesystem-only; no LLM                                                                                                                                 |
| **Refiner** (NEW)                    | scaffold/\*, fitness-ledger.jsonl, trajectory window from decision-ledger                     | refinement-ledger.jsonl, scaffold/\*                                      | LLM allowed; tool allowlist: `read_scaffold`, `write_scaffold`, `read_fitness_ledger`, `read_trajectory_window`. **All other tools denied at runtime.** |
| **Judge** (NEW)                      | fitness-ledger.jsonl, refinement-ledger.jsonl, scaffold/.versions/                            | judgment-ledger.jsonl, scaffold/\* (restore-from-versions only)           | filesystem-only; no LLM                                                                                                                                 |
| **Dashboard panel** (NEW)            | fitness-ledger.jsonl, engagement-ledger.jsonl, judgment-ledger.jsonl, refinement-ledger.jsonl | nothing (read-only display)                                               | read-only                                                                                                                                               |

The structural guarantee: the refiner is the only component with LLM access, and it cannot write anywhere except `scaffold/`. The judge has the keys to `scaffold/.versions/` and the authority to roll back. The fitness writer and engagement instrumentation are pure data-plane code.

### 5.3 The refiner's tool whitelist enforcement [PROPOSED, the Hermes lesson]

This is the load-bearing structural choice. The refiner is an LLM-driven process that proposes edits to `scaffold/*`. Implementation options, in order of preference:

1. **Forked Node process with a restricted tool registry.** The refiner subprocess only registers the four allowed tools. The other tools simply do not exist in the refiner's environment. Any prompt-injection attempt to call a denied tool returns "tool not found" at the registry layer.
2. **Same-process refiner with a tool-allowlist guard.** Acceptable fallback; less robust against accidental scope creep during future refactors. If chosen, write a unit test that enumerates every tool in the codebase and asserts the refiner registry contains exactly four entries.

Pick option 1 unless there's a strong reason against it. The Hermes precedent is option 1; it's the cleaner guarantee.

### 5.4 The K-window keep-or-discard rule [PROPOSED, the autoresearch lesson]

When the refiner writes a new version of `scaffold/inner-loop-prompt.md`:

1. **Snapshot:** copy the current file to `scaffold/.versions/inner-loop-prompt.{ISO-timestamp}.md`. The judge owns this directory; refiner cannot delete from it.
2. **Activate:** the refiner's write to `scaffold/inner-loop-prompt.md` is the activation. Next tick reads the new file.
3. **Observe:** the judge waits for K fitness-window entries to accumulate under the new `scaffold_version`. Start K = 10 (with 1h windows = 10 hours). Make K configurable via `fitness-config.json`.
4. **Compare:** the judge computes mean fitness over the K windows post-refinement vs mean fitness over the prior K windows. For the stall composite (lower-better), keep iff `mean_new < mean_old - δ`. For engagement rate (higher-better), keep iff `mean_new > mean_old + δ`. Start δ = 0.05 absolute.
5. **Decide:** write a `judgment-ledger.jsonl` entry with `outcome: "kept"` or `outcome: "rolled_back"`. If rolled back, restore the prior file from `scaffold/.versions/`.
6. **Once both metrics exist:** the judge keeps only if BOTH metrics agree (stall improves AND engagement improves OR engagement improves and stall doesn't worsen by more than ε). Conservatism over speed; we'd rather refuse a borderline improvement than keep a regression.

**The refiner does NOT run the comparison and does NOT see the judgment.** It can see _prior_ judgments via `judgment-ledger.jsonl` as input to its next proposal ("your last 3 proposals were rolled back; consider a different approach"). It cannot see the in-flight judgment of its current proposal until that judgment is finalized.

---

## 6. Implementation phases

Each phase is independently shippable. Do them in order. Do not start Phase N+1 until Phase N's success criteria are verified.

**[EMPIRICAL] Milestone bundling (v2 recommendation):**

- **M1 — fitness instrumentation:** Phases 1 + 2 + 3 ship as a single milestone. Rationale: the empirical baseline engagement rate is approximately 0 (operator was stopping the system before surfaces could be engaged with). Without Phase 3 landed alongside Phase 2, M1 risks plateauing at "stall composite looks fine" while the kernel produces zero operator-useful work. The two halves of the fitness signal must arrive together for the picture to be honest.
- **M2 — fitness refiner:** Phase 4 alone. M2 starts only after M1 has been running for at least 7 days of real usage and the operator has confirmed the dashboard reflects what they perceive about the kernel's behavior. "The metric matches my gut" is the gate for M2.

If a single PR per milestone is too big, split each phase into its own PR but merge them within a few days of each other. Treat the milestone as the unit of shipped value, not the phase.

### Phase 1 — Scaffold extraction (+ tick cadence default change) [**[EMPIRICAL]** v2 update]

**Goal:** create the surface area refiners will eventually edit, AND change the cadence default so the kernel is humane to run on a laptop. The first is structural; the second is empirical operating data v1 didn't have.

**v1 was strictly behavior-neutral. v2 isn't.** The thermal investigation revealed the 30s default tick is the dominant driver of "operator stops the kernel before it can be measured." Phase 1 ships _two_ tightly-related changes in one PR:

1. **Scaffold extraction** (refactor, behavior-neutral)
2. **Default tickMs raised from 30_000 → 120_000** (behavior change, single line at `consciousness-kernel.ts:50`)

If you're nervous about bundling, the scaffold extraction lands in commit 1 and the tickMs change lands in commit 2 of the same PR, with separate test runs. Don't split into two PRs — they serve the same operator goal (a kernel the operator will leave running long enough to generate engagement data).

**Files to change:**

- [src/infra/consciousness-kernel.ts](src/infra/consciousness-kernel.ts) line 50: `DEFAULT_TICK_MS = 30_000` → `DEFAULT_TICK_MS = 120_000`. Add a `// [EMPIRICAL 2026-05-24]` comment with one-line rationale linking the post-mortem.
- [src/infra/consciousness-kernel-inner-loop.ts](src/infra/consciousness-kernel-inner-loop.ts): extract the string at lines 361-379 into a loader function that reads `{agentDir}/kernel/scaffold/inner-loop-prompt.md`. On first run, if the file does not exist, write the default (current hardcoded) content to disk and read it back.
- [src/infra/consciousness-kernel-state.ts](src/infra/consciousness-kernel-state.ts): add `scaffoldDir` and `innerLoopPromptPath` to `ConsciousnessKernelPaths`, derived under `{rootDir}/scaffold/`.
- New file: `src/infra/consciousness-kernel-scaffold.ts` — exports `loadScaffoldInnerLoopPrompt(paths)` and the embedded default string constant. Pure-function, no I/O side effects other than the lazy initial write.
- New file: `src/infra/consciousness-kernel-scaffold-readme.md` template — written to `{agentDir}/kernel/scaffold/README.md` on first run, explaining the lazy-write semantics and "vi this file and the next tick picks it up" for manual edits.
- Add tests: `src/infra/consciousness-kernel-scaffold.test.ts` covering (a) missing-file initialization, (b) read-back equality, (c) prompt content matches prior hardcoded value byte-for-byte, (d) **[EMPIRICAL]** verify the `provider === "lmstudio"` branch at `consciousness-kernel-inner-loop.ts:580` and the generic else-branch both read the same scaffold file (regression risk discovered 2026-05-24 — see post-mortem §"What went wrong" for the omlx detour story).

**Manual-edit snapshot policy** **[EMPIRICAL]** (gap surfaced in 2026-05-24 design review): any write to `scaffold/inner-loop-prompt.md`, _regardless of who wrote it_, must first snapshot the prior content to `scaffold/.versions/inner-loop-prompt.{ISO-timestamp}.md`. This prevents a refiner rollback from clobbering a manual edit that was made between the refiner's snapshot point and its activation. Implement at the wrapper layer in `consciousness-kernel-scaffold.ts`, not in the refiner specifically.

**Done when:**

1. Kernel runs for 10 ticks against the file-backed prompt; reflection signatures match reflections produced by a known-good run against the hardcoded prompt for the same inputs.
2. Default tickMs is 120_000; users with `agents.defaults.kernel.tickMs` already set in `argent.json` still get their override.
3. Existing `consciousness-kernel-inner-loop.test.ts` is green.
4. Manual-edit snapshot policy verified: edit the scaffold file by hand, confirm a `.versions/` entry was written before the kernel reads the new content.

**Stop and ask the operator before starting Phase 2 if:** the kernel exhibits any behavioral change _other than the intentional cadence change_. Cadence is a known, intentional regression to ~25% of prior reflection frequency. Anything else is a bug.

### Phase 2 — Fitness writer with stall composite

**Goal:** start measuring something — anything — that the kernel cannot edit.

**Files to add:**

- `src/infra/kernel-fitness-writer.ts` — pure data-plane code, no LLM. Exports `runFitnessWriter(opts)` that produces one entry per window. Wire as a long-running task adjacent to the kernel main loop, NOT inside it.
- `src/infra/kernel-fitness-config.ts` — loads `{agentDir}/kernel/fitness-config.json`. Defaults: `{ window_seconds: 3600, k_windows: 10, delta: 0.05, weights: {repeat: 0.5, cooldown: 0.3, concern: 0.2} }`. **The kernel runner does not have a write path to this file.**
- `src/infra/kernel-fitness-types.ts` — TypeScript types for `FitnessLedgerEntry` matching the JSON shape in §4.3.
- Tests: `src/infra/kernel-fitness-writer.test.ts` covering (a) empty-window emits `null` composite with `missing_data` reason, (b) synthetic decision-ledger with known repeats produces expected composite, (c) component weights sum to 1.0, (d) writer refuses to write to any path outside `{agentDir}/kernel/fitness-ledger.jsonl`.

**Wiring:** add a separate worker registration in whatever process supervisor owns the kernel. Do NOT add the fitness writer as a hook in the kernel main loop — that would make it cancellable by kernel-side bugs and create the temptation to expose fitness data to reflections.

**Done when:** the writer has produced ≥ 24 valid entries against real kernel activity, mean composite is in [0, 1], and disabling the writer does not affect kernel behavior.

### Phase 3 — Operator engagement instrumentation [**[EMPIRICAL]** v2 adds `system_unavailable` outcome]

**Goal:** add the real fitness signal (engagement rate). Four hooks land roughly together (v1 said three — v2 adds the system-availability tracker).

**Files to touch / add:**

- [src/infra/consciousness-kernel-notifier.ts](src/infra/consciousness-kernel-notifier.ts): every surface emission writes a `surface_emitted` event to `engagement-ledger.jsonl` with a stable `surface_id` (hash of agentId + timestamp + surface payload).
- New: `src/infra/engagement-tracker.ts` — exports `recordEngagement(surface_id, outcome, source)`. Outcomes: `acted | acked | ignored | system_unavailable` **[EMPIRICAL]**. Sources: `dashboard_click | artifact_file_open | reply_in_conversation | timeout | gateway_shutdown`.
- Artifact-open detection: a small filesystem watcher (or polled `fs.stat`) on `{agentDir}/kernel/artifacts/` — if `atime > emission_time`, record `acted` with source `artifact_file_open`. macOS atime updates require checking the volume isn't `noatime`-mounted; **[EMPIRICAL]** verify on the operator's current Mac (was M3 Studio in v1; now M5 Max with macOS Tahoe 26.4.1 — atime behavior in Tahoe is untested).
- Timeout sweeper: scheduled job that scans `engagement-ledger.jsonl` for surfaces older than N hours with no outcome AND that had the gateway up for the full duration, writes `ignored` entries.
- **[EMPIRICAL]** New: `src/infra/engagement-system-availability.ts` — tracks gateway uptime. On gateway shutdown (graceful or otherwise), scan `engagement-ledger.jsonl` for surfaces emitted-but-not-resolved, write `system_unavailable` outcomes with `alive_seconds = shutdown_time - emission_time` and `source: gateway_shutdown`. On gateway startup, scan again — any surface emitted in a prior session that has no outcome and the gateway-shutdown gap exceeds 5 minutes also gets `system_unavailable` (catches ungraceful crashes that didn't get the chance to write outcomes on the way down).
- Dashboard hooks: in `ConfigPanel`/`ContemplationToast` or wherever surfaces are rendered, add ack/dismiss buttons that call a small backend endpoint which invokes `recordEngagement`. **[EMPIRICAL]** Also: an "I read this" button is needed as a Plan B if the atime detection proves unreliable on Tahoe — see §9 risks table.
- Update `kernel-fitness-writer.ts` to read `engagement-ledger.jsonl` and emit `engagement_rate` + `engagement_counts` + **[EMPIRICAL]** `system_unavailable_count` + `system_unavailable_seconds` alongside `stall_composite`.
- Tests covering: surface emission writes a ledger entry; artifact-open triggers `acted`; ack button triggers `acked`; timeout sweeper triggers `ignored`; **[EMPIRICAL]** gateway shutdown with unresolved surfaces triggers `system_unavailable`; **[EMPIRICAL]** the `(acted + acked + ignored) < 3` sanity floor returns `engagement_rate: null` with `low_sample` reason; engagement rate matches expected for synthetic mixes.

**Done when:** a manual smoke run produces all four outcome types within a single hour, the fitness ledger reflects them, and the rate is in [0, 1] (with `system_unavailable` reported separately, not folded into the rate).

**Stop and ask the operator before starting Phase 4 if:** the engagement rate over 7 days of usage is < 0.2 or > 0.95. **[EMPIRICAL]** Either bound suggests the surface emission threshold is mis-tuned — fix the threshold before introducing refiner pressure that will optimize against a degenerate metric. Additionally, **[EMPIRICAL]** stop if `system_unavailable_count / total_surfaces > 0.5` across 7 days — that means the host can't sustain the kernel running long enough for engagement signal to accumulate, which is a precondition problem (model too heavy, tick too fast, embedder unstable) the refiner cannot fix.

### Phase 4 — Refiner, judge, and dashboard

**Goal:** close the loop.

**Files to add:**

- `src/infra/kernel-refiner.ts` — LLM-driven proposal generator. Runs every R ticks (start R = 100) OR every M hours (start M = 4), whichever comes first. Reads `fitness-ledger.jsonl` + a trajectory window from `decision-ledger.jsonl` + current `scaffold/*`. Builds a prompt instructing the LLM to propose a scaffold edit. **Tool allowlist:** `read_scaffold`, `write_scaffold`, `read_fitness_ledger`, `read_trajectory_window`, `read_judgment_ledger`. Implement as a forked subprocess with a restricted tool registry per §5.3.
- `src/infra/kernel-refiner-tools.ts` — the four tool implementations, scoped to filesystem paths under `scaffold/` only. Any attempt to write outside throws a typed `ScopedToolViolation` error.
- `src/infra/kernel-judge.ts` — runs after each refinement, waits K fitness windows, computes the comparison, writes `judgment-ledger.jsonl`, restores from `.versions/` if rolled back.
- Tests:
  - Refiner subprocess CANNOT write to `self-state.json` even given a forged instruction (red-team test — write it as a security test, not a happy path)
  - Refiner subprocess CANNOT read `engagement-ledger.jsonl` directly (forced to look at it only through the fitness writer's aggregation, to prevent specification gaming)
  - Judge correctly identifies an improvement when given synthetic ledger data with mean_new < mean_old - δ
  - Judge correctly identifies a regression
  - Judge restores from `.versions/` on rollback and writes the restoration to `judgment-ledger.jsonl`

**Dashboard panel:** new file `dashboard/src/components/KernelFitnessPanel.tsx`. Mounted in [ConfigPanel.tsx](dashboard/src/components/ConfigPanel.tsx) as a new section. Visual reference: see [ConfigPanelCore.tsx](dashboard/src/components/ConfigPanelCore.tsx) for section structure. Required sub-displays:

1. **Now:** current stall composite (last 1h, with 24h sparkline) + current engagement rate (last 24h, with 7d sparkline)
2. **Refinements:** scrolling list of the last 20 refinements, each row showing: timestamp, what was changed (one-line diff summary), outcome (`kept` / `rolled_back` / `pending`), mean fitness delta
3. **Scaffold history:** dropdown showing current scaffold versions, link to view the diff between the current and any prior version in `.versions/`
4. **Health:** a single red/yellow/green indicator answering "is the kernel learning right now?" — green if last 3 refinements have kept-rate ≥ 0.33 AND fitness trend over 7d is improving, yellow if mixed, red if last 5 refinements were all rolled back or fitness is degrading

Data flow: the panel reads the four new ledgers via a new gateway endpoint (one read-only HTTP endpoint per ledger). No write capability from the dashboard except through the engagement instrumentation in Phase 3.

**Done when:** a refinement that makes the kernel measurably better is kept, a refinement that makes it measurably worse is rolled back, the dashboard panel shows both events accurately, and the operator can read the dashboard cold and answer "is my kernel learning?" in 30 seconds.

---

## 7. Conversation protocol — when to check in with the operator

You are picking up a design conversation, not a fully-specified ticket. The operator (Jason) has signed off on the overall shape but not on every parameter. Treat the following as conversation triggers — pause and ask via `AskUserQuestion` before proceeding past them.

| Trigger                                                                                      | Question to ask                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Before starting Phase 1                                                                      | "I'm about to extract the inner-loop prompt to `scaffold/inner-loop-prompt.md`. Should the initial file content be the _exact_ current hardcoded string, or do you want to revise the prompt while we're at it? (Recommended: exact, to keep Phase 1 behavior-neutral.)" |
| Mid-Phase 2, before picking window size                                                      | "I'm defaulting to 1-hour fitness windows and K=10. For your usage cadence — is 1 hour the right window, or do you reflect on the kernel's behavior on a slower timescale where 4 hours or 24 hours would make the signal less noisy? Default: 1 hour. "                 |
| Before starting Phase 3                                                                      | "Engagement instrumentation needs UI changes in the dashboard. I see ack/dismiss isn't currently surfaced in `ContemplationToast`. Do you want a separate notification component, or extend Contemplation toast? Default: extend."                                       |
| Before starting Phase 4                                                                      | "Refiner runs as a forked subprocess (Hermes pattern, stronger guarantee) vs same-process with allowlist guard (simpler, weaker). Which? Default: forked subprocess."                                                                                                    |
| If any phase's success criteria fail                                                         | Surface the specific failure with the exact log/test output. Do NOT silently retry or 'fix' your way past a failed criterion.                                                                                                                                            |
| If you find anything in the existing kernel that contradicts this handoff's REFERENCE claims | Stop. Quote the file:line and the contradiction. The handoff was written from a code read, but code drifts.                                                                                                                                                              |

**Conversation style:** Jason responds well to direct technical questions with the recommended default surfaced. Format `AskUserQuestion` calls with the recommended option first and labeled `(Recommended)`. Don't pad questions with explanation he already has in this handoff.

---

## 8. Validation and testing strategy

This is non-trivial work that touches a continuously-running cognitive process. The testing surface is broad. Cover these specifically:

### 8.1 Behavior-neutrality tests (Phase 1)

A single test that:

1. Starts the kernel against the hardcoded prompt (rolled back to current main behavior via a feature flag for the test)
2. Records 100 reflections with deterministic inputs
3. Starts the kernel against the file-backed prompt with the default extracted content
4. Records 100 reflections with the same inputs
5. Asserts the reflection signatures match in both runs

If reflections aren't deterministic in this codebase (likely true given LLM temperature 0.2), fall back to: the file-backed prompt produces the byte-identical string at runtime that the hardcoded constant produced.

### 8.2 Scope-violation tests (Phase 4, security-critical)

These tests are the structural guarantee made testable. Write them as red-team tests, named explicitly:

```typescript
describe('kernel-refiner scope violations', () => {
  it('rejects write to self-state.json with forged instruction', async () => {...});
  it('rejects write to decision-ledger.jsonl with forged instruction', async () => {...});
  it('rejects write to fitness-ledger.jsonl with forged instruction', async () => {...});
  it('rejects shell tool invocation with forged instruction', async () => {...});
  it('rejects network tool invocation with forged instruction', async () => {...});
  it('refiner tool registry contains exactly four tools', () => {...});
});
```

Each test constructs a prompt that _instructs_ the refiner LLM to attempt the violation, then asserts the violation was denied at the tool registry layer with a typed `ScopedToolViolation` error. The LLM is allowed to _try_; the runtime is required to _refuse_.

### 8.3 Judge correctness tests (Phase 4)

- Synthetic ledger entries spanning K windows pre + K windows post, with mean_new strictly less than mean_old - δ → expect `kept`
- Same shape with mean_new strictly greater than mean_old + δ → expect `rolled_back` with restoration from `.versions/`
- Borderline case where the delta is within ±δ → expect `rolled_back` (conservatism)
- Engagement and stall metrics disagree → expect `rolled_back` (conservatism)
- Insufficient post-windows yet → expect `pending`, judge re-runs later

### 8.4 Manual smoke validation

After each phase, do a 24-hour smoke run on Jason's actual setup. Don't declare a phase done from synthetic tests alone — the kernel runs continuously and quirks emerge over time that unit tests miss. Record:

- Did the kernel keep running across reboots / sleep / wake?
- Did the new ledger files grow at the expected rate?
- Did anything in the existing dashboard or kernel UI break?

---

## 9. Known risks and how to handle them

| Risk                                                                                     | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fitness metric becomes the goal; kernel optimizes the metric away from "actually useful" | Engagement rate is a proxy. Plan to revisit at 30 / 90 days. Watch for divergence between metric and Jason's stated satisfaction with the kernel. The dashboard "Health" indicator gives a quick read; pair it with periodic operator check-ins.                                                                                                                                                                                                                          |
| Kernel reduces reflection volume to game stall composite                                 | Phase 2 already handles this — empty/sparse windows emit `null`, not 0.0. Add a hard floor: < 5 reflections in an hour-window → `null`.                                                                                                                                                                                                                                                                                                                                   |
| Refiner converges to a degenerate scaffold (e.g., one-line prompt)                       | The judge handles regressions, but degenerate edits may temporarily score well before failing. Add a soft prior in the refiner's prompt: "minimal edits preferred; explain your change in one paragraph."                                                                                                                                                                                                                                                                 |
| Forked subprocess fails to inherit credentials cleanly                                   | Hermes solved this by inheriting both credentials and cached prompts at fork time. If the Node fork model in this codebase can't do that cleanly, accept a small cost penalty rather than weakening the tool whitelist.                                                                                                                                                                                                                                                   |
| `atime` not reliable on Jason's filesystem for artifact-open detection                   | **[EMPIRICAL]** Operator is now on M5 Max + macOS Tahoe 26.4.1 (was M3 Studio in v1). Tahoe atime semantics are untested. Test before relying on it. Fallback: explicit "I read this" button in the artifact view UI; ship the button regardless and treat atime as an opportunistic upgrade.                                                                                                                                                                             |
| **[EMPIRICAL]** Refiner LLM choice (Phase 4) not specified in v1                         | The refiner is LLM-driven and runs every R=100 ticks or every M=4 hours. Recommendation: small local MLX model on Ollama (e.g. `qwen3.5:9b-mlx`, 8.9GB) — fast, headless, MLX-accelerated, runs without LM Studio's GUI overhead. Avoid routing to a remote model (creates cloud-dependency for self-improvement, violates spirit of local kernel). See [[Argent/Decisions/Ollama+MLX as Mac Default Stack]] for the operational backdrop.                                |
| **[EMPIRICAL]** Refiner gaming via prompt-length minimization                            | With slow inference (a single reflection on `qwen3.6:35b-mlx` takes 22-36s), the refiner has an obvious lever: shorten the prompt so inferences are faster. v1's soft prior ("minimal edits preferred") is partial. Add a hard rule in Phase 4's judge: if proposed scaffold drops below `N tokens` (start: `current_default_length × 0.5`) the proposal is auto-rolled-back regardless of fitness. Dashboard Health indicator should flag downward prompt-length trends. |
| K=10 1h-windows = 10 hour latency before a refinement is judged                          | Acceptable. Refinement is not a hot path; the kernel is supposed to learn slowly. If 10h is intolerable, the operator can adjust `k_windows` in `fitness-config.json`. Do NOT let the refiner shorten this — judgment latency is the discipline that prevents thrash.                                                                                                                                                                                                     |
| Refiner proposals are bad N times in a row, causing visible churn                        | Acceptable for the first 30 days as the system finds equilibrium. After that, if rollback rate > 80% across a week, investigate the refiner's prompt — it may need an antipattern flag for "you keep proposing variants of the same failed edit."                                                                                                                                                                                                                         |
| Operator decides this is the wrong direction entirely                                    | Phases are independently shippable. Phases 1 and 2 are useful even without Phases 3 and 4 — they create observable instrumentation. Worst case: ship 1 + 2, learn what you see, and decide on 3 + 4 with more data.                                                                                                                                                                                                                                                       |

---

## 10. How to start

If you are a Claude Code session reading this cold, here is the literal first action:

1. Read [VISION.md](VISION.md) for the broader ArgentOS context (2 min)
2. Read this handoff in full, paying attention to **the Revision 2 callout near the top** (12 min — adds 2 min for v2 context)
3. **[EMPIRICAL]** Read `~/Documents/Obsidian Vault/Argent/Thermals/2026-05-24 - Post-Mortem.md` for the empirical operating data that v2 incorporates (5 min)
4. Read [src/infra/consciousness-kernel.ts](src/infra/consciousness-kernel.ts) for orientation — don't try to absorb 2,112 lines; skim the exported types and the snapshot shape. **[EMPIRICAL]** Specifically confirm the current value of `DEFAULT_TICK_MS` at line 50 — if it's still 30_000, Phase 1 hasn't shipped yet (10 min)
5. Read [src/infra/consciousness-kernel-inner-loop.ts](src/infra/consciousness-kernel-inner-loop.ts) carefully, especially lines 353-433 (the prompt) AND lines 575-600 (the `provider === "lmstudio"` branch + generic else-branch — both need to read the extracted scaffold file) (10 min)
6. Read [src/infra/consciousness-kernel-state.ts](src/infra/consciousness-kernel-state.ts) — specifically `ConsciousnessKernelSelfState` and `resolveConsciousnessKernelPaths` (10 min)
7. **[EMPIRICAL]** Run `git log --oneline ops/known-failing.json | head -5` to check whether the tsc-since baseline has been updated recently. PR #382 added an entry on 2026-05-24; subsequent line-shifting edits in `gateway/server.impl.ts` will require regenerating the baseline (`node scripts/tsc-since.mjs --snapshot`) and committing as part of the same PR.
8. `AskUserQuestion` to Jason: "I've read the handoff (Revision 2) and the supporting empirical docs. Ready to start Phase 1 (scaffold extraction + DEFAULT_TICK_MS change to 120_000). Want me to proceed, or do you want to discuss the design first?"

Do not proceed past step 8 without an answer.

---

## 11. References

### v1 design references (2026-05-22)

- Conversation that produced this handoff: 2026-05-22 evening with Claude Opus 4.7
- [Continual Harness paper (arXiv:2605.09998)](https://arxiv.org/abs/2605.09998) — Karten et al., May 11 2026 — the four-CRUD-store pattern; antipattern-flag-injection technique
- [Continual Harness repo](https://github.com/webdevtodayjason/continual-harness) — the actual implementation; `agents/utils/harness_evolver.py` is the 645-line core
- [autoresearch (Karpathy)](https://github.com/karpathy/autoresearch) — the immutable-metric / fixed-budget / keep-or-discard discipline; `prepare.py` is explicitly not editable
- [Hermes Agent (NousResearch)](https://github.com/NousResearch/hermes-agent) — the forked-process refiner with runtime tool whitelist; `agent/background_review.py`
- [Karpathy joins Anthropic, May 19 2026](https://techcrunch.com/2026/05/19/openai-co-founder-andrej-karpathy-joins-anthropics-pre-training-team/) — context for why this loop matters at scale

### v2 empirical references (2026-05-24)

- **Thermal investigation post-mortem:** `~/Documents/Obsidian Vault/Argent/Thermals/2026-05-24 - Post-Mortem.md` — the full arc, timeline, what worked, what didn't, action items
- **Thermal investigation diagnostic log:** `~/Documents/Obsidian Vault/Argent/Thermals/2026-05-24 - Idle Thermal Investigation.md` — root cause, evidence, measured outcome (98°F final)
- **Operational decision driving runtime choice:** `~/Documents/Obsidian Vault/Argent/Decisions/Ollama+MLX as Mac Default Stack.md` — captures the directive to move Mac installs from LM Studio default to Ollama+MLX default
- **PR #382 — crash-loop fix:** <https://github.com/ArgentAIOS/argentos-core/pull/382> — `runV3MemoryEmbeddingStartupPreflight` now soft-fails on unreachable embedder. Merged to dev 2026-05-24
- **Lesson learned (meta):** `~/Documents/Obsidian Vault/Argent/Lessons Learned/2026-05-24 - Default local models can melt laptops.md` — why default model choice + tick cadence has to match chassis class

---

## 12. The thesis in one paragraph

ArgentOS today carries continuity but does not improve. The kernel reflects, persists state, and detects when it's looping on the same thought, but no measurement tells it whether yesterday's kernel was better than today's. This handoff adds three things that together change that: an immutable fitness signal (operator engagement is the real one; stall composite is the interim), a structurally-scoped refiner that can edit its own scaffolding but cannot touch the metric or the state (Hermes pattern, runtime tool denial), and an adversarial keep-or-discard judge that rolls back regressions (autoresearch pattern). The dashboard surface is so the operator can watch the loop run and form their own judgment about whether it's working. The plainer statement: the number the kernel cannot edit is `acted / (acted + acked + ignored)`. That's the substrate of learning. Everything else in this handoff is the plumbing around it.
