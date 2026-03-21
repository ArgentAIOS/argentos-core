# Bug: DRL-Enforced Total Lockout (All Anthropic Profiles Simultaneously Rate-Limited)

**Status:** Recurring — mitigated by multi-profile failover but not solved
**Severity:** Critical — agent becomes completely unresponsive for extended periods
**Date:** 2026-02-19 (latest), 2026-02-18, multiple prior occurrences

## Summary

All three Anthropic Max subscription profiles (`anthropic:titanium`, `anthropic:webdevtoday`, `anthropic:semfreak`) hit their daily/weekly rate limits simultaneously, causing every API call to return HTTP 429. The failover system cycles through all three profiles, gets 429 on each, puts them all into cooldown, and the agent is locked out entirely. Background systems (contemplation, cron jobs, SIS) continue attempting requests during this period, further depleting quota and preventing recovery.

## What Happens

### The Cascade

1. **Contemplation loop burns quota in the background.** Runs every 5 minutes, calls Ollama for prompt generation then Anthropic for the actual agent nudge. Over hours, this silently consumes significant quota.
2. **Cron jobs stack up.** Daily AI Intel Brief (6 AM), Morning Briefing (8:30 AM), and other scheduled jobs each trigger full agent sessions with tool use — heavy token consumers.
3. **User sends a message.** Model router selects Sonnet/Opus based on complexity score.
4. **First profile hits 429.** `markAuthProfileFailure()` with reason `"rate_limit"` applies cooldown (5s → 10s → 20s → 40s max via `calculateAuthProfileCooldownMs`).
5. **Failover to second profile.** Same 429 — it's an account-wide rate limit, not per-key.
6. **Failover to third profile.** Same 429.
7. **All profiles in cooldown.** `runWithModelFallback` logs: `"All models failed (3): anthropic/claude-sonnet-4-6: HTTP 429 rate_limit_error"`.
8. **Agent returns UNAVAILABLE** to the dashboard. User sees no response.
9. **Cooldowns expire in 5-40 seconds.** Next request tries again → hits 429 again → re-enters cooldown. Repeat.
10. **Background systems keep trying.** Contemplation, heartbeat, SIS all make their own API calls, compounding the rate limit pressure.

### Observed Log Examples

```
[2026-02-18 14:45:28] All models failed (3): anthropic/claude-sonnet-4-6: HTTP 429 rate_limit_error
[2026-02-18 14:45:56] All models failed (3): anthropic/claude-sonnet-4-6: HTTP 429 rate_limit_error
[2026-02-19 04:28:08] All models failed (3): anthropic/claude-opus-4-6: HTTP 429 rate_limit_error
[2026-02-19 04:31:48] All models failed (3): anthropic/claude-sonnet-4-6: HTTP 429 rate_limit_error
[2026-02-19 04:33:40] All models failed (3): anthropic/claude-sonnet-4-6: HTTP 429 rate_limit_error
```

The agent's own contemplation noted: "ALL three Anthropic profiles were in cooldown simultaneously — provider-wide cooldown."

### Why Three Profiles Don't Help

All three subscriptions (`titanium`, `webdevtoday`, `semfreak`) are Anthropic Max $200/month plans. They share the same rate limit structure:

- **Per-minute token limits** (transient — clear in seconds)
- **Daily token limits** (clear at midnight UTC)
- **Weekly quota** (clear weekly, the real killer)

The failover system treats each profile as independent, but the rate limits hit the same window. When one profile is limited, it's usually because the overall usage pattern has hit the provider's limits — switching profiles just burns through all three faster.

## Root Causes

### 1. Background systems don't respect rate budget

Contemplation runs every 5 minutes and calls the Anthropic API. Over 24 hours, that's 288 API calls just for contemplation. Add heartbeat cycles, SIS evaluations, cron jobs, and channel polling — the agent is making hundreds of API calls per day before the user even sends a message.

**Key file:** `src/infra/contemplation-runner.ts` — calls `agentCommand()` which goes through the model router and hits Anthropic.

### 2. Cooldown durations are too short for DRL

The rate limit cooldown maxes at 40 seconds (`calculateAuthProfileCooldownMs` in `src/agents/auth-profiles/usage.ts:185-191`). This is appropriate for transient per-minute limits but catastrophically wrong for daily/weekly rate limits. When you hit a DRL:

- 40-second cooldown expires → retry → 429 again → 40-second cooldown → repeat
- Each retry counts against the rate limit, making recovery take longer
- All three profiles cycle through this loop simultaneously

### 3. No distinction between transient and DRL rate limits

The API returns `HTTP 429 rate_limit_error` for both per-minute and daily/weekly limits. The code treats all 429s identically with the same short exponential backoff. The `Retry-After` header (when present) is not being used to determine cooldown duration.

### 4. Billing disabled lockout is different but related

The code distinguishes `"billing"` failures (separate from rate limits) with much longer backoffs: 5-hour base, 24-hour max, escalating (`calculateAuthProfileBillingDisableMsWithConfig` in usage.ts:258-269). But 429 rate limits are NOT classified as billing — they go through the 5s-40s cooldown path.

### 5. No global "provider is down" circuit breaker

Each profile is tracked independently. There's no concept of "Anthropic as a whole is rate-limited." The system could save API calls by recognizing that if all three Anthropic profiles hit 429 within 60 seconds, the problem is provider-wide and retrying any Anthropic profile is futile for a longer period.

## Current Mitigation (Partial)

- **Multi-profile failover:** 3 Max subscriptions rotate. Helps with per-key limits but not DRL.
- **MiniMax as alternative:** `minimax:coding-plan` profile exists but can't handle mid-session fallback (tool call ID format mismatch causes HTTP 400).
- **Z.AI as alternative:** `zai:default` profile with GLM-4.7 available but not in the Anthropic fallback chain.
- **Ollama local:** Qwen3 30B-A3B runs locally but can't use tools, limiting its usefulness as a fallback for interactive sessions.

