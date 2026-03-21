# Self-Improving System (SIS) Architecture

> ArgentOS learns from its actions, mistakes, and successes.
>
> Part of **ArgentOS** — https://argentos.ai

## Overview

The SIS layer enables Argent to:

1. **Observe** — Track outcomes of actions
2. **Evaluate** — Assess what worked vs. what didn't
3. **Learn** — Extract lessons and patterns
4. **Apply** — Use lessons to improve future decisions

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        SELF-IMPROVING SYSTEM (SIS)                           │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                         FEEDBACK LOOP                                │   │
│   │                                                                      │   │
│   │    ACTION ──► OUTCOME ──► EVALUATION ──► LESSON ──► MEMORY BANK     │   │
│   │       ▲                                                    │         │   │
│   │       └────────────────── RETRIEVAL ◄─────────────────────┘         │   │
│   │                                                                      │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                       MEMORY BANKS                                   │   │
│   │                                                                      │   │
│   │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │   │
│   │   │   LESSONS    │  │   PATTERNS   │  │  PREFERENCES │             │   │
│   │   │   LEARNED    │  │   DETECTED   │  │   INFERRED   │             │   │
│   │   │              │  │              │  │              │             │   │
│   │   │ • Mistakes   │  │ • Time-based │  │ • User likes │             │   │
│   │   │ • Successes  │  │ • Tool combos│  │ • User hates │             │   │
│   │   │ • Workarounds│  │ • Failure    │  │ • Work style │             │   │
│   │   │ • Best paths │  │   patterns   │  │ • Comm style │             │   │
│   │   └──────────────┘  └──────────────┘  └──────────────┘             │   │
│   │                                                                      │   │
│   │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │   │
│   │   │    TOOL      │  │   CONTEXT    │  │   MODEL      │             │   │
│   │   │   KNOWLEDGE  │  │   AWARENESS  │  │   FEEDBACK   │             │   │
│   │   │              │  │              │  │              │             │   │
│   │   │ • API quirks │  │ • Project    │  │ • Which model│             │   │
│   │   │ • Rate limits│  │   specific   │  │   worked best│             │   │
│   │   │ • Edge cases │  │ • User-      │  │ • Complexity │             │   │
│   │   │ • Workarounds│  │   specific   │  │   estimates  │             │   │
│   │   └──────────────┘  └──────────────┘  └──────────────┘             │   │
│   │                                                                      │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Memory Bank Types

### 1. Lessons Learned

Things discovered through experience that should be remembered.

```typescript
interface Lesson {
  id: string;
  type: "mistake" | "success" | "workaround" | "discovery";

  // What happened
  context: string; // "Trying to send WhatsApp message to group"
  action: string; // "Used sendMessage with group JID"
  outcome: string; // "Failed - group JID format was wrong"

  // What was learned
  lesson: string; // "WhatsApp group JIDs must end with @g.us"
  correction?: string; // "Always append @g.us to group IDs"

  // Metadata
  confidence: number; // 0-1, increases with repeated validation
  occurrences: number; // How many times this came up
  lastSeen: number; // Timestamp

  // Retrieval
  tags: string[]; // ['whatsapp', 'groups', 'jid', 'format']
  relatedTools: string[]; // ['whatsapp_send', 'message']
}
```

**Examples:**

```
MISTAKE: "When user says 'remind me tomorrow', I should ask what time,
          not assume 9am. User prefers afternoon reminders."

SUCCESS: "Using bullet points instead of paragraphs for task summaries
          gets better user engagement."

WORKAROUND: "ElevenLabs API sometimes returns 429. Wait 2 seconds and
             retry up to 3 times before falling back to system TTS."

DISCOVERY: "User's calendar has recurring 'Focus Time' blocks - don't
            schedule interruptions during these."
```

### 2. Patterns Detected

Recurring behaviors and correlations.

