# Prompt Budget Audit

Diagnostic instrumentation that lets you see, per-turn, exactly which injectors
are contributing to the system prompt Argent sends to the model. Pure
measurement — it does not remove, truncate, or reorder anything.

## Why this exists

A fresh "good morning" turn to the local Qwen3 model shipped a **61,633-token
prompt**. Prefill alone took 75 seconds. Before we decide what to trim, we need
per-injector visibility so the trim is driven by data, not hunches.

## How to turn it on

The instrumentation is opt-in via an environment variable. Default = off (no
logs, no overhead).

```sh
export ARGENT_PROMPT_BUDGET_LOG=1
```

Setting it to any other value (`true`, `0`, empty) keeps it disabled.

Most practical places to set it:

- **Gateway LaunchAgent**: add to the `EnvironmentVariables` dict in
  `~/Library/LaunchAgents/ai.argent.gateway.plist`, then
  `launchctl bootout` + `launchctl bootstrap` the plist.
- **One-off CLI run**: `ARGENT_PROMPT_BUDGET_LOG=1 argent <command>`.
- **Dev shell**: export it before `pnpm argent ...` or before running the
  smoke script described below.

Everything logs to `stdout`. Search for `[prompt-budget]`.

## What you get

### Per-injector lines (one per recorded section)

```
[prompt-budget] + tools-spec chars=2216 tokens≈554
[prompt-budget] + safety chars=494 tokens≈124
[prompt-budget] + skills chars=2477 tokens≈620
[prompt-budget] + memory chars=342 tokens≈86
[prompt-budget] + memu chars=2031 tokens≈508
[prompt-budget] + sis-lessons chars=881 tokens≈221
[prompt-budget] + ctx:RECENT_MEMORY.md chars=12000 tokens≈3000
[prompt-budget] + ctx:SOUL.md chars=1800 tokens≈450
...
```

Token counts are a simple `ceil(chars / 4)` heuristic — not the model's real
tokenizer. Use them as a relative yardstick, not a precise billing number.

### One summary line per turn

```
[prompt-budget] total=15489 chars=61954 ctx=ollama/qwen3-30b-a3b-instruct \
  injectors=tools-spec:554,safety:124,skills:620,memory:86,memu:508,...,ctx:RECENT_MEMORY.md:3000,...
```

The summary emits from `attempt.ts` just before the session starts the first
model call, so the numbers reflect the real assembled prompt that went over
the wire.

### Reproducing without the gateway

`scripts/prompt-budget-smoke.ts` runs `buildAgentSystemPrompt` directly with a
representative "good morning" setup and prints the breakdown. Handy for
iterating on trim ideas:

```sh
ARGENT_PROMPT_BUDGET_LOG=1 bun scripts/prompt-budget-smoke.ts
```

## Tracked injectors

These are the named buckets the tracker records. The first group lives inside
`buildAgentSystemPrompt` (`src/agents/system-prompt.ts`). The `extra:*` and
`tool-schemas` buckets are recorded upstream in `attempt.ts`.

