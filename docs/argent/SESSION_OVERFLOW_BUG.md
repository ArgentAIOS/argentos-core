# Bug: Recurring Session File Overflow Kills Agent

**Status:** Unresolved — manually patched 4+ times
**Severity:** Critical — agent becomes completely unresponsive
**Date:** 2026-02-19 (latest occurrence)

## Summary

The Pi embedded runner stores conversation history in JSONL session files at `~/.argentos/agents/main/sessions/{uuid}.jsonl`. These files grow without bound. When the file exceeds the routed model's context window, the API returns a context overflow error and the agent cannot respond to any messages. The auto-compaction mechanism attempts to fix this but consistently fails, leaving the agent permanently broken until manual intervention.

## Symptoms

1. User sends a message in the dashboard chat
2. Agent shows "thinking" briefly, then goes idle with no response
3. Gateway log shows: `Context overflow: prompt too large for the model. Try again with less input or a larger-context model.`
4. Dashboard chat shows zero visible messages (chat was cleared/restarted) but the underlying session file is massive
5. Restarting the gateway does NOT fix it — same session file is reloaded
6. The `sessions.reset` RPC from the dashboard UI resets the chat display but does NOT truncate or rotate the session file

## Root Cause

### Session file accumulation

- Session files are append-only JSONL: `~/.argentos/agents/main/sessions/{sessionId}.jsonl`
- Every user message, assistant response, tool call, and tool result is appended
- Over days of use, a single session can grow to 2MB+ (500K+ tokens)
- The webchat session persists across gateway restarts — it's identified by UUID stored in `sessions.json`

### Auto-compaction fails silently

When context overflow is detected (`src/agents/pi-embedded-runner/run.ts:481`), the code attempts auto-compaction via `compactEmbeddedPiSessionDirect()`. This fails because:

1. **Rate limiting:** Compaction itself requires an LLM call. If the account is rate-limited (common with Max subscriptions), compaction fails
2. **Too large to compact:** If the session is so large that even the compaction prompt overflows, it's a dead end
3. **Ollama fallback limited:** The code tries Ollama/Qwen3 as a compaction fallback, but local models can't handle 500K+ token sessions either
4. **No progressive compaction:** It tries to compact the entire session in one shot rather than incrementally

### Model router makes it worse

The model router (`src/models/router.ts`) routes short/simple prompts to Sonnet (fast tier, 200K context). But the context budget is consumed by the session history, not the prompt. A "hello" message scores 0.35 → routes to Sonnet → overflows because the session file has 2MB of history appended.

## What the manual fix looks like

Every time this happens, we do:

```bash
# 1. Find the bloated session
ls -lt ~/.argentos/agents/main/sessions/*.jsonl | head -5

# 2. Backup and truncate
cp $SESSION_FILE ${SESSION_FILE}.bak
tail -20 $SESSION_FILE > ${SESSION_FILE}.tmp && mv ${SESSION_FILE}.tmp $SESSION_FILE

# 3. Restart gateway
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/ai.argent.gateway.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.argent.gateway.plist
```

This has been done 4+ times since February 2026.

## Proposed Fix

### 1. Proactive session size guard (immediate)

Before sending to the API, check session file size. If it exceeds a threshold (e.g., 200KB / ~50K tokens), auto-compact BEFORE the API call — don't wait for the overflow error.

**Location:** `src/agents/pi-embedded-runner/run.ts`, before the `runPromptAttempt()` call (~line 455)

```
// Pseudocode
const sessionSize = getSessionFileSize(params.sessionFile);
if (sessionSize > MAX_SESSION_BYTES) {
  await compactSession(params);
}
```

### 2. Progressive compaction (medium-term)

Instead of compacting the entire session at once, compact in chunks:

- Take the oldest N messages (not the most recent)
- Summarize them into a single "context summary" message
- Replace those N messages with the summary
- Repeat until the session is under the threshold

This avoids the "compaction prompt itself overflows" problem.

### 3. Session rotation (belt-and-suspenders)

When `sessions.reset` is called from the dashboard:

- Generate a new session UUID
- Create a fresh session file
- Optionally carry forward a compacted summary from the old session
- Update `sessions.json` to point to the new session

Currently `sessions.reset` only clears the dashboard's in-memory chat — the Pi session file persists.

### 4. Context budget awareness in model router

The model router should factor in session size when choosing the model:

- If session file > 100KB, bump minimum tier to `balanced` (Sonnet with more headroom)
- If session file > 500KB, force compaction before routing
- Expose session token estimate as a routing signal

## Key Files

| File                                             | Role                                                       |
| ------------------------------------------------ | ---------------------------------------------------------- |
| `src/agents/pi-embedded-runner/run.ts:455-555`   | Prompt execution + overflow detection + compaction attempt |
| `src/agents/pi-embedded-helpers/errors.ts:6`     | `isContextOverflowError()` detection                       |
| `src/agents/session-snapshot.ts`                 | Session snapshot (compaction summary persistence)          |
| `src/agents/compact.ts`                          | `compactEmbeddedPiSessionDirect()` — the compaction logic  |
| `src/models/router.ts`                           | Model tier routing (doesn't account for session size)      |
| `~/.argentos/agents/main/sessions/`              | Session JSONL files (the source of the problem)            |
| `~/.argentos/agents/main/sessions/sessions.json` | Session registry (maps session keys to UUIDs)              |

## Reproduction

1. Use the dashboard chat for a few hours with tool-heavy conversations
2. Check session size: `ls -la ~/.argentos/agents/main/sessions/*.jsonl | sort -k5 -n | tail -5`
3. When the active session exceeds ~1.5MB, send a simple message
4. Observe: agent goes silent, gateway log shows context overflow