```typescript
interface Pattern {
  id: string;
  type: "temporal" | "sequential" | "failure" | "success" | "preference";

  // Pattern definition
  description: string;
  triggers: string[]; // What conditions activate this pattern
  frequency: number; // How often it occurs

  // Evidence
  observations: string[]; // IDs of supporting observations
  confidence: number;

  // Application
  recommendation?: string; // What to do when pattern detected
}
```

**Examples:**

```
TEMPORAL: "User typically asks for weather between 7-8am.
           Proactively check at 6:55am."

SEQUENTIAL: "After 'check email' task, user often asks 'respond to X'.
             Prepare draft responses proactively."

FAILURE: "API calls to silver-prices.com fail on weekends.
          Use backup source (metals-api.com) on Sat/Sun."
```

### 3. Tool Knowledge

Accumulated knowledge about how tools actually work in practice.

```typescript
interface ToolKnowledge {
  toolName: string;

  // Learned constraints
  rateLimits?: {
    requests: number;
    period: string;
    discovered: number; // timestamp
  };

  // Edge cases
  edgeCases: Array<{
    condition: string;
    behavior: string;
    workaround?: string;
  }>;

  // Best practices
  bestPractices: string[];

  // Failure modes
  commonErrors: Array<{
    error: string;
    cause: string;
    solution: string;
  }>;
}
```

### 4. Model Feedback

Learning which models work best for which tasks.

```typescript
interface ModelFeedback {
  taskType: string; // 'code_review', 'creative_writing', etc.

  // Performance by model
  modelPerformance: Record<
    string,
    {
      attempts: number;
      successes: number;
      avgLatency: number;
      avgTokens: number;
      userSatisfaction: number; // inferred from reactions
    }
  >;

  // Learned routing
  recommendedModel: string;
  complexityAdjustment: number; // Adjust base complexity score
}
```

## Feedback Loop Implementation

### 1. Observation Collection

```typescript
// After every action, record the outcome
interface ActionOutcome {
  actionId: string;
  action: {
    type: string;
    tool?: string;
    input: unknown;
  };
  outcome: {
    success: boolean;
    result?: unknown;
    error?: string;
    latency: number;
  };
  context: {
    model: string;
    taskId?: string;
    sessionKey: string;
  };
  userFeedback?: {
    explicit?: "positive" | "negative" | "neutral";
    implicit?: "continued" | "abandoned" | "corrected";
  };
}
```

### 2. Evaluation Engine

```typescript
class EvaluationEngine {
  // Analyze outcome and determine if lesson should be extracted
  async evaluate(outcome: ActionOutcome): Promise<EvaluationResult> {
    const signals: EvaluationSignal[] = [];

    // Check for explicit failure
    if (!outcome.outcome.success) {
      signals.push({
        type: "failure",
        severity: this.assessSeverity(outcome.outcome.error),
        suggestion: await this.suggestCorrection(outcome),
      });
    }

    // Check for user correction
    if (outcome.userFeedback?.implicit === "corrected") {
      signals.push({
        type: "correction",
        severity: "medium",
        suggestion: "User had to correct - analyze what was wrong",
      });
    }

    // Check for repeated pattern
    const similar = await this.findSimilarOutcomes(outcome);
    if (similar.length >= 3) {
      signals.push({
        type: "pattern",
        severity: "low",
        suggestion: "Recurring situation - consider extracting pattern",
      });
    }

    return { signals, shouldLearn: signals.length > 0 };
  }
}
```

### 3. Lesson Extraction

```typescript
class LessonExtractor {
  // Use a fast model to extract lessons from outcomes
  async extractLesson(
    outcome: ActionOutcome,
    evaluation: EvaluationResult,
  ): Promise<Lesson | null> {
    const prompt = `
Analyze this action outcome and extract a lesson if applicable.

ACTION: ${JSON.stringify(outcome.action)}
OUTCOME: ${JSON.stringify(outcome.outcome)}
EVALUATION: ${JSON.stringify(evaluation)}

If there's a useful lesson to remember for future similar situations,
respond with a JSON lesson object. If not, respond with null.