| Injector                           | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Source                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| `tools-spec`                       | Per-tool `- name: summary` bullet list the model sees                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `system-prompt.ts` (toolLines)              |
| `safety`                           | Hardcoded safety guardrails section                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `system-prompt.ts`                          |
| `skills`                           | Mandatory skill-scan instructions + the `<available_skills>` XML                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `system-prompt.ts` (buildSkillsSection)     |
| `memory`                           | Memory recall instructions (MEMORY.md, memory_search/get rules)                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `system-prompt.ts` (buildMemorySection)     |
| `memu`                             | Long-term MemU rules (memory_recall/store/timeline/categories/forget)                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `system-prompt.ts` (buildMemuSection)       |
| `personal-skill`                   | Personal skill authoring rules (if `personal_skill` tool present)                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `system-prompt.ts`                          |
| `runtime-services`                 | Runtime-service-identity rules (if `runtime_services` tool present)                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `system-prompt.ts`                          |
| `sis-lessons`                      | Top-N SIS lessons pulled from the memory store (limit=5, 30s TTL cache)                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `system-prompt.ts` (buildSisLessonsSection) |
| `docs`                             | Argent docs path + canonical URLs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `system-prompt.ts` (buildDocsSection)       |
| `reactions`                        | Channel-specific reaction guidance (Telegram/Signal minimal vs extensive)                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `system-prompt.ts`                          |
| `reasoning-format`                 | `<think>/<final>` format hint for reasoning-tag providers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `system-prompt.ts`                          |
| `heartbeats`                       | Heartbeat behavior rules                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `system-prompt.ts`                          |
| `runtime-line`                     | Runtime metadata line (agent, host, os, arch, node, model, channel, caps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `system-prompt.ts` (buildRuntimeLine)       |
| `ctx:<path>`                       | **Per workspace/alignment file injected into Project Context.** One entry per file — e.g. `ctx:SOUL.md`, `ctx:IDENTITY.md`, `ctx:USER.md`, `ctx:TOOLS.md`, `ctx:HEARTBEAT.md`, `ctx:CONTEMPLATION.md`, plus auto-injected files from `bootstrap-files.ts`: `ctx:RECENT_MEMORY.md`, `ctx:IDENTITY_CONTEXT.md`, `ctx:RECENT_CONTEMPLATION.md`, `ctx:SIS_CONTEXT.md`, `ctx:RECENT_CHANNEL_CONVERSATIONS.md`, `ctx:LIVE_INBOX_LEDGER.md`, `ctx:KERNEL_CONTINUITY.md`, `ctx:SESSION_SNAPSHOT.md`, `ctx:TTS_POLICY.md`, `ctx:FIRST_RUN.md`, etc. | `system-prompt.ts` (contextFiles loop)      |
| `extra-system-prompt`              | The already-glued `extraSystemPrompt` block (see upstream parts below)                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `system-prompt.ts`                          |
| `extra:caller-extra-system-prompt` | Caller-provided `extraSystemPrompt` parameter                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `attempt.ts`                                |
| `extra:intent-hint`                | Three-tier intent-system prompt hint (`buildIntentSystemPromptHint`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `attempt.ts`                                |
| `extra:cross-channel-context`      | Cross-channel context block (recent events from other sessions)                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `attempt.ts`                                |
| `extra:matched-personal-skills`    | Matched personal-skill procedures for this user message                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `attempt.ts`                                |
| `extra:executable-personal-skill`  | Executable personal-skill procedure block (when one is selected)                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `attempt.ts`                                |
| `workspace-notes`                  | Workspace reminder lines (e.g., "commit your changes")                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `attempt.ts`                                |
| `message-tool-hints`               | Channel-specific hints for the `message` tool                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `attempt.ts`                                |
| `heartbeat-prompt-in`              | The heartbeat prompt string fed into the system-prompt builder                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `attempt.ts`                                |
| `skills-prompt-in`                 | The `<available_skills>` XML fed into the builder (also counted in `skills`)                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `attempt.ts`                                |
| `tts-hint`                         | TTS system-prompt hint                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `attempt.ts`                                |
| `tool-schemas(n=<count>)`          | JSON-stringified parameter schemas for every tool passed to the model                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `attempt.ts` (JSON.stringify)               |
| `system-prompt-total`              | Final length of the assembled system prompt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `system-prompt.ts`                          |

## Where to trim — likely high-ROI targets

The measurements in the current implementation consistently point at these
as the biggest offenders. All are educational guesses to investigate — **do
not trim as part of the audit task**; propose changes separately.

### 1. Bootstrap auto-injected context files (`ctx:RECENT_*`)

`src/agents/bootstrap-files.ts` auto-injects ~10 extra files into every turn:

- `RECENT_MEMORY.md` — unfiltered dump of recent memories, not query-scoped
- `IDENTITY_CONTEXT.md` — self-model + key entities + lessons
- `RECENT_CONTEMPLATION.md` — recent thinking loops
- `SIS_CONTEXT.md` — behavioral patterns
- `RECENT_CHANNEL_CONVERSATIONS.md` — Discord/Telegram/etc. recent msgs
- `LIVE_INBOX_LEDGER.md` — cross-session inbox
- `KERNEL_CONTINUITY.md` — always-on kernel snapshot
- `SESSION_SNAPSHOT.md` — last compaction snapshot
- plus the alignment docs the user owns (`SOUL.md`, `IDENTITY.md`, `USER.md`,
  `TOOLS.md`, `HEARTBEAT.md`, `CONTEMPLATION.md`)

Each is trimmed to `DEFAULT_BOOTSTRAP_MAX_CHARS = 20,000` individually, but
collectively they can blow past 30–50K chars on a fresh turn. Candidates for
trim:

- Make `RECENT_MEMORY.md` **relevance-filtered** by the user's query rather
  than a blanket dump. A fresh "good morning" has no query context — could
  degrade to a 500-char "identity + last 3 memories" summary instead.
- Drop `RECENT_CONTEMPLATION.md` from turn context — already summarized into
  SIS lessons and MemU.
- Compact `RECENT_CHANNEL_CONVERSATIONS.md` to last-N-messages with hard caps.
- Gate `LIVE_INBOX_LEDGER.md` on actual cross-channel activity.

### 2. Hardcoded MemU rules block (`memu`)

~2,000 chars of MANDATORY RULES injected every turn even when the agent has
no long-term memory tools in the current mode. Could shrink to ~500 chars
once the model has internalized the rules during SIS lesson-injection.

### 3. Skills section + `<available_skills>` XML (`skills` + `skills-prompt-in`)

If you have 20+ workspace skills loaded, the XML block alone can be 3–5K
chars. Consider:

- Inject only skill names + one-line descriptions, force the agent to read
  SKILL.md on demand.
- Gate on message intent — e.g., skip skills listing for pure-chitchat turns.

### 4. Tool summary list (`tools-spec`)

Every enabled tool contributes a `- name: summary` line. Full-stack configs
with 30+ tools push this past 2K chars. Already minimal — the wins here are
in the Pi tool schemas, not the summary list.

### 5. Tool JSON schemas (`tool-schemas(n=<count>)`)

This is separate from `tools-spec` and is often the single largest
contributor to the total bytes the model sees. TypeBox schemas for complex
tools (memory_store, schedule, channels) can be 1–3K chars each. Candidates:

- Narrow the tools passed to the current turn instead of the full registry.
  A "good morning" turn doesn't need `web_search`, `canvas`, `nodes`, or
  `schedule` on the wire.
- Use concise description text — many schemas have long prose in `description`.

### 6. Core hardcoded behavioral rules

Not separately tracked (they live inline in the `lines` array). Includes:

- Response Format / Response Style / Tool Call Style
- Execute, Don't Describe
- Response Endings
- Autonomous Blocker Policy
- Argent CLI Quick Reference
- Reply Tags / Messaging / Voice (TTS) / Silent Replies

Subtract all tracked injectors from `system-prompt-total` to see how big this
is (typically 6–10K chars). Candidates for slimming:

- Move policy rules into SIS lessons (confidence-weighted, optional, already
  tracked as `sis-lessons`).
- Convert banned-closer lists into a single short rule.

### 7. Time awareness + date/time (`runtime-line` and the date/time lines)

Small but constant overhead. Low-value to trim.

## Call chain (for maintainers)

```
session.prompt(userText)
  → agent.streamFn(model, { systemPrompt, messages, tools }, ...)
      (systemPrompt was assembled earlier in attempt.ts)

attempt.ts:
  buildBootstrapContextForRun(...)                          // alignment + bootstrap files
  resolveEffectiveIntentForAgentIfAvailable(...)            // intent policy
  buildIntentSystemPromptHintIfAvailable(...)               // intent hint text
  buildCrossChannelContextBlock(...)                        // cross-channel hint
  match/executable personal skills                          // personal skills
  effectiveExtraSystemPrompt = join(intent, cross-ch, skills…)
  runWithPromptBudget(tracker =>
    tracker.record("extra:*", …)                            // record parts of extra
    buildEmbeddedSystemPrompt({                             // → system-prompt.ts
      extraSystemPrompt, contextFiles, skillsPrompt, tools, heartbeatPrompt,
      docsPath, ttsHint, runtimeInfo, …
    })
      buildAgentSystemPrompt({ … })
        record("tools-spec", toolLines)
        record("safety", …)
        record("skills", …) / record("memory", …) / record("memu", …)
        record("personal-skill", …) / record("runtime-services", …)
        record("sis-lessons", …)      // ← pulls from memory store
        record("docs", …)
        record("extra-system-prompt", …)
        for file in contextFiles:
          record("ctx:<path>", content)
        record("reactions", …) / record("reasoning-format", …)
        record("heartbeats", …) / record("runtime-line", …)
        record("system-prompt-total", finalPrompt.length)
  )
  tracker.recordChars("tool-schemas(n=N)", JSON.stringify-sum)
  tracker.logSummary({ model, totalChars: systemPromptText.length })
```

## Safety & scope

- **Opt-in.** Default behavior is unchanged — no logs, no measurement
  overhead.
- **No prompt content is logged**, only names and lengths.
- **No injector is removed, truncated, or reordered** by this code. It is a
  measurement tool; trimming is a follow-up decision.
- `AsyncLocalStorage` scopes the tracker per-run, so concurrent agent runs
  (different sessions) don't cross-contaminate.
- The per-turn cost when disabled is ~zero: `getCurrentPromptBudgetTracker()`
  returns `undefined` and every call site uses optional chaining.

## Files

- `src/argent-agent/prompt-budget.ts` — tracker + AsyncLocalStorage plumbing
- `src/agents/system-prompt.ts` — section-level `record()` calls
- `src/agents/pi-embedded-runner/run/attempt.ts` — call-site orchestration,
  tool-schema measurement, summary emit
- `scripts/prompt-budget-smoke.ts` — standalone repro script
- `src/argent-agent/prompt-budget.test.ts` — unit tests for the tracker
