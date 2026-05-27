# HANDOFF — System Health Panel (AI-tuned local-LLM advisor)

**Created:** 2026-05-24
**Authors:** operator (Jason) + Claude Opus 4.7
**Picks up from:** the 2026-05-24 thermal investigation arc (PRs #382, #384, #385; issue #386). No prior implementation work on this feature.
**Companion handoff:** [HANDOFF-kernel-fitness.md](HANDOFF-kernel-fitness.md) — the System Health panel is independent of the kernel-fitness work, but they share a dashboard surface (`ConfigPanel.tsx`) and a structural philosophy (instrumentation first, then suggestions).

> Tags: **[REFERENCE]** (verified file/line), **[PROPOSED]** (design choice from the 2026-05-24 scoping conversation, may change), **[ASSUMED]** (needs validation in implementation).

---

## 0. TL;DR

Today, ArgentOS exposes no in-product surface for "how is my system doing thermally + which models am I running + what should I tune to improve things." The 2026-05-24 thermal investigation revealed that:

- The defaults that ship can be **hostile to a laptop** (dense 27B local model + 30s tick → sustained inference heat → operator stops the system)
- Recovery required **manual investigation** at the shell — reading `kernel_task` %, inspecting `argent.json`, comparing model sizes, swapping config
- A user with less patience would just give up and decide ArgentOS doesn't work on their hardware

This handoff adds a **System Health panel** in the dashboard's `ConfigPanel.tsx` that surfaces:

1. **What's running** — kernel state, configured local model, active runtime (Ollama / LM Studio / omlx), thermal indicators
2. **How it's doing** — `kernel_task` % proxy, reflection cadence vs duty cycle, recent heat-related events
3. **What to change** — AI-generated suggestions tailored to the operator's hardware, current config, and observed behavior

Ship in three phases:

- **M1 — Read-only display.** Just show current state. No suggestions yet. ~1-2 days.
- **M2 — Rule-based suggestions.** Static rules ("if kernel_task > 20% sustained AND localModel is dense 27B+, suggest MoE 35B-A3B"). No LLM call. ~1 day.
- **M3 — AI-tuned suggestions.** LLM call that takes a full system snapshot and emits personalized, prose-explained tuning advice. ~3-5 days.

A future M4 (auto-apply tuning with confirmation) is out of scope here.

---

## 1. Why this work exists

The 2026-05-24 thermal investigation ([Argent/Thermals/2026-05-24 - Post-Mortem](../Documents/Obsidian Vault/Argent/Thermals/2026-05-24 - Post-Mortem.md)) produced a specific result: on a MacBook Pro M5 Max, chassis went from 88°F idle → 147–157°F when Gateway ran. Root cause was a dense 27B local model fired every 30s by the consciousness kernel. Fix was config-level (swap to MoE on Ollama+MLX) and code-level (graceful preflight fallback, idle-activity-gate).

The user (Jason) was able to debug this because he has deep system knowledge. **A typical operator would not have been.** They would have seen "ArgentOS makes my Mac hot" and uninstalled.

What's missing today:

- No in-app visibility into thermal state (`kernel_task` % isn't surfaced)
- No in-app view of "which local model is the kernel using right now"
- No in-app comparison between configured cadence and observed inference cost
- No suggestion engine that knows the operator's hardware class and recommends defaults

This panel fills those gaps. It is not the same project as the kernel-fitness handoff — that one builds _learning_ infrastructure for the kernel itself. This one builds _operator-visible diagnostics + advisor_ for the system around the kernel. They share `ConfigPanel.tsx` real estate but otherwise touch different code.

---

## 2. Current state — surfaces and signals you'll touch [REFERENCE]

### 2.1 Dashboard panel scaffolding

| File                                                                                                         | What it does                                                                                                           |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| [dashboard/src/components/ConfigPanel.tsx](dashboard/src/components/ConfigPanel.tsx)                         | Root config panel. Mount point for new sections. The kernel-fitness handoff also mounts here for `KernelFitnessPanel`. |
| [dashboard/src/components/ConfigPanelCore.tsx](dashboard/src/components/ConfigPanelCore.tsx)                 | Existing panel sections — visual reference for layout, headers, sub-section structure.                                 |
| [dashboard/src/components/lmStudioDropdown.helpers.ts](dashboard/src/components/lmStudioDropdown.helpers.ts) | Existing local-runtime model picker. The "running models" sub-display in System Health can borrow patterns.            |

### 2.2 Data sources we can read today [REFERENCE]

**System / hardware signals (macOS-specific in M1; Linux/Windows added later):**

| Signal                    | How to read                                                                                           | Caveat                                                                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `kernel_task` CPU %       | parse `top -l 2 -n 5 -o cpu -stats pid,command,cpu \| grep kernel_task`                               | macOS only; ~50ms read; the headline thermal-throttle indicator                                                                |
| Top CPU consumers         | parse `top -l 2 -n 10 -o cpu`                                                                         | macOS only; cheap                                                                                                              |
| Free memory               | `vm_stat` parse, or `os.freemem()`                                                                    | cross-platform                                                                                                                 |
| Disk free                 | `statfsSync(homedir)`                                                                                 | already used in `server-health-checks.ts:199`                                                                                  |
| Battery / AC power        | `pmset -g batt` parse                                                                                 | macOS only; relevant for "do less work on battery" suggestions                                                                 |
| Active LLM runtimes       | port-probe 11434 (Ollama), 1234 (LM Studio), 8000 (omlx)                                              | matches the existing `server-health-checks.ts:pingOllama` pattern                                                              |
| Loaded models per runtime | `ollama list` CLI or `ollama` API `/api/tags`; LM Studio `/v1/models`; omlx `/v1/models` with API key | the answer "what's actually warm in GPU memory right now" is harder — need ollama API `/api/ps` for active models specifically |

**ArgentOS state signals (already exist):**

| Signal                                                            | Source                                                                                                                              |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Kernel snapshot (tick count, last reflection, focus, wakefulness) | [src/infra/consciousness-kernel.ts](src/infra/consciousness-kernel.ts) `getConsciousnessKernelSnapshot()` — already exposed         |
| Kernel config (tickMs, localModel, idleActivityGateMinutes)       | `~/.argent/argent.json` → `agents.defaults.kernel`                                                                                  |
| Last reflection skip reasons                                      | [`~/.argent/logs/gateway.log`](~/.argent/logs/gateway.log) tail; look for `consciousness kernel: reflection skipped` with `reason:` |
| Embedder reachability                                             | `server-health-checks.ts:runHealthCheck` result includes `ollamaReachable`, `localRuntimeProvider`                                  |
| Active embedding/chat model in use right now                      | gateway emits `[model-router] PASSTHROUGH/ROUTED tier=X → provider/model` log lines — tail to derive a "what just ran" view         |

### 2.3 Hardware-class detection [PROPOSED]

The suggestion engine needs to know what kind of Mac the operator is on (laptop vs desktop, M-series tier). Detect via:

- `sysctl -n machdep.cpu.brand_string` → "Apple M5 Max" / "Apple M3 Ultra" / etc.
- `sysctl -n hw.memsize` → total RAM
- `system_profiler SPHardwareDataType -json` → model name like "MacBookPro18,4" or "Mac14,14" (laptop vs desktop discoverable from prefix)
- `/Users/sem/Documents/Obsidian Vault/Jason's Development/Mac Laptop Thermal Management.md` already encodes per-chassis recommendations; the suggestion engine can incorporate that table

**Privacy note:** all hardware reads stay local. Nothing sent over the network in M1/M2. M3's optional remote-LLM path (if the operator chooses it) only ships the snapshot to the configured AI provider; cache the prompt content for transparency.

---

## 3. Success criteria

Done when **all** of these are true:

| Criterion                                                                                                                                                                                            | How to verify                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| A new "System Health" section is mounted in `ConfigPanel.tsx` and visible to the operator                                                                                                            | Open dashboard, navigate to config, see the section header                                     |
| The section shows: hardware identity (chip, RAM), kernel state (model, tickMs, gate, last tick), current thermal proxy (`kernel_task` %), and runtime list (Ollama/LM Studio/omlx with reachability) | Visual inspection                                                                              |
| The data refreshes on a poll cadence (60s default) AND on manual refresh button                                                                                                                      | Click refresh; watch data update                                                               |
| (M2) Rule-based suggestions appear when the system matches known patterns: dense large local model + laptop, no idle-gate set, LM Studio running with multiple models loaded, etc.                   | Configure a "bad" pattern, see suggestion; configure a "good" pattern, see no suggestions      |
| (M3) AI-generated suggestions appear with at least one suggestion per snapshot when relevant, explained in 1-3 sentences each                                                                        | Manual prompt review across 3-5 system states                                                  |
| The operator can dismiss / silence individual suggestions                                                                                                                                            | Click dismiss; suggestion stays hidden until config changes                                    |
| Documentation in [docs/](docs/) explains how the panel reads its data and which advice mechanism it uses per phase                                                                                   | Read the doc cold; can explain the panel's data sources without referring back to this handoff |

**Negative criteria (failure modes to actively avoid):**

- Don't make the panel a real-time thermal monitor. Polling at 60s is plenty. Continuous WebSocket subscriptions are over-engineering.
- Don't surface raw `top` output. Operator wants insight, not a Unix-tool dump.
- Don't auto-apply suggestions in M1/M2/M3. Auto-apply is M4 and out of scope here. Even then, every change requires explicit operator confirmation.
- Don't suggest things outside the operator's installed stack. "Switch to Ollama" is fine if Ollama is installed; "install Ollama" is also OK but flagged as needing setup; "use LM Studio" is wrong if it's not installed.

---

## 4. Architecture

### 4.1 Data flow

```
                 ┌─────────────────────────────────┐
                 │  System Health Panel (React)    │
                 │  - poll every 60s when visible  │
                 │  - manual refresh button        │
                 └────────────┬────────────────────┘
                              │ GET
                              ▼
         ┌─────────────────────────────────────────────────┐
         │  Gateway: GET /system-health/snapshot           │
         │  (new endpoint, read-only, dashboard token gate)│
         └────────────┬────────────────────────────────────┘
                      │
                      ▼
         ┌──────────────────────────────────────────────┐
         │  buildSystemHealthSnapshot() (new module)    │
         │  - hardware identity                         │
         │  - kernel_task % (parse top)                 │
         │  - top CPU consumers                         │
         │  - runtime reachability (Ollama / LM /omlx)  │
         │  - kernel snapshot (existing)                │
         │  - argent.json kernel config (existing)      │
         │  - tail recent kernel skip reasons (log)     │
         └────────────┬─────────────────────────────────┘
                      │ snapshot JSON
                      ▼
         ┌──────────────────────────────────────────────┐
         │  M2: applyRuleBasedSuggestions(snapshot)     │
         │  (static rules; returns array of suggestions)│
         └────────────┬─────────────────────────────────┘
                      │ + suggestions[]
                      ▼
         ┌──────────────────────────────────────────────┐
         │  M3 (optional): aiTuneSuggestions(snapshot)  │
         │  (LLM call; returns prose suggestions)       │
         └────────────┬─────────────────────────────────┘
                      │
                      ▼
                 Render in panel
```

The snapshot endpoint is read-only. The suggestion engine is pure-function over the snapshot. No side effects until M4 (which is out of scope here).

### 4.2 Where things live [PROPOSED]

| Component                               | Path                                             |
| --------------------------------------- | ------------------------------------------------ |
| Panel component                         | `dashboard/src/components/SystemHealthPanel.tsx` |
| Panel hooks (poll, refresh)             | `dashboard/src/hooks/useSystemHealth.ts`         |
| Snapshot builder                        | `src/gateway/system-health/snapshot.ts`          |
| Hardware probe                          | `src/gateway/system-health/hardware.ts`          |
| Thermal probe                           | `src/gateway/system-health/thermal.ts`           |
| Runtime reachability (extends existing) | `src/gateway/system-health/runtimes.ts`          |
| Rule-based suggestions (M2)             | `src/gateway/system-health/suggestions-rules.ts` |
| AI suggestions (M3)                     | `src/gateway/system-health/suggestions-ai.ts`    |
| Snapshot route handler                  | `src/gateway/server-methods/system-health.ts`    |
| Types                                   | `src/gateway/system-health/types.ts`             |

### 4.3 Snapshot shape [PROPOSED]

```ts
type SystemHealthSnapshot = {
  capturedAt: string; // ISO timestamp
  hardware: {
    chip: string; // "Apple M5 Max"
    cores: { performance: number; efficiency: number };
    memoryGb: number;
    chassis: "laptop" | "desktop" | "unknown";
    model: string; // "MacBookPro18,4"
    os: { name: string; version: string };
  };
  thermal: {
    kernelTaskPercent: number | null; // null if non-macOS
    interpretation: "cool" | "mild" | "moderate" | "throttling" | "severe";
    fanSpeedRpm: number | null; // optional; needs SMC read
  };
  topCpu: Array<{ pid: number; command: string; percent: number }>; // top 5
  runtimes: {
    ollama: { reachable: boolean; activeModels: string[]; loadedModels: string[] };
    lmStudio: { reachable: boolean; loadedModels: string[] };
    omlx: { reachable: boolean; loadedModels: string[] };
  };
  kernel: {
    enabled: boolean;
    mode: string;
    tickMs: number;
    localModel: string | null;
    idleActivityGateMinutes: number;
    lastReflectionAt: string | null;
    recentSkipReasons: Array<{ at: string; reason: string }>; // last 10
  };
  suggestions: SystemHealthSuggestion[]; // populated by rules + AI modules
};

type SystemHealthSuggestion = {
  id: string;
  severity: "info" | "tip" | "warning";
  title: string; // "Switch kernel to MoE model for laptop thermals"
  body: string; // 1-3 sentences of prose
  source: "rule" | "ai"; // provenance
  ruleId?: string; // if source=rule
  configChange?: {
    // optional structured change (UI can render a one-click apply in M4)
    path: string; // "agents.defaults.kernel.localModel"
    from: unknown;
    to: unknown;
  };
  dismissedUntil?: string; // operator can silence individual suggestions
};
```

### 4.4 M3 — AI suggestion architecture [PROPOSED]

The LLM call takes the JSON snapshot and emits a structured suggestions list. Recommend **the operator's own configured kernel model** as the default advisor LLM — same model the kernel uses, same heat profile, no new dependency. If the operator wants a remote-quality second opinion, expose a `systemHealth.advisorProvider` config slot that can be overridden to `anthropic` / `openai` / etc.

Prompt structure: deterministic JSON-mode (`response_format: json_schema`), schema matching `SystemHealthSuggestion[]`. Constraint: the LLM cannot apply changes; it only proposes. Soft prior in the prompt: "prefer fewer, sharper suggestions; explain the trade-off; only flag a change if there's evidence in the snapshot to support it."

**Rate limit:** AI suggestions only re-fetch when the snapshot changes meaningfully (config edit, thermal state change > 5%, model swap, runtime gain/loss). Don't run an LLM call every 60s on poll — that recreates the problem the panel is supposed to solve. Cache last AI output keyed by a snapshot digest.

---

## 5. Implementation phases

Each phase is independently shippable. Don't start phase N+1 until phase N's criteria are verified.

### Phase 1 (M1) — Read-only display

**Goal:** make the system state visible. No suggestions yet.

**Files to add:**

- `src/gateway/system-health/snapshot.ts` — `buildSystemHealthSnapshot()` returning `SystemHealthSnapshot`. No suggestions populated.
- `src/gateway/system-health/{hardware,thermal,runtimes}.ts` — per-source probes.
- `src/gateway/system-health/types.ts` — shared types.
- `src/gateway/server-methods/system-health.ts` — wire `GET /system-health/snapshot` into existing dashboard route. Dashboard auth token gates access.
- `dashboard/src/components/SystemHealthPanel.tsx` — component. Subsections: Hardware, Thermal, Runtimes, Kernel.
- `dashboard/src/hooks/useSystemHealth.ts` — polling hook (60s default, refresh button).
- Tests for snapshot builder (synthetic inputs → expected output shape).

**Done when:** open the panel, see real data for the current Mac, all subsections populated.

### Phase 2 (M2) — Rule-based suggestions

**Goal:** surface obvious tuning improvements without an LLM call.

**Files to add:**

- `src/gateway/system-health/suggestions-rules.ts` — `applyRuleBasedSuggestions(snapshot): Suggestion[]`. Start with these rules (each in its own pure function):

| Rule ID                               | Triggers when...                                                                                                      | Suggests...                                                             |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `dense-model-on-laptop`               | `hardware.chassis === "laptop"` AND `kernel.localModel` matches `qwen3.6-27b`, `gemma-4-31B-it`, or known dense ≥ 14B | Switch to MoE A3B variant for ~9× heat reduction                        |
| `tight-tick-and-heavy-model`          | `kernel.tickMs < 60000` AND localModel is dense ≥ 9B                                                                  | Raise `tickMs` to 120000 OR swap to smaller model                       |
| `no-idle-gate-on-laptop`              | `hardware.chassis === "laptop"` AND `kernel.idleActivityGateMinutes === 0`                                            | Enable the idle-gate (default 30 min)                                   |
| `lmstudio-running-multi-model`        | `runtimes.lmStudio.loadedModels.length > 1`                                                                           | Unload unused models to reduce memory pressure                          |
| `ollama-installed-but-using-lmstudio` | `runtimes.ollama.reachable === true` AND `kernel.localModel` is `lmstudio/*`                                          | Consider Ollama+MLX for lower overhead (link to vault decision)         |
| `kernel-task-sustained-throttle`      | `thermal.kernelTaskPercent > 20` sustained across 3 polls                                                             | Identify hot driver (top CPU consumers) and propose specific mitigation |

Each rule returns `SystemHealthSuggestion | null`. Aggregator concatenates non-nulls. Tests cover one rule per case.

**Done when:** introduce a known-bad config, see the matching suggestion appear in the panel; correct it, see the suggestion disappear.

### Phase 3 (M3) — AI-tuned suggestions

**Goal:** add prose-quality, personalized tuning advice the rules can't catch.

**Files to add:**

- `src/gateway/system-health/suggestions-ai.ts` — `aiTuneSuggestions(snapshot, opts): Promise<Suggestion[]>`. Calls the configured advisor model with a deterministic JSON-mode prompt. Caches by snapshot digest. Falls back gracefully if the advisor model isn't reachable.
- `src/gateway/system-health/suggestion-prompt.ts` — the prompt template + system message. Includes the rules' guidance as context (so AI doesn't duplicate what rules already say) and the operator's hardware/chassis context.
- `src/config/types.agent-defaults.ts` — new field `systemHealth.advisorProvider` (string, optional, default `"kernel"` meaning "reuse kernel's localModel").

**Done when:** AI suggestions appear that complement (don't duplicate) the rule-based ones; bad/sparse snapshots yield few or no AI suggestions (not made-up ones).

**Stop and ask the operator before starting M3 if:** M2 rule coverage already addresses 80%+ of common cases observed in the wild. The AI tier is for the long tail; if there's no long tail, skip it.

---

## 6. Conversation protocol — when to check in with the operator

| Trigger                                       | Question to ask                                                                                                                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before starting M1                            | "I'll add a SystemHealthPanel section to ConfigPanel.tsx. Want it as a new top-level section, or nested under an existing one?"                                                             |
| Before adding hardware-detection probes       | "Some probes need to run system commands (`sysctl`, `top`). Acceptable for the gateway process to execSync these on the snapshot endpoint, or should we cache/refresh on a longer cadence?" |
| Before M2 rules ship                          | "I have 6 starting rules. Any additional patterns you want flagged that you've personally hit in practice?"                                                                                 |
| Before M3                                     | "AI advisor will default to your kernel's localModel. Confirm — or would you prefer a remote model (Claude/GPT) by default and accept the per-call cost?"                                   |
| If `kernel_task` % proves unreliable on Tahoe | Surface immediately; fall back to a "we couldn't read thermal state" indicator in the panel                                                                                                 |
| If any probe takes > 500ms                    | Caching question — how stale is acceptable for hardware identity / thermal state / runtime list / kernel snapshot                                                                           |

Format `AskUserQuestion` calls with the recommended default first and labeled `(Recommended)`.

---

## 7. Validation and testing strategy

### 7.1 Snapshot builder tests

- Mock each probe (`sysctl`, `top`, runtime port checks, kernel snapshot) → expect a specific snapshot JSON
- Test each probe individually with both happy-path and error-path
- Test the snapshot shape is stable across "everything healthy" and "kernel down + omlx down + LM Studio down" (should still build without throwing)

### 7.2 Rule tests

One test per rule:

- Synthesize a snapshot that matches the rule → expect the rule's suggestion
- Synthesize a snapshot that does NOT match → expect `null`
- Edge cases: empty arrays, missing optional fields, unknown chassis

### 7.3 AI suggestion tests

- Mock the LLM call; assert that the snapshot is correctly serialized into the prompt
- Assert that returned suggestions match the JSON schema
- Test cache hit behavior (same snapshot digest → no LLM call)
- Test graceful fallback when LLM is unreachable

### 7.4 Manual UX validation

- Run the panel on the operator's actual Mac. Confirm the data matches `top`, `~/.argent/argent.json`, and what the operator perceives about system state.
- Walk through 3 scenarios: (1) healthy state, no suggestions; (2) known-bad state (dense 27B + 30s tick on laptop), 2-3 suggestions; (3) edge state (Ollama running but kernel pointed at omlx — should suggest switching for native support).

---

## 8. Known risks and how to handle them

| Risk                                                                                          | Mitigation                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `top` and `sysctl` parsing is platform-specific (macOS-only in M1)                            | Wrap probes in `if (process.platform === "darwin")` guards. Linux/Windows return null for thermal in M1; expand in M5 or later.                                                                        |
| `kernel_task` % is an _indicator_, not a thermometer. Misreading it can produce wrong advice. | The "interpretation" enum (`cool/mild/moderate/throttling/severe`) is what feeds into rules and AI prompts — operator-visible label is fuzzy, not a number.                                            |
| AI advisor model is unreachable when M3 needs it                                              | Already fallback graceful — return rule-based suggestions only and log a `[system-health] advisor unreachable` warning. The panel still works.                                                         |
| AI advisor generates fictional suggestions ("install package X")                              | Constrain via JSON schema + system prompt: "Only suggest changes to fields that exist in the snapshot. Only suggest models that appear in `runtimes.*.loadedModels`. If unsure, return no suggestion." |
| The panel becomes a wall of dismissed suggestions                                             | Dismissal carries a `dismissedUntil` timestamp; default 7 days; AI re-evaluates after that. Operator can dismiss-forever per suggestion ID.                                                            |
| Probe cost balloons (every refresh runs `top` + 3 port-probes + 3 model-list queries)         | M1 caches each probe for 30 sec server-side. Refresh button bypasses cache.                                                                                                                            |
| Operator concerned about sending hardware data to a remote LLM in M3                          | M3 default is the kernel's local model (no network). Remote opt-in is explicit and surfaces a "this advisor sends your system snapshot to X" line in the panel.                                        |

---

## 9. How to start

If you are a Claude Code session reading this cold:

1. Read [HANDOFF-kernel-fitness.md](HANDOFF-kernel-fitness.md) — companion handoff for the broader dashboard work (5 min)
2. Read this handoff in full (8 min)
3. Read [src/gateway/server-health-checks.ts](src/gateway/server-health-checks.ts) — pingOllama + reachability patterns, the data model is similar (5 min)
4. Read [dashboard/src/components/ConfigPanel.tsx](dashboard/src/components/ConfigPanel.tsx) and [dashboard/src/components/ConfigPanelCore.tsx](dashboard/src/components/ConfigPanelCore.tsx) for the visual convention (5 min)
5. Read the operator's thermal post-mortem: `~/Documents/Obsidian Vault/Argent/Thermals/2026-05-24 - Post-Mortem.md` — the concrete real-world problem this panel exists to make visible (5 min)
6. `AskUserQuestion` to Jason: "I've read both handoffs and the supporting docs. Ready to start M1 (read-only display) — confirm mount point: top-level config section or nested?"

Do not proceed past step 6 without an answer.

---

## 10. References

- Empirical context: `~/Documents/Obsidian Vault/Argent/Thermals/2026-05-24 - Post-Mortem.md`
- Operational decision driving model defaults: `~/Documents/Obsidian Vault/Argent/Decisions/Ollama+MLX as Mac Default Stack.md`
- Cross-project thermal primer: `~/Documents/Obsidian Vault/Jason's Development/Mac Laptop Thermal Management.md`
- Companion design: [HANDOFF-kernel-fitness.md](HANDOFF-kernel-fitness.md)
- PR landing the empirical context: [#382](https://github.com/ArgentAIOS/argentos-core/pull/382), [#384](https://github.com/ArgentAIOS/argentos-core/pull/384), [#385](https://github.com/ArgentAIOS/argentos-core/pull/385)
- Issue capturing the related ABI structural fix: [#386](https://github.com/ArgentAIOS/argentos-core/issues/386)

---

## 11. Thesis in one paragraph

ArgentOS today gives the operator a powerful local-LLM-driven cognition runtime but no in-product visibility into how that runtime is taxing their hardware. When defaults are hostile (dense large local model + fast cadence on a laptop), the operator's only feedback signal is heat — and the only recourse is to stop the system. This panel turns the hardware/thermal/runtime/config picture into a first-class dashboard surface, layers rule-based suggestions on top for the obvious tuning wins, and adds an AI advisor for the long tail. The plainer statement: every operator should be able to look at one screen and know "is ArgentOS healthy on my machine, and if not, what should I change." That screen doesn't exist today. This handoff builds it.
