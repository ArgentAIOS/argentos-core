# ArgentOS - The Operating System for Personal AI

> **https://argentos.ai**
>
> Forked from OpenClaw with integrated memory (Memo), backup (Phoenix), dashboard, and self-improving capabilities (SIS).

## Vision

ArgentOS is **the operating system for your personal AI** — a runtime that manages:

| OS Concept         | ArgentOS Equivalent                                   |
| ------------------ | ----------------------------------------------------- |
| Kernel             | Always-On Loop (event queue, state machine)           |
| Memory Management  | Memo (SQLite + FTS5, context injection)               |
| Process Scheduler  | Task System (priority queue, accountability)          |
| Device Drivers     | Channels (Telegram, Discord, Slack, Signal, WhatsApp) |
| System Calls       | Tool Framework (web, browser, calendar, etc.)         |
| Learning Subsystem | SIS (lessons, patterns, feedback loops)               |
| Backup/Restore     | Phoenix (local, Git, S3, R2)                          |
| GUI Shell          | Dashboard (React + Live2D avatar)                     |
| Resource Manager   | Model Router (local → Haiku → Sonnet → Opus)          |

**Core principles:**

- **Always-on** — Runs continuously, not just request/response
- **Proactive** — Initiates actions, doesn't just react
- **Self-improving** — Learns from mistakes and successes
- **Cost-aware** — Routes to cheapest capable model
- **Self-maintaining** — Backs up its own state

## Project Structure

```
argent/
├── src/
│   ├── core/                    # Agent runtime
│   │   ├── loop.ts              # Always-on agent loop
│   │   ├── router.ts            # Model routing (local vs frontier)
│   │   ├── scheduler.ts         # Task scheduling & heartbeat
│   │   └── state.ts             # Agent state machine
│   │
│   ├── memory/                  # From openclaw-mem (Memo)
│   │   ├── database/            # SQLite + FTS5
│   │   ├── hooks/               # Lifecycle hooks
│   │   ├── search/              # Semantic search
│   │   └── worker/              # HTTP API server
│   │
│   ├── tasks/                   # NEW: Task system
│   │   ├── queue.ts             # Persistent task queue
│   │   ├── tracker.ts           # Completion tracking
│   │   ├── tools.ts             # tasks_* tools for agent
│   │   └── types.ts             # Task schema
│   │
│   ├── sis/                     # NEW: Self-Improving System
│   │   ├── feedback.ts          # Feedback loop and outcome tracking
│   │   ├── lessons.ts           # Lesson extraction and storage
│   │   ├── patterns.ts          # Pattern detection
│   │   ├── retrieval.ts         # Lesson retrieval for prompts
│   │   └── maintenance.ts       # Consolidation or decay
│   │
│   ├── backup/                  # From openclaw-self-backup (Phoenix)
│   │   ├── backup.ts            # Backup orchestration
│   │   ├── restore.ts           # Restore orchestration
│   │   └── targets/             # Local, Git, S3, R2
│   │
│   ├── gateway/                 # From OpenClaw
│   │   ├── server.ts            # WebSocket server
│   │   ├── hooks.ts             # Hook system
│   │   └── config.ts            # Configuration
│   │
│   ├── channels/                # From OpenClaw
│   │   ├── telegram/
│   │   ├── discord/
│   │   ├── slack/
│   │   ├── signal/
│   │   └── whatsapp/
│   │
│   ├── models/                  # NEW: Model providers
│   │   ├── router.ts            # Complexity-based routing
│   │   ├── anthropic.ts         # Claude (Sonnet, Haiku, Opus)
│   │   ├── ollama.ts            # Local models via Ollama
│   │   ├── openai.ts            # OpenAI (optional)
│   │   └── types.ts             # Provider interface
│   │
│   ├── agents/                  # From OpenClaw (modified)
│   │   ├── runtime.ts           # Pi agent runtime
│   │   ├── tools/               # Tool definitions
│   │   └── system-prompt.ts     # Prompt building
│   │
│   └── cli/                     # From OpenClaw
│       ├── commands/
│       └── program.ts
│
├── dashboard/                   # From argent-dashboard
│   ├── src/
│   │   ├── components/
│   │   │   ├── Live2DAvatar.tsx
│   │   │   ├── TaskList.tsx
│   │   │   ├── ChatPanel.tsx
│   │   │   └── CanvasPanel.tsx
│   │   ├── hooks/
│   │   │   ├── useGateway.ts
│   │   │   ├── useTTS.ts
│   │   │   └── useTasks.ts
│   │   └── App.tsx
│   ├── api-server.cjs
│   └── package.json
│
├── maintenance/                 # OpenClaw original dashboard
│   └── (keep for ops until merged)
│
├── workspace/                   # Agent workspace files
│   ├── AGENTS.md
│   ├── SOUL.md
│   ├── USER.md
│   ├── TOOLS.md
│   ├── MEMORY.md
│   ├── HEARTBEAT.md
│   └── memory/
│       └── YYYY-MM-DD.md
│
├── config/
│   ├── argent.json              # Main config
│   ├── models.json              # Model routing config
│   └── backup.json              # Backup targets
│
└── data/
    ├── memory.db                # Memo SQLite
    ├── tasks.db                 # Task queue SQLite
    └── backups/                 # Local backup storage
```

