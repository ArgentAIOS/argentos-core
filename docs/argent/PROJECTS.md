# Projects & Task System

> ArgentOS Phase 5 — Task management with project grouping

## Overview

The Task System gives the agent accountability. Tasks flow through a lifecycle (pending → in_progress → completed/failed/blocked), the agent manages them via tools, and the dashboard shows real-time progress.

**Projects** group related tasks under a parent. The agent decomposes work into projects when it detects multi-step intent.

## Architecture

### Data Layer

Tasks live in `~/.argentos/data/dashboard.db` (SQLite), shared by the agent runtime and dashboard API.

```
tasks table
├── id (UUID)
├── title, description
├── status: pending | in_progress | blocked | completed | failed | cancelled
├── priority: urgent | high | normal | low | background
├── source: user | agent | heartbeat | schedule
├── parent_task_id → tasks(id)   # FK for project children
├── metadata (JSON)              # { type: "project" } for project parents
├── tags (JSON array)
├── due_at, started_at, completed_at
└── agent_id, session_id, channel_id
```

A **project** is a task with `metadata.type = "project"`. Child tasks reference it via `parent_task_id`. No schema migration needed.

### Agent Tool

The `tasks` tool exposes these actions:

| Action           | Description                                                   |
| ---------------- | ------------------------------------------------------------- |
| `add`            | Create a task (optionally under a project via `parentTaskId`) |
| `list`           | List tasks with optional status/priority filters              |
| `start`          | Move task to `in_progress`                                    |
| `complete`       | Mark task as `completed`                                      |
| `block`          | Mark task as `blocked` with reason                            |
| `fail`           | Mark task as `failed` with reason                             |
| `delete`         | Remove a task                                                 |
| `search`         | Full-text search across tasks                                 |
| `project_create` | Create a project with child tasks                             |
| `project_list`   | List all projects with progress                               |
| `project_detail` | Get project with all child tasks                              |

### Dashboard

- **Tasks tab** — Active tasks, pending tasks, recently completed
- **Projects tab** — Project cards with progress bars, click to expand child tasks
- **Schedule tab** — Cron jobs and scheduled tasks

### Markers

The agent emits markers in its response stream for instant UI updates:

- `[TASK_DONE:title]` — Dashboard immediately marks matching task as done
- `[TTS:text]` — Dashboard speaks the text via ElevenLabs

These provide instant feedback before the next 5-second poll cycle.

## Task Lifecycle

```
   ┌──────────┐
   │  PENDING  │
   └─────┬─────┘
         │ tasks.start()
         ▼
   ┌──────────────┐
   │ IN_PROGRESS  │
   └──┬─────┬─────┘
      │     │
      │     ├──► COMPLETED (tasks.complete())
      │     │
      ├──►  BLOCKED (tasks.block(reason))
      │          │
      │          └──► IN_PROGRESS (unblock → restart)
      │
      └──► FAILED (tasks.fail(reason))
```

## Project Flow

1. User describes multi-step work
2. Agent creates project via `tasks` tool with `action: project_create`
3. Dashboard shows project card with `0/N` progress
4. Agent works through child tasks, calling `start` and `complete`
5. Dashboard updates progress bar in real-time
6. When all children complete, project shows as done

### Example

User: "Set up monitoring for the production servers"

Agent creates:

```
Project: Production Server Monitoring
├── Install Prometheus and Grafana
├── Configure alert rules
├── Set up dashboards
├── Test alert pipeline
└── Document runbook
```

## API Routes

| Method | Path                      | Description                  |
| ------ | ------------------------- | ---------------------------- |
| GET    | `/api/tasks`              | List all tasks               |
| POST   | `/api/tasks`              | Create a task                |
| PATCH  | `/api/tasks/:id`          | Update a task                |
| DELETE | `/api/tasks/:id`          | Delete a task                |
| POST   | `/api/tasks/:id/start`    | Start a task                 |
| POST   | `/api/tasks/:id/complete` | Complete a task              |
| GET    | `/api/projects`           | List projects with counts    |
| GET    | `/api/projects/:id`       | Project detail with children |
| POST   | `/api/projects`           | Create a project             |

## Key Files

| File                                    | Purpose                                   |
| --------------------------------------- | ----------------------------------------- |
| `src/data/tasks.ts`                     | Core TasksModule — CRUD, projects, search |
| `src/data/types.ts`                     | Task, Project, Filter type definitions    |
| `src/data/connection.ts`                | SQLite connection manager                 |
| `src/data/index.ts`                     | DataAPI facade                            |
| `src/agents/tools/tasks-tools.ts`       | Agent tool definition                     |
| `dashboard/src/db/tasksDb.cjs`          | Dashboard-side DB access                  |
| `dashboard/api-server.cjs`              | REST API routes                           |
| `dashboard/src/hooks/useTasks.ts`       | React hook for task/project state         |
| `dashboard/src/components/TaskList.tsx` | Task & project UI components              |
