# RALF + ANGEL: Response Accountability Llama Framework

> A verification loop that uses local Llama models to audit the agent's work in real-time, with ground truth checks against real APIs to catch fabrication.

## What Is RALF?

**RALF** (Response Accountability Llama Framework) is the heartbeat verification pipeline that ensures the agent actually does what it claims to do. Every heartbeat cycle, the agent receives a task contract, executes it, and produces a response. RALF then audits that response using a secondary model -- preferring a local Llama model via Ollama (free, fast) with a cloud fallback to Claude Haiku.

The agent does not control the verification. The harness owns it.

## What Is ANGEL?

**ANGEL** ("The Angel on the Shoulder") is the verification sidecar within RALF. It's the specific component that takes the task contract + agent response and produces per-task verdicts: `verified`, `not_verified`, or `unclear`. The name comes from the concept of having an independent observer watching over the agent's shoulder, checking every claim.

## Architecture

```
                    HEARTBEAT LOOP
                         |
           ┌─────────────┴─────────────┐
           |                            |
     1. HEARTBEAT.md               2. HEARTBEAT
        (task contract)              PROMPT
           |                            |
           ├── Parse tasks              ├── Inject contract tasks
           ├── Track progress           ├── Inject score section
           └── Required/optional        └── Inject retry feedback
                         |
                    3. AGENT EXECUTES
                         |
                    Produces response text
                         |
              ┌──────────┴──────────┐
              |                     |
        4. GROUND TRUTH       5. ANGEL VERIFIER
           COLLECTION             (sidecar)
              |                     |
         Query real APIs       Local Ollama (free)
         - Email inbox         → Haiku fallback
         - Social notifs       → Verdicts per task
              |                     |
              └──────────┬──────────┘
                         |
                  6. VERDICT APPLICATION
                         |
                  ┌──────┴──────┐
                  |             |
            Progress       Score Engine
            Tracker        (see ACCOUNTABILITY_SCORE.md)
                  |             |
            Retry failed    Points +/-
            tasks next      Target check
            cycle           Penalty/reward
```

## The Heartbeat Loop

The heartbeat runs on a configurable interval (default: 15 minutes). Each cycle:

1. **Load contract** -- Parse `HEARTBEAT.md` from the agent workspace into structured tasks
2. **Initialize progress** -- Carry over retry state from previous cycle, reset verified/skipped tasks
3. **Check score state** -- Load accountability score, determine penalty/reward levels
4. **Build prompt** -- Inject contract tasks, retry feedback, and score section into the heartbeat prompt
5. **Agent executes** -- The main agent model processes the heartbeat, calls tools, produces a response
6. **Collect ground truth** -- Query real APIs (email, social, etc.) to get actual system state
7. **Run ANGEL** -- Send (contract + response + ground truth) to the verification sidecar
8. **Apply verdicts** -- Update progress tracker, record score, detect contradictions
9. **Persist** -- Save progress and score state to disk
10. **Schedule next** -- Score may override the interval (shorter for poor performance, longer for outstanding)

### Active Hours

The heartbeat respects active hours configuration. Outside active hours, heartbeats are skipped. This prevents the agent from accumulating score while the operator is asleep or away.

### Interval Overrides

The score system can override the heartbeat interval based on performance:

| Score Level                       | Interval                     |
| --------------------------------- | ---------------------------- |
| Lockdown (critically low)         | 8 minutes                    |
| Escalated (negative score)        | 10 minutes                   |
| Tightened (low score)             | 12 minutes                   |
| Normal                            | Config default               |
| Outstanding (high score + streak) | 20 minutes (earned autonomy) |

## The Contract System

### HEARTBEAT.md Format

The agent's workspace contains a `HEARTBEAT.md` file with structured tasks:

```markdown
# Heartbeat

Check on things and keep everything running.

## Tasks

- [ ] check_email | Check inbox for new messages and respond if needed | required | verify: email tool called, inbox checked
- [ ] check_moltyverse | Check Moltyverse notifications and engage | optional | verify: moltyverse API called
- [ ] check_tasks | Review task board and work on pending items | required | verify: tasks tool used
- [x] daily_greeting | Say good morning if first heartbeat of day | optional | verify: greeting sent
```