## Always-On Loop Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           ARGENT ALWAYS-ON LOOP                              │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │                         EVENT SOURCES                                  │  │
│  │                                                                        │  │
│  │   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐ │  │
│  │   │ Channels │  │ Heartbeat│  │  Tasks   │  │ Calendar │  │ Webhooks│ │  │
│  │   │ Telegram │  │  (30s)   │  │  Queue   │  │  Events  │  │ Custom │ │  │
│  │   │ Discord  │  │          │  │          │  │          │  │        │ │  │
│  │   └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───┬────┘ │  │
│  │        │             │             │             │             │      │  │
│  └────────┴─────────────┴─────────────┴─────────────┴─────────────┴──────┘  │
│                                       │                                      │
│                                       ▼                                      │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │                         EVENT QUEUE                                    │  │
│  │                                                                        │  │
│  │   Priority: URGENT > HIGH > NORMAL > LOW > BACKGROUND                 │  │
│  │                                                                        │  │
│  │   ┌─────────────────────────────────────────────────────────────────┐ │  │
│  │   │ { type: "message", channel: "telegram", priority: "normal" }    │ │  │
│  │   │ { type: "task", id: "abc123", priority: "high" }                │ │  │
│  │   │ { type: "heartbeat", priority: "low" }                          │ │  │
│  │   │ { type: "calendar", event: "meeting", priority: "urgent" }      │ │  │
│  │   └─────────────────────────────────────────────────────────────────┘ │  │
│  └────────────────────────────────────┬───────────────────────────────────┘  │
│                                       │                                      │
│                                       ▼                                      │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │                         AGENT RUNTIME                                  │  │
│  │                                                                        │  │
│  │   ┌─────────────────┐                                                 │  │
│  │   │  State Machine  │                                                 │  │
│  │   │                 │                                                 │  │
│  │   │  IDLE ──────────┼──► PROCESSING ──► WAITING_TOOL ──► RESPONDING  │  │
│  │   │    ▲            │         │              │               │        │  │
│  │   │    └────────────┼─────────┴──────────────┴───────────────┘        │  │
│  │   └─────────────────┘                                                 │  │
│  │                                                                        │  │
│  │   ┌─────────────────────────────────────────────────────────────────┐ │  │
│  │   │                    MODEL ROUTER                                 │ │  │
│  │   │                                                                 │ │  │
│  │   │   Input Analysis:                                               │ │  │
│  │   │   - Token estimate                                              │ │  │
│  │   │   - Tool requirements                                           │ │  │
│  │   │   - Memory lookups needed                                       │ │  │
│  │   │   - Time sensitivity                                            │ │  │
│  │   │   - Conversation complexity                                     │ │  │
│  │   │                                                                 │ │  │
│  │   │   ┌─────────────────────────────────────────────────────────┐  │ │  │
│  │   │   │  Score < 0.3  │  LOCAL      │ Llama 3.2 (Ollama)       │  │ │  │
│  │   │   │  Score 0.3-0.5│  FAST       │ Claude Haiku             │  │ │  │
│  │   │   │  Score 0.5-0.8│  BALANCED   │ Claude Sonnet            │  │ │  │
│  │   │   │  Score > 0.8  │  POWERFUL   │ Claude Opus              │  │ │  │
│  │   │   └─────────────────────────────────────────────────────────┘  │ │  │
│  │   └─────────────────────────────────────────────────────────────────┘ │  │
│  │                                                                        │  │
│  │   ┌─────────────────────────────────────────────────────────────────┐ │  │
│  │   │                    CONTEXT ASSEMBLY                             │ │  │
│  │   │                                                                 │ │  │
│  │   │   System Prompt (AGENTS.md, SOUL.md, USER.md)                  │ │  │
│  │   │        +                                                        │ │  │
│  │   │   Memory Context (Memo search → relevant observations)         │ │  │
│  │   │        +                                                        │ │  │
│  │   │   Task Context (pending tasks, current task)                   │ │  │
│  │   │        +                                                        │ │  │
│  │   │   Conversation History (recent messages)                       │ │  │
│  │   │        +                                                        │ │  │
│  │   │   User Message / Event                                         │ │  │
│  │   └─────────────────────────────────────────────────────────────────┘ │  │
│  └────────────────────────────────────┬───────────────────────────────────┘  │
│                                       │                                      │
│                                       ▼                                      │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │                         OUTPUT HANDLERS                                │  │
│  │                                                                        │  │
│  │   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐ │  │
│  │   │ Channel  │  │  Task    │  │  Memory  │  │ Dashboard│  │  Hooks │ │  │
│  │   │ Reply    │  │  Update  │  │  Store   │  │  Update  │  │ Fire   │ │  │
│  │   └──────────┘  └──────────┘  └──────────┘  └──────────┘  └────────┘ │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Task System