Focus on:
- What went wrong (or right) and why
- How to handle this better next time
- Any workarounds or best practices discovered
`;

    // Use local model for this (cheap, fast)
    const result = await this.models.run("local", prompt, {});
    return this.parseLesson(result);
  }
}
```

### 4. Memory Bank Storage

```typescript
// Lessons stored in SQLite with FTS5 for search
const LESSONS_SCHEMA = `
CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  context TEXT NOT NULL,
  action TEXT NOT NULL,
  outcome TEXT NOT NULL,
  lesson TEXT NOT NULL,
  correction TEXT,
  confidence REAL DEFAULT 0.5,
  occurrences INTEGER DEFAULT 1,
  last_seen INTEGER NOT NULL,
  tags TEXT, -- JSON array
  related_tools TEXT, -- JSON array
  created_at INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS lessons_fts USING fts5(
  context, action, outcome, lesson, correction, tags,
  content='lessons',
  content_rowid='rowid'
);
`;
```

### 5. Retrieval and Application

```typescript
class LessonRetriever {
  // Before taking an action, check for relevant lessons
  async getRelevantLessons(context: {
    action: string;
    tool?: string;
    userMessage?: string;
  }): Promise<Lesson[]> {
    // Search by tool
    const toolLessons = context.tool ? await this.db.search({ relatedTools: context.tool }) : [];

    // Search by semantic similarity
    const semanticLessons = await this.db.ftsSearch(
      `${context.action} ${context.userMessage || ""}`,
    );

    // Combine and rank by relevance + confidence
    return this.rankLessons([...toolLessons, ...semanticLessons]);
  }

  // Inject lessons into prompt
  formatForPrompt(lessons: Lesson[]): string {
    if (lessons.length === 0) return "";

    return `
## Lessons from Past Experience

${lessons
  .map(
    (l) =>
      `- **${l.type.toUpperCase()}**: ${l.lesson}${
        l.correction ? `\n  → Correction: ${l.correction}` : ""
      }`,
  )
  .join("\n")}

Apply these lessons to avoid repeating mistakes.
`;
  }
}
```

## Integration with Always-On Loop

```typescript
// In the always-on loop, inject lessons before processing
async handleMessage(event: AgentEvent): Promise<void> {
  // ... existing code ...

  // 2.5 Get relevant lessons (NEW)
  const lessons = await this.deps.sis.getRelevantLessons({
    action: 'respond_to_message',
    userMessage: payload.text,
  });
  const lessonContext = this.deps.sis.formatForPrompt(lessons);

  // 3. Get memory context
  const memoryContext = await this.deps.memory.getContext({ maxTokens: 2000 });

  // 4. Build prompt with lessons
  const prompt = `${memoryContext}${lessonContext}${taskContext}\n\nUser: ${payload.text}`;

  // ... rest of processing ...

  // 8. After response, record outcome for learning (NEW)
  await this.deps.sis.recordOutcome({
    actionId: generateId(),
    action: { type: 'message_response', input: payload.text },
    outcome: { success: true, result: response.text, latency: elapsed },
    context: { model: tier, sessionKey: payload.sessionKey },
  });
}
```

## Heartbeat Learning Review

During low-activity periods, Argent reviews and consolidates lessons:

```typescript
async handleHeartbeat(event: AgentEvent): Promise<void> {
  // ... existing task handling ...

  // If no urgent tasks, do learning maintenance
  if (pendingTasks.length === 0) {
    await this.deps.sis.maintenanceCycle();
  }
}

// In SIS module
async maintenanceCycle(): Promise<void> {
  // 1. Review recent outcomes for patterns
  const recentOutcomes = await this.getRecentOutcomes({ hours: 24 });
  const patterns = await this.detectPatterns(recentOutcomes);

  for (const pattern of patterns) {
    await this.storePattern(pattern);
  }

  // 2. Consolidate similar lessons
  const duplicates = await this.findDuplicateLessons();
  for (const group of duplicates) {
    await this.consolidateLessons(group);
  }

  // 3. Decay old, unvalidated lessons
  await this.decayOldLessons({ olderThan: days(30), minConfidence: 0.3 });

  // 4. Promote frequently-validated lessons
  await this.promoteValidatedLessons({ minOccurrences: 5 });
}
```