## Proposed Fixes

### 1. Detect DRL vs transient rate limits (immediate)

Parse the `Retry-After` header from 429 responses. If present and > 60 seconds, treat as DRL and apply a proportional cooldown rather than the 40-second max.

**Location:** `src/agents/pi-embedded-helpers/errors.ts` and the error handling in `model-fallback.ts`

### 2. Provider-level circuit breaker (medium-term)

When all profiles for a provider hit 429 within a short window (e.g., 60 seconds), mark the entire provider as rate-limited for a longer period (e.g., 15 minutes). Don't retry individual profiles.

```
// Pseudocode
if (allAnthropicProfilesFailedRecently(within: 60_000)) {
  setProviderCooldown("anthropic", 15 * 60 * 1000); // 15 min
  fallbackToAlternateProvider(); // ZAI, MiniMax, or Ollama
}
```

### 3. Background system rate budget (medium-term)

Implement a token budget for background systems:

- Track daily API usage per system (contemplation, heartbeat, SIS, cron)
- When usage exceeds budget, pause that system or route to local Ollama
- Reserve a portion of the daily budget for interactive user messages

**Key systems to gate:**

- Contemplation: `src/infra/contemplation-runner.ts`
- Heartbeat verification: `src/infra/heartbeat-verifier.ts`
- SIS self-eval: `src/infra/sis-self-eval.ts`
- Cron sessions: `src/commands/cron.ts`

### 4. Cross-provider fallback for interactive messages (medium-term)

When Anthropic is rate-limited, fall back to ZAI/MiniMax/Ollama for user-facing messages rather than returning UNAVAILABLE. Requires:

- Fixing the tool call ID format mismatch for MiniMax (or starting fresh sessions)
- Adding ZAI to the agent fallback chain
- Graceful degradation: "I'm currently running on a backup model with limited capabilities"

### 5. Usage dashboard + alerts (nice-to-have)

Surface rate limit status in the dashboard:

- Show which profiles are available/cooldown/disabled
- Show estimated remaining daily budget
- Alert when approaching DRL threshold
- Let the user manually pause background systems to preserve budget

## Key Files

| File                                               | Role                                                            |
| -------------------------------------------------- | --------------------------------------------------------------- |
| `src/agents/auth-profiles/usage.ts`                | Profile cooldown calculation, failure tracking, circuit breaker |
| `src/agents/auth-profiles/order.ts`                | Profile rotation ordering                                       |
| `src/agents/auth-profiles/store.ts`                | Profile persistence (JSON file)                                 |
| `src/agents/auth-profiles/types.ts`                | ProfileUsageStats, AuthProfileFailureReason                     |
| `src/agents/model-fallback.ts`                     | `runWithModelFallback()` — the failover loop                    |
| `src/agents/pi-embedded-helpers/errors.ts`         | Error classification (rate limit detection)                     |
| `src/agents/pi-embedded-runner/run.ts`             | Main agent run loop, retry logic                                |
| `src/infra/contemplation-runner.ts`                | Background API consumer (every 5 min)                           |
| `src/infra/heartbeat-verifier.ts`                  | Background API consumer (periodic)                              |
| `src/infra/sis-self-eval.ts`                       | Background API consumer (per-episode)                           |
| `~/.argentos/agents/main/agent/auth-profiles.json` | Runtime profile state + cooldown timestamps                     |

## Auth Profile State Schema

```jsonc
{
  "profiles": {
    "anthropic:titanium": { "provider": "anthropic" /* setup token */ },
    "anthropic:webdevtoday": { "provider": "anthropic" /* setup token */ },
    "anthropic:semfreak": { "provider": "anthropic" /* setup token */ },
  },
  "usageStats": {
    "anthropic:titanium": {
      "errorCount": 0, // Resets on success or cooldown expiry
      "cooldownUntil": null, // Epoch ms — transient rate limit backoff (max 40s)
      "disabledUntil": null, // Epoch ms — billing lockout backoff (hours)
      "disabledReason": null, // "billing" when disabled
      "lastUsed": 1771515000,
      "lastFailureAt": null,
      "failureCounts": {}, // { "rate_limit": N, "billing": N, ... }
    },
  },
  "lastGood": {
    "anthropic": "anthropic:titanium", // Last profile that succeeded
  },
}
```

## Cooldown Progression

| Failure Type     | Progression          | Max | Code                                               |
| ---------------- | -------------------- | --- | -------------------------------------------------- |
| Rate limit (429) | 5s → 10s → 20s → 40s | 40s | `calculateAuthProfileCooldownMs()`                 |
| Timeout          | 5s → 10s → 20s → 30s | 30s | `calculateTimeoutCooldownMs()`                     |
| Format error     | Fixed 30s            | 30s | Hard-coded                                         |
| Billing          | 5h → 10h → 20h → 24h | 24h | `calculateAuthProfileBillingDisableMsWithConfig()` |

**The gap:** DRL (daily rate limit) returns 429 but needs minutes-to-hours of cooldown, not 40 seconds. There is no separate handling for DRL vs transient 429.

## Reproduction

1. Run the agent with contemplation enabled for several hours
2. Trigger a few cron jobs (morning brief, intel brief)
3. Have a tool-heavy conversation
4. Observe: eventually all three Anthropic profiles hit 429 simultaneously
5. Agent becomes unresponsive — dashboard shows errors, gateway logs show "All models failed"
6. Recovery requires waiting for the provider's rate window to reset (usually hours)
