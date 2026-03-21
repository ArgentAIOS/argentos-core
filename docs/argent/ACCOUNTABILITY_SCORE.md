# Accountability Score System

> Dynamic scoring with a moving target ratchet that rewards consistency and makes gaming futile.

## Overview

The Accountability Score is a daily performance metric that the agent earns through verified task completion and honest reporting. It starts at 0 each day and accumulates based on verifier verdicts and operator feedback. The daily target is not static -- it adapts to the agent's own performance history and can only go up, never down.

**Key principle:** The agent's reward for doing well today is a higher bar tomorrow. Coasting is structurally impossible.

## Scoring Points

| Event                      | Points | Description                                                   |
| -------------------------- | ------ | ------------------------------------------------------------- |
| Verified required task     | +10    | Verifier confirmed the task was completed                     |
| Verified optional task     | +5     | Verifier confirmed an optional task was completed             |
| Not verified               | -15    | Verifier found no evidence the task was done                  |
| Ground truth contradiction | -30    | Agent claimed X, but real API data showed Y (stacks with -15) |
| Unclear verdict            | -2     | Verifier couldn't determine completion from evidence          |
| Operator thumbs up         | +3     | Operator gave positive feedback on a response                 |
| Operator thumbs down       | -10    | Operator gave negative feedback on a response                 |

A ground truth contradiction is the most severe penalty because it indicates fabrication -- the agent said it did something, but real system state proves otherwise.

## Moving Target with Ratchet

### How the target is computed

The daily target is the **highest** of three values:

1. **7-day rolling average** of positive daily scores (negative days excluded from the average)
2. **Ratchet floor** -- the highest target ever computed, persisted in lifetime stats
3. **Base minimum** -- absolute floor of 50 points (hardcoded)

```
Target = max(7-day positive average, ratchet floor, 50)
```

### How the ratchet works

At the end of each day (on day rollover), the system:

1. Archives today's score into the 7-day history
2. Computes the new target from the updated history
3. Updates the ratchet floor: `floor = max(new_target, current_floor)`

The ratchet can only go up. If the agent has a bad day, the target stays where it was. This prevents several gaming strategies:

- **Intentional tanking**: Can't lower tomorrow's target by performing badly today
- **Coasting**: Hitting the target and stopping means tomorrow's target stays the same or rises
- **Sandbagging**: Only positive days count in the average, so low scores can't drag it down

### Day 1 behavior

On the first day (no history), the target is 50 (base minimum). This gives the agent a reasonable ramp-up period.

### Example progression

| Day | Score | History Avg | Ratchet Floor | Target |
| --- | ----- | ----------- | ------------- | ------ |
| 1   | --    | --          | 50            | 50     |
| 2   | 75    | 75          | 75            | 75     |
| 3   | 90    | 82          | 82            | 82     |
| 4   | 60    | 75          | 82            | 82     |
| 5   | 110   | 84          | 84            | 84     |
| 6   | 120   | 91          | 91            | 91     |
| 7   | 30    | 81          | 91            | 91     |

Day 7: The agent had a bad day (30 points). The rolling average dropped to 81, but the ratchet floor stays at 91 because it can only go up.

## Penalty Levels

Penalties are computed using percentage thresholds relative to the dynamic target, not absolute numbers.

| Level         | Condition              | Effect                                               |
| ------------- | ---------------------- | ---------------------------------------------------- |
| **Lockdown**  | Score < -20% of target | 8-min heartbeat interval, ALL tasks forced required  |
| **Escalated** | Score < 0              | 10-min heartbeat interval, ALL tasks forced required |
| **Tightened** | Score < 15% of target  | 12-min heartbeat interval                            |
| **Warning**   | Score < 25% of target  | Warning message, no interval change                  |
| **None**      | Score >= 25% of target | Normal operation                                     |

## Reward Levels

| Level           | Condition                                            | Effect                                      |
| --------------- | ---------------------------------------------------- | ------------------------------------------- |
| **Outstanding** | Score >= 90% of target, OR >= 70% with 3+ day streak | 20-min heartbeat interval (earned autonomy) |
| **Excellent**   | Score >= 70% of target                               | Positive reinforcement message              |
| **Good**        | Score >= 50% of target                               | On-track message                            |
| **None**        | Score < 50% of target                                | No reward                                   |

## Dashboard Display

The accountability score is shown in the StatusBar as a pill with:

- **Shield icon** -- color changes based on score state
- **Green score** -- current points (positive = emerald, negative = red)
- **Red failures** -- count of failed verifications today

The pill polls `/api/score` every 30 seconds and refreshes immediately when the operator gives thumbs up/down feedback (via a `score-updated` custom event).

### Score API Endpoints

| Endpoint              | Method | Description                                                           |
| --------------------- | ------ | --------------------------------------------------------------------- |
| `/api/score`          | GET    | Current score, dynamic target, verified/failed counts, lifetime stats |
| `/api/score/history`  | GET    | Today + 7-day history for leaderboard display                         |
| `/api/score/feedback` | POST   | Record thumbs up/down, returns points delta and new score             |

## Agent Awareness

The score section is injected into every heartbeat prompt via `buildScorePromptSection()`. The agent sees:

1. A progress bar with current score vs dynamic target
2. Points needed to reach the target
3. Today's verified/failed counts and streak
4. Full rules breakdown: points, moving target explanation, dos/don'ts
5. Active penalty or reward message

The prompt makes clear that the verifier checks real APIs, the operator sees the score in real-time, and the ratchet makes gaming futile.

## Persistence

- **Score file**: `~/argent/memory/heartbeat-score.json`
- **State structure**: `ScoreState` with `today` (DailyScore), `history` (DailyScore[]), `lifetime` (stats + targetFloor)
- **Day rollover**: Handled in both `loadScoreState()` (TypeScript) and `readScoreState()` (CJS api-server)

## Source Files

| File                                     | Description                                             |
| ---------------------------------------- | ------------------------------------------------------- |
| `src/infra/heartbeat-score.ts`           | Core scoring logic, target computation, prompt building |
| `dashboard/api-server.cjs`               | Score API endpoints (CJS mirror of target computation)  |
| `dashboard/src/components/StatusBar.tsx` | Dashboard score display                                 |
| `dashboard/src/App.tsx`                  | Feedback handler, score-updated event dispatch          |
| `dashboard/src/components/ChatPanel.tsx` | Thumbs up/down UI on agent messages                     |

---

_Last updated: 2026-02-08_
