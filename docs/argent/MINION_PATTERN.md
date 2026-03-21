# The Minion Pattern — Inter-Session Task Handoff

> Isolated cron sessions do the grunt work. The main session does the thinking.

## The Problem

ArgentOS runs scheduled jobs (cron) in **isolated sessions** — separate agent instances with no conversation history, no memory access, and no personality context. This is by design: isolation prevents cron jobs from polluting the main session's context window and allows them to run on cheaper model tiers.

But isolation creates three gaps:

### 1. Visibility Gap

Isolated sessions produce work that the main session never sees. The agent wakes up, does research, generates output, and the result evaporates when the session ends. The main session has no structured way to discover what happened.

### 2. Quality Gap

The main session has access to MemU (long-term memory), conversation history, personality files (SOUL.md), and relationship context (USER.md). Isolated sessions have none of this. They produce competent but generic output — missing the personal touch, inside jokes, and contextual awareness that make the agent feel like a partner rather than a tool.

### 3. Accountability Gap

There's no verification that the isolated session completed all requirements, met quality standards, or handled edge cases. Fire-and-forget means fire-and-hope.

## The Insight

ArgentOS already has two **persistent** storage systems that survive gateway restarts:

| System          | Storage                 | Persists? | Accessible By     |
| --------------- | ----------------------- | --------- | ----------------- |
| **Task system** | SQLite (`dashboard.db`) | Yes       | All sessions      |
| **Doc panel**   | SQLite (`dashboard.db`) | Yes       | All sessions      |
| System events   | In-memory queue         | No        | Main session only |
| Session history | In-memory               | No        | Same session only |

The existing `delivery.mode: "announce"` and `wakeMode` options rely on **ephemeral** mechanisms (system events, in-memory queues). If the gateway restarts between the cron job completing and the main session receiving the notification, the handoff is lost.

**The minion pattern uses persistent storage (tasks + doc_panel) as the handoff mechanism**, with system events as a bonus notification layer — not the primary one.

## The Pattern

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│  CRON TRIGGER    │         │  ISOLATED SESSION │         │  MAIN SESSION   │
│  (scheduler)     │────────►│  (research minion)│         │  (quality pass) │
└─────────────────┘         │                  │         │                 │
                            │  1. Research      │         │                 │
                            │  2. Write draft   │         │                 │
                            │  3. Save to       │         │                 │
                            │     doc_panel ────┼────┐    │                 │
                            │  4. Create task ──┼──┐ │    │                 │
                            │                  │  │ │    │                 │
                            └──────────────────┘  │ │    │                 │
                                                  │ │    │                 │
                              ┌────────────────┐  │ │    │                 │
                              │  dashboard.db  │◄─┘ │    │                 │
                              │  ┌───────────┐ │    │    │                 │
                              │  │   TASK     │ │    │    │  Checks tasks  │
                              │  │ "Morning   │─┼────┼───►│  on startup,   │
                              │  │  Brief..." │ │    │    │  heartbeat,    │
                              │  └───────────┘ │    │    │  contemplation │
                              │  ┌───────────┐ │    │    │                 │
                              │  │ DOC_PANEL  │ │◄───┘    │  Reads draft,  │
                              │  │ "Morning   │─┼────────►│  adds context, │
                              │  │  Brief     │ │         │  delivers,     │
                              │  │  Draft"    │ │         │  completes task│
                              │  └───────────┘ │         │                 │
                              └────────────────┘         └─────────────────┘
```

### The Minion's Job (Isolated Session)

The minion has a narrow, well-defined scope:

1. **Research** — Gather raw data (web search, API calls, inbox checks)
2. **Draft** — Write a structured draft of the deliverable
3. **Persist** — Save the draft to `doc_panel` (survives restarts)
4. **Hand off** — Create a task assigned to the main session with clear instructions

The minion does NOT:

- Generate final audio/media
- Deliver to external channels (Discord, email)
- Make judgment calls about tone, timing, or audience
- Access memory or personality context

### The Main Session's Job

The main session picks up the handoff during its normal operating cycle:

1. **Discover** — Check `tasks action=list status=pending assignee=argent` during startup, heartbeat, or contemplation
2. **Read** — Open the doc_panel draft, review the minion's work
3. **Enhance** — Add context from memory, conversation history, personality
4. **Deliver** — Generate final media, send to channels, notify the user
5. **Close** — Mark the task complete

### Why This Split Works

| Capability             | Isolated Session | Main Session |
| ---------------------- | ---------------- | ------------ |
| Web search             | Yes              | Yes          |
| Tool calls             | Yes              | Yes          |
| MemU (memory)          | No               | Yes          |
| SOUL.md (personality)  | No               | Yes          |
| Conversation context   | No               | Yes          |
| Relationship awareness | No               | Yes          |
| Model tier             | Usually cheaper  | Full routing |
| Quality judgment       | Limited          | Full         |

The minion handles the **time-intensive, context-independent** work (research, data gathering). The main session handles the **context-dependent, quality-sensitive** work (personalization, delivery, verification).

This mirrors how human teams work: a junior researcher gathers data and writes a first draft, then the senior partner reviews, adds their expertise, and signs off.

## Implementation Details

### Cron Job Configuration

The cron job's `payload.message` should explicitly instruct the isolated session to act as a minion:

```json
{
  "sessionTarget": "isolated",
  "wakeMode": "now",
  "payload": {
    "kind": "agentTurn",
    "message": "You are a research minion for [task]. Your ONLY deliverables are: doc_panel draft + task creation. Do NOT deliver to channels yourself."
  },
  "delivery": {
    "mode": "announce"
  }
}
```

Key settings:

- **`sessionTarget: "isolated"`** — Runs in a separate session (no context pollution)
- **`wakeMode: "now"`** — Triggers immediate heartbeat in main session after completion (bonus notification)
- **`delivery.mode: "announce"`** — Posts system event to main session (bonus notification)
- Both `wakeMode` and `delivery` are **supplementary** — the task in `dashboard.db` is the primary handoff

### Task Creation by Minion

The minion creates a task with specific fields:

```
tasks action=add
  title: "[Deliverable] [date]: [remaining steps]"
  description: "Research minion completed the draft. Steps: 1) Read draft... 2) Add context... 3) Deliver..."
  priority: "high"
  assignee: "argent"