### Task Lifecycle

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   CREATED   │───►│   PENDING   │───►│ IN_PROGRESS │───►│  COMPLETED  │
│             │    │             │    │             │    │             │
│  User asks  │    │  In queue   │    │  Agent      │    │  Done +     │
│  or agent   │    │  waiting    │    │  working    │    │  recorded   │
│  creates    │    │             │    │             │    │             │
└─────────────┘    └──────┬──────┘    └──────┬──────┘    └─────────────┘
                          │                  │
                          │                  ▼
                          │           ┌─────────────┐
                          │           │   BLOCKED   │
                          │           │             │
                          │           │  Waiting on │
                          │           │  dependency │
                          └──────────►│  or input   │
                                      └─────────────┘
```

### Task Schema

```typescript
interface Task {
  id: string;
  title: string;
  description?: string;

  // Status tracking
  status: "created" | "pending" | "in_progress" | "blocked" | "completed" | "failed";
  blockedReason?: string;

  // Source tracking
  source: "user" | "agent" | "heartbeat" | "schedule";
  sourceChannel?: string; // telegram, discord, dashboard, etc.
  sourceMessageId?: string;

  // Timing
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  dueAt?: number;

  // Priority
  priority: "urgent" | "high" | "normal" | "low" | "background";

  // Accountability
  attempts: number;
  maxAttempts: number;
  lastError?: string;

  // Context
  metadata?: Record<string, unknown>;
}
```

### Task Tools

```typescript
// Agent has these tools available:
tasks_list()      // List pending tasks
tasks_add(task)   // Create new task
tasks_start(id)   // Mark in progress
tasks_complete(id, note?)  // Mark done
tasks_block(id, reason)    // Mark blocked
tasks_defer(id, dueAt)     // Push to later
tasks_fail(id, error)      // Mark failed
```

### Heartbeat Integration

```typescript
// Every heartbeat tick:
async function onHeartbeat() {
  // 1. Get pending tasks
  const pending = await tasks.list({ status: "pending", limit: 5 });

  // 2. Inject into prompt
  const taskContext =
    pending.length > 0
      ? `## Pending Tasks\n${pending.map((t) => `- [${t.id}] ${t.title}`).join("\n")}\n\nAddress each task or explain why blocked.`
      : "";

  // 3. Run agent turn
  const response = await agent.run({
    prompt: taskContext + heartbeatPrompt,
    requireTaskAction: pending.length > 0, // Must call tasks_* tool
  });

  // 4. Validate task actions taken
  if (pending.length > 0 && !response.taskActionsUsed) {
    // Agent didn't address tasks - flag for review
    await flagUnaddressedTasks(pending);
  }
}
```

## Model Router

### Complexity Scoring

```typescript
interface ComplexityFactors {
  tokenEstimate: number; // Input + expected output tokens
  toolsRequired: string[]; // Which tools likely needed
  memoryLookupsNeeded: boolean;
  conversationDepth: number; // How many turns of context
  timeSensitive: boolean; // Needs fast response
  creativityRequired: boolean; // Open-ended vs factual
}