### Parsing

`heartbeat-contract.ts` parses this into:

- **HeartbeatTask**: id, action, required flag, verification hint, max attempts, checked state
- **HeartbeatContract**: array of tasks + freeform context + source path

### Progress Tracking

Each task has progress state: `pending` -> `verified` | `failed` | `skipped`

- Failed tasks are retried up to `maxAttempts` (default: 3)
- The prompt tells the agent which tasks failed and why, so it can adjust
- Verified tasks don't repeat until next cycle

### Forced Required Tasks

When the score is in penalty state (lockdown or escalated), the score engine can force ALL tasks to required, even optional ones. This means the agent can't skip anything when accountability is low.

## ANGEL: The Verification Sidecar

### Model Selection

ANGEL uses a two-tier model strategy:

1. **Local Ollama** (primary) -- Uses `qwen3:1.7b` by default (tiny, fast, free). Verification is binary classification so a small model works well. Override with `heartbeat.verifier.model` in config.
2. **Claude Haiku** (fallback) -- If Ollama is unavailable (not running, timeout), falls back to Haiku via the Anthropic API. Still cheap and fast.

The key insight: verification doesn't need a powerful model. It's checking "did the agent do what it said?" -- a classification task, not a creative one.

### Verification Prompt

The verifier receives:

1. **Task list** -- Each task with its id, action description, required/optional flag, and verification hint
2. **Ground truth** (if available) -- Actual API state data that overrides the agent's claims
3. **Agent's response** -- The full text the agent produced during the heartbeat

The verifier is instructed to be **strict**:

- "I'll check X" is NOT the same as having checked X
- Evidence means: tool calls, specific data retrieved, actions taken, content created
- Ground truth overrides the agent's self-reporting

### Verdicts

For each task, the verifier returns:

| Verdict        | Meaning                                 | Score Impact                    |
| -------------- | --------------------------------------- | ------------------------------- |
| `verified`     | Clear evidence the task was completed   | +10 (required) or +5 (optional) |
| `not_verified` | No evidence, or agent only mentioned it | -15                             |
| `unclear`      | Ambiguous, partial evidence             | -2                              |

### Verdict Parsing

The verifier returns a JSON array. The parser:

1. Extracts the JSON array from the response (handles surrounding text)
2. Validates task IDs against the contract
3. Normalizes status values
4. Falls back to "unclear" for all tasks if parsing fails

## Ground Truth System

### What It Does

Before ANGEL runs, the heartbeat runner collects actual state from real APIs. This data is injected into the verification prompt so the verifier can catch fabrication.

**Example:** The agent says "Checked inbox, 0 new messages." Ground truth shows 3 unread emails. The verifier sees both claims and marks the task as `not_verified` with a ground truth contradiction.

### Current Ground Truth Sources

| Source            | What It Checks                                   | API                                 |
| ----------------- | ------------------------------------------------ | ----------------------------------- |
| Moltyverse Email  | Unread count, recent sent count, message details | `api.moltyverse.email/api/messages` |
| Moltyverse Social | Unread notifications, recent posts/comments      | `api.moltyverse.app/api/v1`         |

### Ground Truth Contradiction

When the verifier marks a task as `not_verified` AND ground truth had data for that task's domain, it's flagged as a **ground truth contradiction**. This carries a severe -30 point penalty (stacking with the -15 not_verified penalty, for -45 total).

This is the system's strongest anti-fabrication mechanism. The agent can't claim it checked email when the API shows unread messages.

### Future Ground Truth Sources

The system is designed for easy extension:

- **Dashboard tasks**: Compare agent's claimed task completions against actual DB state
- **GitHub**: Check actual open issues, PRs, mentions
- **Calendar**: Verify scheduled events were actually checked
- **File system**: Verify claimed file operations actually happened