```

The description serves as a **checklist** for the main session — it should enumerate every remaining step so the main session doesn't have to figure out what to do next.

### Main Session Discovery

The main session checks for minion handoffs at three points:

1. **Session startup** — AGENTS.md "Cron Job Awareness" section
2. **Contemplation cycles** — CONTEMPLATION.md "Check your minions" section
3. **Heartbeats** — Triggered by `wakeMode: "now"` after cron completion

This triple-check ensures the handoff is discovered even if one mechanism fails.

### Failure Modes and Recovery

| Failure                                 | Impact                                        | Recovery                                                                          |
| --------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------- |
| Minion crashes mid-research             | No draft, no task created                     | Next cron run retries; no stale state                                             |
| Minion creates draft but not task       | Draft exists in doc_panel but undiscoverable  | Manual check of doc_panel; consider adding task creation first                    |
| Gateway restarts after minion completes | System event lost, wakeMode notification lost | Task persists in SQLite — discovered on next contemplation/heartbeat              |
| Main session skips task check           | Task sits pending                             | Eventually discovered on next cycle; overdue tracking catches it                  |
| Main session can't find draft           | Task references non-existent doc              | Main session can still research from scratch; task description has enough context |

## Design Principles

### 1. Persistent Over Ephemeral

Never rely on in-memory state for cross-session communication. SQLite survives restarts, crashes, and updates. In-memory queues don't.

### 2. Narrow Minion Scope

Minions should have a clear, bounded job. "Research and draft" is good. "Research, draft, generate audio, deliver, and verify" is too much — the isolated session lacks the context to do the quality-sensitive parts well.

### 3. Explicit Handoff Instructions

The task description created by the minion should be a complete checklist. The main session shouldn't need to guess what the minion intended or what remains to be done.

### 4. Triple-Check Discovery

Wire the handoff into multiple discovery points (startup, contemplation, heartbeat). Any single mechanism can fail — redundancy ensures reliability.

### 5. Separation of Concerns

- **Minion**: Data gathering, drafting, persistence (context-independent work)
- **Main session**: Quality control, personalization, delivery (context-dependent work)

This isn't about trust — it's about capability. The isolated session literally cannot access memory and personality. Don't ask it to fake what it doesn't have.

## Applying the Pattern to Other Jobs

The minion pattern is generic. Any cron job that currently tries to do everything end-to-end can be split:

### Personalized Morning Briefing (8:30 AM)

- **Minion**: Check weather, calendar, news, silver prices. Draft greeting with facts.
- **Main session**: Add personal touch from recent conversations, memory of what Jason's working on, relationship context.

### Monthly Agent Incident Report

- **Minion**: Scrape HN, security feeds, GitHub advisories. Compile raw incident list with facts.
- **Main session**: Add MAO policy analysis, connect to ArgentOS architecture decisions, write executive summary.

### Weekly Incident Check-in

- **Minion**: Quick scan of sources, compile bullet points.
- **Main session**: Assess relevance to family projects, add commentary, deliver to Discord.

### Pattern Template

For any new cron job, ask:

1. What part is **data gathering**? → Minion does this
2. What part requires **context/memory/personality**? → Main session does this
3. What's the **deliverable format**? → Minion saves draft to doc_panel
4. What's the **delivery channel**? → Main session handles delivery

## Relationship to Other Systems

### Task System

The minion pattern uses the existing task system (`src/agents/tools/tasks-tools.ts`) as its coordination layer. No new infrastructure needed — just a new usage pattern.

### Doc Panel

The doc panel (`src/agents/tools/doc-panel-tool.ts`) serves as the artifact store. Drafts persist in `dashboard.db` and are accessible from any session.

### System Events

System events (`src/infra/system-events.ts`) remain as a supplementary notification mechanism via `delivery.mode: "announce"`. They're nice-to-have but not relied upon.

### Contemplation System

The contemplation prompt (`CONTEMPLATION.md`) is extended with a "Check your minions" step, making handoff discovery part of the agent's natural decision-making flow.

### Accountability Score

Pending handoff tasks affect the accountability score. If the main session ignores a minion task, it shows up as overdue — creating natural pressure to process handoffs promptly.

---

_First use case: Daily AI Intel Brief (6:00 AM CT)_
_Pattern documented: 2026-02-13_