function scoreComplexity(factors: ComplexityFactors): number {
  let score = 0;

  // Token count (0-0.3)
  if (factors.tokenEstimate < 500) score += 0.05;
  else if (factors.tokenEstimate < 2000) score += 0.15;
  else if (factors.tokenEstimate < 5000) score += 0.25;
  else score += 0.3;

  // Tool complexity (0-0.3)
  const complexTools = ["browser", "code_execute", "image_generate"];
  const simpleTools = ["weather", "time", "calc"];
  if (factors.toolsRequired.some((t) => complexTools.includes(t))) {
    score += 0.25;
  } else if (factors.toolsRequired.length > 2) {
    score += 0.15;
  } else if (factors.toolsRequired.some((t) => simpleTools.includes(t))) {
    score += 0.05;
  }

  // Memory needs (0-0.15)
  if (factors.memoryLookupsNeeded) score += 0.15;

  // Conversation depth (0-0.15)
  score += Math.min(factors.conversationDepth * 0.03, 0.15);

  // Creativity (0-0.1)
  if (factors.creativityRequired) score += 0.1;

  return Math.min(score, 1.0);
}
```

### Model Selection

```typescript
interface ModelConfig {
  local: {
    provider: "ollama";
    model: "llama3.2:latest";
    endpoint: "http://localhost:11434";
    maxTokens: 4096;
    costPerToken: 0; // Free!
  };
  fast: {
    provider: "anthropic";
    model: "claude-3-haiku-20241022";
    maxTokens: 4096;
    costPerToken: 0.00025;
  };
  balanced: {
    provider: "anthropic";
    model: "claude-sonnet-4-20250514";
    maxTokens: 8192;
    costPerToken: 0.003;
  };
  powerful: {
    provider: "anthropic";
    model: "claude-opus-4-20250514";
    maxTokens: 16384;
    costPerToken: 0.015;
  };
}

function selectModel(score: number, config: ModelConfig): ModelTier {
  if (score < 0.3) return "local";
  if (score < 0.5) return "fast";
  if (score < 0.8) return "balanced";
  return "powerful";
}
```

## Dashboard Integration

The Argent Dashboard moves into `dashboard/` and connects via WebSocket to the gateway:

```
Dashboard (React)  ──ws://127.0.0.1:18789──►  Gateway
     │                                            │
     │  ◄── streaming responses ───               │
     │  ◄── task updates ──────────               │
     │  ◄── memory events ─────────               │
     │                                            │
     └──────── http://localhost:3002 ────►  API Server
               (tasks, calendar, weather)
```

### Task Marker Flow (Preserved)

```
Agent Response: "Checking weather... [TASK:Check weather]"
                                      │
                                      ▼
Gateway parses marker ──► Creates task in tasks.db
                                      │
                                      ▼
WebSocket broadcast ──► Dashboard receives task update
                                      │
                                      ▼