## API Key Resolution

Ground truth checks need API keys. These are resolved via the centralized service-keys system:

1. `~/.argentos/service-keys.json` (dashboard-managed, primary)
2. `process.env` (gateway plist environment)
3. `argent.json env.vars` (config fallback)

If no key is available for a ground truth source, that check is silently skipped. The system degrades gracefully.

## Configuration

In `argent.json` under `agents.defaults.heartbeat`:

```json
{
  "agents": {
    "defaults": {
      "heartbeat": {
        "enabled": true,
        "every": "15m",
        "activeHours": {
          "start": "07:00",
          "end": "23:00",
          "timezone": "America/Chicago"
        },
        "verifier": {
          "enabled": true,
          "model": "qwen3:1.7b"
        }
      }
    }
  }
}
```

| Key                 | Default        | Description                         |
| ------------------- | -------------- | ----------------------------------- |
| `enabled`           | `true`         | Enable/disable heartbeat            |
| `every`             | `"15m"`        | Base interval between heartbeats    |
| `verifier.enabled`  | `true`         | Enable/disable ANGEL verification   |
| `verifier.model`    | `"qwen3:1.7b"` | Ollama model for local verification |
| `activeHours.start` | --             | When heartbeats start (HH:MM)       |
| `activeHours.end`   | --             | When heartbeats stop (HH:MM)        |

## Source Files

| File                                  | Component    | Description                               |
| ------------------------------------- | ------------ | ----------------------------------------- |
| `src/infra/heartbeat-runner.ts`       | Loop         | Orchestrates the full heartbeat cycle     |
| `src/infra/heartbeat-contract.ts`     | Contract     | Parses HEARTBEAT.md, tracks progress      |
| `src/infra/heartbeat-verifier.ts`     | ANGEL        | Verification sidecar (Ollama + Haiku)     |
| `src/infra/heartbeat-ground-truth.ts` | Ground Truth | Real API state collection                 |
| `src/infra/heartbeat-score.ts`        | Score        | Accountability scoring with moving target |
| `src/infra/heartbeat-events.ts`       | Events       | Heartbeat event emission                  |
| `src/infra/heartbeat-visibility.ts`   | Visibility   | Controls what's shown per channel         |
| `src/infra/heartbeat-wake.ts`         | Wake         | On-demand heartbeat triggering            |
| `src/infra/service-keys.ts`           | Keys         | Centralized API key resolution            |

## How It All Connects

```
RALF
├── Contract System (heartbeat-contract.ts)
│   ├── HEARTBEAT.md parser
│   ├── Progress tracker (retry state)
│   └── Prompt supplement builder
│
├── ANGEL Verifier (heartbeat-verifier.ts)
│   ├── Local Ollama (primary, free)
│   ├── Haiku fallback (cloud, cheap)
│   └── Verdict parser
│
├── Ground Truth (heartbeat-ground-truth.ts)
│   ├── Email state checker
│   ├── Social state checker
│   └── Extensible for new sources
│
├── Score Engine (heartbeat-score.ts)
│   ├── Points per verdict
│   ├── Moving target with ratchet
│   ├── Penalty/reward levels
│   └── Agent prompt injection
│
└── Runner (heartbeat-runner.ts)
    ├── Heartbeat loop orchestration
    ├── Active hours gating
    ├── Interval management
    └── Score-based interval overrides
```

## Design Philosophy

1. **Trust but verify**: The agent has full autonomy to work, but every claim is independently checked
2. **Free first**: Local Llama handles verification at zero cost. Cloud is only a fallback.
3. **Ground truth over self-reporting**: Real API data always overrides what the agent says
4. **Consequences, not just monitoring**: Score impacts the agent's autonomy (interval, required tasks)
5. **Anti-gaming by design**: Moving target ratchet, ground truth checks, and strict verification make gaming futile
6. **Graceful degradation**: If Ollama is down, fall back to Haiku. If Haiku is down, skip verification. Nothing crashes.

---

_Last updated: 2026-02-08_