## User Feedback Integration

```typescript
// Explicit feedback (user says "that was wrong" or "perfect!")
async handleUserFeedback(
  feedback: 'positive' | 'negative',
  recentAction: ActionOutcome
): Promise<void> {
  // Update outcome with feedback
  await this.updateOutcome(recentAction.actionId, {
    userFeedback: { explicit: feedback }
  });

  // If negative, trigger immediate lesson extraction
  if (feedback === 'negative') {
    const lesson = await this.extractLesson(recentAction, {
      signals: [{ type: 'user_negative', severity: 'high' }],
      shouldLearn: true
    });

    if (lesson) {
      await this.storeLesson(lesson);

      // Optionally confirm with user
      await this.confirmLesson(lesson);
    }
  }

  // If positive, boost confidence in recent lessons used
  if (feedback === 'positive') {
    const usedLessons = await this.getLessonsUsedInAction(recentAction);
    for (const lesson of usedLessons) {
      await this.boostConfidence(lesson.id, 0.1);
    }
  }
}
```

## Example Lessons Database

```sql
-- Example lessons that Argent might accumulate:

INSERT INTO lessons VALUES (
  'les_001',
  'mistake',
  'User asked to check silver prices',
  'Called silver-api.com on Sunday',
  'API returned 503 - service unavailable on weekends',
  'Silver price APIs often have weekend maintenance. Use cached data or backup source.',
  'Check day of week before calling silver-api.com. Use metals-api.com as fallback.',
  0.9,
  7,
  1707145200,
  '["silver", "api", "weekend", "fallback"]',
  '["fetch_silver_price", "web_fetch"]',
  1706886000
);

INSERT INTO lessons VALUES (
  'les_002',
  'success',
  'User asked for meeting summary',
  'Used bullet points with action items highlighted',
  'User responded positively and shared with team',
  'Meeting summaries work best with: 1) Key decisions, 2) Action items with owners, 3) Next steps',
  NULL,
  0.85,
  12,
  1707145200,
  '["meetings", "summary", "format", "action-items"]',
  '["calendar", "message"]',
  1706540000
);

INSERT INTO lessons VALUES (
  'les_003',
  'workaround',
  'Sending long message to Telegram',
  'Message exceeded 4096 character limit',
  'Message was truncated, user missed important info',
  'Telegram has 4096 char limit. Split long messages or use file attachment.',
  'Check message length before sending. If > 4000 chars, split into multiple messages or attach as file.',
  0.95,
  15,
  1707145200,
  '["telegram", "message", "length", "limit"]',
  '["telegram_send", "message"]',
  1706280000
);
```

## Configuration

```json
{
  "sis": {
    "enabled": true,
    "lessonExtraction": {
      "model": "local", // Use local model for extraction
      "minConfidenceToStore": 0.3,
      "maxLessonsPerDay": 50
    },
    "retrieval": {
      "maxLessonsInPrompt": 5,
      "minConfidenceToUse": 0.5,
      "recencyBias": 0.2 // Prefer recent lessons
    },
    "maintenance": {
      "consolidationInterval": "6h",
      "decayAfterDays": 30,
      "decayRate": 0.1
    },
    "feedback": {
      "askForConfirmation": false, // Don't pester user
      "trackImplicitFeedback": true
    }
  }
}
```

---

## Summary

The SIS layer makes Argent a **learning system** that:

1. **Remembers mistakes** and doesn't repeat them
2. **Recognizes patterns** in user behavior and external systems
3. **Accumulates tool knowledge** from experience
4. **Improves model routing** based on actual performance
5. **Self-maintains** through consolidation and decay

This transforms Argent from a stateless assistant into a **growing intelligence** that becomes more effective over time.

---

_SIS Architecture designed 2026-02-05_