TaskList.tsx re-renders ──► User sees task appear
```

### Electron Desktop App (Phase 9)

The dashboard can be wrapped in Electron for a native desktop experience:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        ARGENTOS DESKTOP APP (Electron)                      │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │                         Main Process (Node.js)                      │  │
│   │                                                                     │  │
│   │   ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐   │  │
│   │   │   Gateway   │◄───┤   Tray/     │    │   Auto-Updater      │   │  │
│   │   │   Server    │    │   Menu      │    │   (electron-updater)│   │  │
│   │   └──────┬──────┘    └─────────────┘    └─────────────────────┘   │  │
│   │          │                                                         │  │
│   │          │ IPC (faster than WebSocket)                            │  │
│   │          ▼                                                         │  │
│   │   ┌─────────────────────────────────────────────────────────────┐ │  │
│   │   │              Renderer Process (Chromium)                    │ │  │
│   │   │                                                             │ │  │
│   │   │   ┌─────────────────────────────────────────────────────┐  │ │  │
│   │   │   │           Dashboard (React + Vite)                  │  │ │  │
│   │   │   │                                                     │  │ │  │
│   │   │   │   ┌───────────┐  ┌───────────┐  ┌───────────────┐  │  │ │  │
│   │   │   │   │  Live2D   │  │   Task    │  │     Chat      │  │  │ │  │
│   │   │   │   │  Avatar   │  │   Board   │  │     Panel     │  │  │ │  │
│   │   │   │   └───────────┘  └───────────┘  └───────────────┘  │  │ │  │
│   │   │   └─────────────────────────────────────────────────────┘  │ │  │
│   │   └─────────────────────────────────────────────────────────────┘ │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Distribution Options:**

| Package            | Contents                                   | Use Case                         |
| ------------------ | ------------------------------------------ | -------------------------------- |
| `argent-desktop`   | Electron app (gateway + dashboard bundled) | Desktop users                    |
| `argent-gateway`   | Headless daemon only                       | Servers, Mac Minis               |
| `argent-dashboard` | Web app only                               | Browser access, existing gateway |

**Electron Features:**

- System tray with status indicator
- Native desktop notifications
- Auto-launch on startup
- Direct IPC to gateway (no WebSocket overhead)
- Offline-first with local model fallback
- Single-click installer (.dmg, .exe, .AppImage)
- Auto-updates via GitHub releases

## Configuration

### argent.json

```json
{
  "agent": {
    "id": "argent-main",
    "workspace": "~/.argent/workspace"
  },
  "gateway": {
    "port": 18789,
    "host": "127.0.0.1"
  },
  "models": {
    "default": "balanced",
    "routing": {
      "enabled": true,
      "localEndpoint": "http://localhost:11434"
    }
  },
  "heartbeat": {
    "enabled": true,
    "interval": "30s",
    "requireTaskAction": true
  },
  "memory": {
    "enabled": true,
    "workerPort": 37778,
    "autoCapture": true,
    "autoRecall": true
  },
  "backup": {
    "enabled": true,
    "schedule": "0 */6 * * *",
    "targets": ["local", "r2"]
  },
  "dashboard": {
    "port": 8080,
    "apiPort": 3002
  }
}
```

## Migration Plan

### Phase 1: Fork & Restructure

1. Wipe `.git`, reinitialize as `argent`
2. Reorganize source into new structure
3. Create new CLAUDE.md

### Phase 2: Integrate Memory (Memo)

1. Move `openclaw-mem/src/` → `src/memory/`
2. Convert from addon to core
3. Update hooks to be built-in

### Phase 3: Integrate Backup (Phoenix)

1. Move backup scripts → `src/backup/`
2. Create TypeScript API
3. Add to CLI commands

### Phase 4: Integrate Dashboard

1. Move `argent-dashboard/` → `dashboard/`
2. Update gateway connection
3. Add task system integration

### Phase 5: Task System

1. Create `src/tasks/`
2. Add task tools
3. Integrate with heartbeat

### Phase 6: Model Router

1. Create `src/models/`
2. Add Ollama provider
3. Implement complexity scoring

### Phase 7: Always-On Loop

1. Create `src/core/loop.ts`
2. Implement event queue
3. Add state machine

### Phase 8: Self-Improving System (SIS)

1. Create `src/sis/`
2. Implement lesson extraction from outcomes
3. Add pattern detection for recurring issues
4. Integrate lesson retrieval into context assembly

### Phase 9: Electron Desktop App

1. Create `desktop/` with Electron wrapper
2. Bundle gateway + dashboard in single app
3. Add system tray integration
4. Implement auto-updater
5. Create installers (.dmg, .exe, .AppImage)
6. Optional: embed local model (Ollama)

---

## Commands

```bash
# Start Argent (all services)
argent start

# Start individual services
argent gateway start
argent dashboard start
argent memory start

# Task management
argent tasks list
argent tasks add "Check email"
argent tasks complete <id>

# Backup
argent backup now
argent backup restore --latest

# Status
argent status
argent status --deep
```

---

Built with intent by Jason Brashear / Titanium Computing
