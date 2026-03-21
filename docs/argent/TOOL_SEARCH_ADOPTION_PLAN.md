# Tool Search & Deferred Tool Loading — Adoption Plan

> **For**: Codex implementation handoff
> **Author**: Jason Brashear + Claude
> **Date**: 2026-03-07
> **Branch**: Implement on `codex/*` branch off current development head
> **Reference**: [Anthropic Advanced Tool Use](https://www.anthropic.com/engineering/advanced-tool-use)

---

## 1. Thesis: Why This Matters for ArgentOS

### Scope of This Proposal

This proposal is primarily about **schema-token reduction and context recovery**.
That is the immediate, measurable win:

- Smaller tool payloads sent to the model on every turn
- More usable context on LOCAL tier models
- Better tool selection accuracy from a smaller candidate set

Avoiding eager tool construction is a **secondary optimization**, not the v1 goal.
Today, `createArgentTools()` still instantiates the full tool set before policy
filtering. That is worth improving later, but this plan does **not** require a
lazy factory registry in phase 1. If we try to solve both schema reduction and
constructor laziness at once, we widen the change surface significantly.

So the implementation target for v1 is:

- **Reduce schemas sent to the LLM**
- **Do not require lazy tool instantiation**
- **Preserve current tool execution semantics**

### The Problem

ArgentOS registers **83 tools** in `createArgentTools()` (plus ~8 coding tools from
pi-tools, plus plugin tools). After the 8-layer policy filter in `pi-tools.ts`,
a typical interactive session sends **30-50 tool definitions** to the LLM. Each
tool definition (name + description + JSON schema) averages 200-500 tokens.

**That means every single LLM call pays a 6,000-15,000 token tax** just for tool
definitions — before any user message, system prompt, or conversation history.

This tax is paid on **every call**, including:

| Subsystem            | Frequency        |                                 Tools Actually Used | Tools Sent | Waste       |
| -------------------- | ---------------- | --------------------------------------------------: | ---------: | ----------- |
| **Contemplation**    | Every 30 min     |  2-4 (memory_store, doc_panel, web_search, message) |      30-50 | ~90% unused |
| **Heartbeat**        | Every 15-30 min  | 3-5 (tasks, memory_recall, message, accountability) |      30-50 | ~85% unused |
| **SIS**              | Every 5 episodes |                  1-2 (memory_store, memory_reflect) |      30-50 | ~95% unused |
| **Execution Worker** | Every 20 min     |                                3-8 (varies by task) |      30-50 | ~80% unused |
| **Interactive chat** | Per message      |                                       5-15 (varies) |      30-50 | ~60% unused |

### The Cost

Over a 24-hour period with all subsystems running:

- Contemplation: ~48 cycles x ~10K wasted tokens = **480K tokens/day**
- Heartbeat: ~48 cycles x ~10K wasted tokens = **480K tokens/day**
- SIS: ~10 cycles x ~12K wasted tokens = **120K tokens/day**
- Execution Worker: ~72 cycles x ~8K wasted tokens = **576K tokens/day**
- Interactive: ~100 messages x ~5K wasted tokens = **500K tokens/day**

**Total waste: ~2.1M tokens/day on tool definitions the agent never uses.**

At Haiku rates ($0.25/MTok input), that's ~$0.53/day. At Sonnet rates ($3/MTok),
it's $6.30/day. Across 18 agents in the planned workforce, that scales to
$9.50-$113/day in pure waste.

But token cost isn't even the main issue. **Context pressure is.**

- Qwen3 30B (LOCAL tier): 32K context. 15K tokens of tool defs = 47% of context consumed before the agent even starts thinking.
- Haiku (FAST tier): 200K context but shorter effective attention span. Fewer tool defs = better tool selection accuracy.
- Anthropic's own data: Tool Search improved Opus 4 accuracy from 49% to 74% on tool selection.

### What Anthropic Recommends

From their [Advanced Tool Use](https://www.anthropic.com/engineering/advanced-tool-use) engineering post:

1. **Tool Search Tool**: Mark tools as `defer_loading: true`. The agent receives
   a single `tool_search` meta-tool. When the agent needs a capability, it
   searches by keyword, discovers the tool, and only then does that tool's
   schema enter the conversation. Result: 85% reduction in tool definition tokens.

2. **Programmatic Tool Calling**: Let the agent write code (in a sandbox) that
   orchestrates multiple tool calls in a loop, keeping intermediate results out
   of context. Result: 37% token reduction on multi-call tasks.

This document covers **Pattern 1 (Tool Search)** only. Pattern 2 (Programmatic
Calling) is deferred — ArgentOS doesn't currently have batch-processing workloads
where it would pay off.

---

## 2. How ArgentOS Currently Handles Tools

### Tool Assembly Pipeline

```
agentCommand() or getReplyFromConfig()
  |
  v
createArgentCodingTools()  [src/agents/pi-tools.ts]
  |-- createArgentTools()  [src/agents/argent-tools.ts]
  |     |-- 83 tools instantiated unconditionally
  |     |-- 8 MemU tools always included
  |     |-- Plugin tools resolved and appended
  |     `-- Returns AnyAgentTool[] (~90+ tools)
  |
  |-- 8 coding tools (read, write, edit, bash, etc.)
  |
  `-- 8-layer policy filter cascade:
        1. Profile policy (tools.profile)
        2. Provider-specific profile (tools.byProvider[x].profile)
        3. Global allow/deny (tools.allow)
        4. Provider-specific allow/deny
        5. Agent-specific policy (agents.{id}.tools.allow)
        6. Agent + provider policy
        7. Session-level policy (toolsAllow/toolsDeny on SessionEntry)
        8. Group/channel policy
        |
        v
      Filtered tool array sent to LLM (30-50 tools typical)
```

### Initial Runtime Target

The first implementation target is the **embedded pi-agent tool pipeline**:

- `createArgentCodingTools()` in `src/agents/pi-tools.ts`
- The interactive reply path
- Background subsystems that already route through that pipeline

This is the correct first target because it is where tool policy filtering,
schema normalization, and most active tool exposure already happen.

The **Argent-native runtime is explicitly not a v1 dependency**. Its tool
activation surface is not yet the right place to anchor this feature. The
design should remain compatible with Argent-native adoption later, but the
initial rollout should not wait on parity there.

### What's Good About This

- **Policy engine is robust** — 8 layers of filtering is sophisticated. Tools
  can be scoped by agent, channel, provider, and session.
- **Conditional inclusion** — Some tools are already conditionally omitted
  (TTS for webchat, image tool without vision, message tool when disabled).
- **Plugin isolation** — Plugin tools go through an allowlist gate.

### What's Not Good

- **All 83 tools are instantiated every call** — even if policy will filter most of them.
- **No distinction between "core" and "specialized" tools** — memory_recall and
  heygen_video get the same treatment.
- **Background loops pay full freight** — Contemplation, heartbeat, SIS, and
  execution worker all go through the same pipeline as interactive chat.
- **No on-demand discovery** — The agent can't say "I need a deployment tool"
  and have it appear. If it's filtered out by policy, it's invisible.
- **Policy is static per-session** — You configure which tools an agent gets,
  but the agent can't adapt its toolset to the task at hand.

---

## 3. Proposed Architecture: Deferred Tool Loading

### Core Concept

Split the 83+ tools into two categories:

**Always-loaded (core)**: Tools the agent needs on virtually every call. These are
sent with every request, no discovery needed.

**Deferred (discoverable)**: Specialized tools loaded on-demand via a `tool_search`
meta-tool. Their schemas only enter context when the agent explicitly requests them.

### Proposed Core Tools (~12 tools, ~3,000 tokens)

These stay loaded on every call:

| Tool             | Rationale                                   |
| ---------------- | ------------------------------------------- |
| `memory_recall`  | Used in most sessions for context retrieval |
| `memory_store`   | Used whenever the agent learns something    |
| `tasks`          | Task board is central to all work           |
| `message`        | Primary output channel                      |
| `web_search`     | Common information need                     |
| `web_fetch`      | Companion to web_search                     |
| `doc_panel`      | Primary document output                     |
| `tool_search`    | **NEW** — the discovery meta-tool           |
| `session_status` | Self-awareness of current state             |
| `agents_list`    | Multi-agent awareness                       |
| `skills`         | Skill discovery                             |
| `os_docs`        | Self-documentation                          |

### Deferred Tool Groups (~70+ tools)

Organized by domain for search relevance:

| Group                    | Tools                                                                                                                                                                          | Keywords                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| **Memory (extended)**    | memory_categories, memory_forget, memory_entity, memory_reflect, memory_timeline, memory_graph                                                                                 | memory, entity, timeline, graph, reflect, forget, categories |
| **Doc Panel (extended)** | doc_panel_update, doc_panel_delete, doc_panel_list, doc_panel_search, doc_panel_get                                                                                            | document, panel, update, delete, list, search, get           |
| **Sessions**             | sessions_list, sessions_history, sessions_send, sessions_spawn, sessions_search                                                                                                | session, history, spawn, conversation                        |
| **Teams**                | team_spawn, team_status                                                                                                                                                        | team, spawn, delegate                                        |
| **Media**                | image_generation, video_generation, audio_generation, music_generation, tts, tts_generate, audio_alert, heygen_video, podcast_plan, podcast_generate, podcast_publish_pipeline | image, video, audio, music, tts, podcast, generate, media    |
| **Deployment**           | coolify_deploy, railway_deploy, vercel_deploy                                                                                                                                  | deploy, coolify, railway, vercel, hosting                    |
| **DNS & Email**          | namecheap_dns, easydmarc, email_delivery, vip_email                                                                                                                            | dns, domain, email, dmarc, deliverability                    |
| **Channels**             | discord, twilio_comm, slack_signal_monitor                                                                                                                                     | discord, twilio, slack, sms, call                            |
| **DevOps**               | browser, terminal, github_issue, gateway, argent_config, service_keys                                                                                                          | browser, terminal, github, config, secrets, keys             |
| **Knowledge**            | knowledge_search, knowledge_collections_list                                                                                                                                   | knowledge, library, rag, collection                          |
| **Projects**             | specforge, jobs, accountability                                                                                                                                                | specforge, project, job, accountability, workflow            |
| **Canvas & Nodes**       | canvas, nodes                                                                                                                                                                  | canvas, device, screen, node                                 |
| **Family**               | family                                                                                                                                                                         | family, agent, register, shared                              |
| **YouTube**              | youtube_metadata, youtube_notebooklm, youtube_thumbnail                                                                                                                        | youtube, video, thumbnail, metadata                          |
| **File Editing**         | edit_line_range, edit_regex                                                                                                                                                    | edit, file, line, regex, replace                             |
| **Misc**                 | cron, apps, marketplace, plugin_builder, widget_builder, onboarding_pack, contemplation, visual_presence, meeting_recorder, search, send_payload, image                        | cron, schedule, app, plugin, widget, meeting                 |

### The `tool_search` Meta-Tool

```typescript
{
  name: "tool_search",
  description:
    "Search for available tools by keyword. Use this when you need a " +
    "capability not in your current toolset. Returns matching tool names " +
    "and descriptions. Once you find the right tool, it becomes available " +
    "for use in this conversation.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Keywords describing the capability you need. " +
          "Examples: 'deploy to railway', 'generate image', " +
          "'edit file', 'dns records', 'youtube thumbnail'",
      },
      category: {
        type: "string",
        description: "Optional category filter to narrow results.",
        enum: [
          "memory", "documents", "sessions", "teams", "media",
          "deployment", "dns-email", "channels", "devops",
          "knowledge", "projects", "youtube", "file-editing",
        ],
      },
    },
    required: ["query"],
  },
}
```

**Execution behavior**: When invoked, `tool_search` does a keyword match against
deferred tool names, descriptions, and group keywords. It returns the top 3-5
matches with name + description. The matched tools are then **injected into the
active tool list** for the remainder of this agent session.

In v1, "injected into the active tool list" means:

- The tool names are recorded as discovered for the session
- Subsequent turns rebuild the visible tool list from:
  - always-loaded core tools
  - discovered deferred tools for that session
- We persist **tool names**, not instantiated tool objects

### How Discovery Interacts with Policy

The 8-layer policy engine still applies. Deferred tools are filtered through
the same policy cascade _before_ being registered as discoverable. If policy
denies a tool, `tool_search` won't find it.

```
createArgentTools()
  |-- Instantiate all 83+ tools
  |-- Split into core vs. deferred
  |-- Apply policy filter to BOTH sets
  |-- Core tools: sent to LLM immediately
  |-- Deferred tools: registered in ToolSearchRegistry
  `-- tool_search meta-tool: queries the registry
```

### Background Loop Optimization

Background subsystems get **even smaller core sets** since their needs are predictable:

| Subsystem            |                       Always-Loaded                        |   Can Discover    |
| -------------------- | :--------------------------------------------------------: | :---------------: |
| **Contemplation**    | memory_store, doc_panel, web_search, message, tool_search  |  Everything else  |
| **Heartbeat**        | tasks, memory_recall, message, accountability, tool_search |  Everything else  |
| **SIS**              |         memory_store, memory_reflect, tool_search          |  Everything else  |
| **Execution Worker** | tasks, memory_recall, message, tool_search + task-specific |  Everything else  |
| **Interactive**      |            Full 12-tool core set + tool_search             | Specialized tools |

This is achieved by adding a `subsystem` parameter to the tool assembly pipeline
that selects the appropriate core set.

---

## 4. Implementation Plan

### Phase 1: Tool Registry & Search (Foundation)

**Goal**: Build the infrastructure without changing any existing behavior.

**Files to create**:

- `src/agents/tool-search-registry.ts` — Registry class that indexes deferred
  tools by name, description, and keywords. Supports keyword search with scoring.

**Files to modify**:

- `src/agents/argent-tools.ts` — Add tool metadata (group, keywords) to each
  tool creation call. Export a `TOOL_GROUPS` constant defining core vs. deferred.
- `src/agents/tools/tool-search-tool.ts` — **New tool file**. The `tool_search`
  meta-tool implementation.

**Deliverable**: `ToolSearchRegistry` class with `register()`, `search()`,
`getDiscovered()` methods. `tool_search` tool that queries the registry.

**Validation**: Unit tests. Create registry with 10 tools, search by keyword,
verify results are ranked by relevance.

### Phase 2: Split Core vs. Deferred in Tool Assembly

**Goal**: Modify `createArgentTools()` to split tools into core and deferred sets.

**Files to modify**:

- `src/agents/argent-tools.ts` — Add `ToolGroup` metadata. Return
  `{ core: AnyAgentTool[], deferred: AnyAgentTool[] }` instead of flat array
  (or add a wrapper function that returns this structure, keeping backward compat).
- `src/agents/pi-tools.ts` — After policy filtering, split into core/deferred.
  Build `ToolSearchRegistry` from deferred tools. Include `tool_search` in
  the tool array sent to LLM. Rehydrate discovered tools from session state on
  each turn so they remain available on subsequent turns.

**Key design decision**: Discovered tools must persist across turns within a
session. The persistence model is:

- **Session store is the source of truth** for discovered tool names
- **In-memory registry/cache is the fast path** for an active process
- On each turn, the pipeline rebuilds the visible tool list from persisted
  discovered tool names rather than trying to persist tool instances

Suggested session shape:

```typescript
type SessionEntry = {
  discoveredTools?: string[];
};
```

Operational rules:

- Cap discovered tools per session (`maxDiscovered`)
- Deduplicate by canonical tool name
- Ignore names that no longer exist or no longer pass policy
- Re-apply policy filters on every turn before exposing persisted tools

**Deliverable**: Modified pipeline that sends only core tools + tool_search.
Feature-gated behind config flag `agents.defaults.toolSearch.enabled` (default: false).

**Validation**: Interactive test — enable flag, start a chat, verify only core
tools are visible. Use `tool_search` to find a specialized tool, verify it
becomes available.

### Phase 3: Background Loop Core Sets

**Goal**: Define minimal core tool sets for each background subsystem.

**Files to modify**:

- `src/agents/pi-tools.ts` — Accept `subsystem?: string` parameter. When set,
  use a subsystem-specific core list instead of the general one.
- `src/infra/contemplation-runner.ts` — Pass `subsystem: "contemplation"` to
  the agent call.
- `src/infra/heartbeat-runner.ts` — The heartbeat goes through `getReplyFromConfig`.
  Add subsystem hint to reply options.
- `src/infra/sis-runner.ts` — Pass `subsystem: "sis"`.
- `src/infra/execution-worker-runner.ts` — Pass `subsystem: "execution-worker"`.
- `src/auto-reply/reply/get-reply-inline-actions.ts` — Thread `subsystem` hint
  through the reply pipeline to `createArgentTools()`.

**Important scope note**: `subsystem` is an API-surface change, not just a local
implementation detail. It must be threaded through:

- command-entry paths
- reply-entry paths
- background loop callers
- direct tool-dispatch call sites that bypass `createArgentCodingTools()`

**Deliverable**: Background loops send 4-6 core tools instead of 30-50.

**Validation**: Enable tool search, run gateway with all subsystems. Verify via
logs that contemplation/heartbeat/SIS calls include only their core tools.
Verify they can still discover tools via `tool_search` when needed.

### Phase 4: Metrics & Tuning

**Goal**: Measure the impact and tune core tool sets.

**Files to create**:

- `src/agents/tool-search-metrics.ts` — Track which tools are discovered by
  which subsystems. Identify tools that are _always_ discovered (should become core).
  Identify core tools that are _never_ used (should become deferred).

**Files to modify**:

- `src/agents/tools/tool-search-tool.ts` — Emit metrics on each search.
- Dashboard: Add tool search metrics to the execution worker status panel
  (optional, lower priority).

**Deliverable**: After 1 week of operation, analyze metrics to refine core vs.
deferred classification. Adjust group assignments based on actual usage.

---

## 5. Config Schema

```jsonc
// ~/.argentos/argent.json
{
  "agents": {
    "defaults": {
      "toolSearch": {
        "enabled": true, // Feature gate (default: false during rollout)
        "maxResults": 5, // Max tools returned per search
        "maxDiscovered": 20, // Max tools discoverable per session
        "coreOverrides": {
          // Force specific tools into core set regardless of defaults
          "include": ["knowledge_search"],
          // Force specific tools out of core set
          "exclude": ["os_docs"],
        },
      },
    },
  },
}
```

Subsystem-level overrides in agent config:

```jsonc
{
  "agents": {
    "defaults": {
      "contemplation": {
        "toolSearch": {
          "coreTools": ["memory_store", "doc_panel", "web_search", "message"],
        },
      },
      "heartbeat": {
        "toolSearch": {
          "coreTools": ["tasks", "memory_recall", "message", "accountability"],
        },
      },
    },
  },
}
```

---

## 6. Migration & Rollout

### Week 1: Build (Phases 1-2)

- Implement `ToolSearchRegistry` and `tool_search` tool
- Modify tool assembly pipeline with feature gate
- Add session persistence for discovered tool names
- Test with `toolSearch.enabled: false` (no behavior change)
- Test with `toolSearch.enabled: true` on interactive sessions only

### Week 2: Background Loops (Phase 3)

- Add subsystem core tool sets
- Thread subsystem hints through reply pipeline
- Test each subsystem individually
- Monitor for regressions (agent unable to find needed tool)

### Week 3: Measure (Phase 4)

- Enable metrics collection
- Run for a full week
- Analyze: Which tools are always discovered? Which core tools are never used?
- Adjust classifications
- Consider making `toolSearch.enabled: true` the default

### Rollback Plan

The feature is gated behind `toolSearch.enabled`. Setting it to `false` restores
the current behavior (all tools sent on every call). No migration needed.

If individual subsystems have issues, subsystem-specific `coreTools` overrides
let you expand the always-loaded set without disabling the feature globally.

---

## 7. What We're NOT Doing (and Why)

### Lazy Tool Construction

This plan does **not** attempt to replace eager `createArgentTools()` assembly
with lazy factories in v1. That would be a separate optimization pass focused on
constructor cost and side effects rather than prompt-size reduction.

Revisit when:

- tool constructor overhead shows up in profiling
- some tool constructors have material startup side effects
- schema-token reduction has already landed and stabilized

### Programmatic Tool Calling (Pattern 2)

The agent writes code in a sandbox to orchestrate tool calls in a loop. This
pattern shines when doing the same operation 20+ times (e.g., check budget for
each of 20 team members). ArgentOS doesn't currently have batch-processing
workloads like this. **Revisit when**: multi-agent family is running, knowledge
ingestion handles 50+ docs, or MSP automation processes many records.

### ClawWork Economic Model

Economic simulation with starting balances and survival tiers. Interesting for
benchmarking and leaderboards, but ArgentOS agents are production workers, not
contestants. **Revisit when**: the 18-agent workforce is running and we need
cost accountability per agent.

### Dynamic Tool Generation

Some frameworks let agents create tools at runtime. This adds complexity and
attack surface without clear benefit for ArgentOS's current workloads.

---

## 8. Expected Impact

| Metric                                  |       Before | After (Projected) |
| --------------------------------------- | -----------: | ----------------: |
| Tool tokens per interactive call        | 6,000-15,000 |       2,000-4,000 |
| Tool tokens per background cycle        | 6,000-15,000 |         800-1,500 |
| Daily waste (all subsystems, 1 agent)   | ~2.1M tokens |      ~400K tokens |
| Daily waste (18-agent workforce)        |  ~38M tokens |        ~7M tokens |
| Context consumed by tools (LOCAL tier)  |          47% |             6-10% |
| Tool selection accuracy (per Anthropic) |     Baseline |           +25-50% |

**The biggest win is not cost — it's context.** On LOCAL tier (Qwen3 30B, 32K
context), recovering 40% of context means the agent can actually think about
the task instead of drowning in tool schemas it will never use.

---

## 9. Files Reference

| File                                               | Action | Purpose                                              |
| -------------------------------------------------- | ------ | ---------------------------------------------------- |
| `src/agents/tool-search-registry.ts`               | Create | Registry class for deferred tool indexing and search |
| `src/agents/tools/tool-search-tool.ts`             | Create | The `tool_search` meta-tool                          |
| `src/agents/tool-search-metrics.ts`                | Create | Usage tracking for tuning                            |
| `src/agents/argent-tools.ts`                       | Modify | Add tool group metadata, split core/deferred         |
| `src/agents/pi-tools.ts`                           | Modify | Wire registry into pipeline, accept subsystem param  |
| `src/auto-reply/reply/get-reply-inline-actions.ts` | Modify | Thread subsystem hint                                |
| `src/auto-reply/types.ts`                          | Modify | Add subsystem field to reply options                 |
| `src/infra/contemplation-runner.ts`                | Modify | Pass subsystem hint                                  |
| `src/infra/heartbeat-runner.ts`                    | Modify | Pass subsystem hint (via reply opts)                 |
| `src/infra/sis-runner.ts`                          | Modify | Pass subsystem hint                                  |
| `src/infra/execution-worker-runner.ts`             | Modify | Pass subsystem hint                                  |
| `src/config/types.agent-defaults.ts`               | Modify | Add `toolSearch` config types                        |
| `src/config/zod-schema.agent-defaults.ts`          | Modify | Add `toolSearch` Zod schema                          |
