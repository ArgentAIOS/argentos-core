# ArgentOS Documentation Index

> **https://argentos.ai** — The Operating System for Personal AI
>
> GitHub: [ArgentAIOS](https://github.com/ArgentAIOS) • Forked from OpenClaw

## Architecture

| Document                                                                                                                           | Description                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ARGENT_ARCHITECTURE.md](../../ARGENT_ARCHITECTURE.md)                                                                             | Full vision, project structure, always-on loop, task system, model router                                                                                                                                                              |
| [RALF_ANGEL.md](./RALF_ANGEL.md)                                                                                                   | RALF + ANGEL — Response Accountability Llama Framework & verification loop                                                                                                                                                             |
| [ACCOUNTABILITY_SCORE.md](./ACCOUNTABILITY_SCORE.md)                                                                               | Accountability scoring — moving target with ratchet, penalties, rewards                                                                                                                                                                |
| [SIS_ARCHITECTURE.md](./SIS_ARCHITECTURE.md)                                                                                       | Self-Improving System — lessons learned, pattern detection, feedback loops                                                                                                                                                             |
| [PROJECTS.md](./PROJECTS.md)                                                                                                       | Task system & projects — lifecycle, agent tools, dashboard UI                                                                                                                                                                          |
| [MINION_PATTERN.md](./MINION_PATTERN.md)                                                                                           | Minion pattern — inter-session task handoff for cron jobs                                                                                                                                                                              |
| [AEVP_OVERVIEW.md](./AEVP_OVERVIEW.md)                                                                                             | AEVP — Architecture, rendering pipeline, gestures, identity presets                                                                                                                                                                    |
| [AEVP_STATUS.md](./AEVP_STATUS.md)                                                                                                 | AEVP — Per-phase implementation status with file tables                                                                                                                                                                                |
| [STORAGE_BRIDGE_ARCHITECTURE.md](./STORAGE_BRIDGE_ARCHITECTURE.md)                                                                 | PG+Redis three-lane data flow, adapter pattern, subsystem mapping                                                                                                                                                                      |
| [SIS_MIGRATION_PATH.md](./SIS_MIGRATION_PATH.md)                                                                                   | SIS corruption history, PG fix, family consolidation vision                                                                                                                                                                            |
| [SPECFORGE_INTENT_ENFORCEMENT.md](./SPECFORGE_INTENT_ENFORCEMENT.md)                                                               | SpecForge runtime wiring, intent enforcement boundaries, strict operation. **Core Rule**: A PRD is the human planning artifact; upon approval, it becomes the PRP (Prompted Requirements Plan), which is the executable master prompt. |
| [INTENT_AND_SUPPORT_PLAYBOOK.md](./INTENT_AND_SUPPORT_PLAYBOOK.md)                                                                 | Guided Intent UX + customer support behavior contract (intent + RAG + validators)                                                                                                                                                      |
| [WORKFORCE_INTENT_QUICKSTART.md](./WORKFORCE_INTENT_QUICKSTART.md)                                                                 | Five-minute operator guide for intent, workforce, simulation, and promotion                                                                                                                                                            |
| [RELATIONSHIP_ALIGNMENT_ARCHITECTURE.md](./RELATIONSHIP_ALIGNMENT_ARCHITECTURE.md)                                                 | Architecture for relationship-preserving roles, simulation gates, scoring, and promotion                                                                                                                                               |
| [RELATIONSHIP_ALIGNMENT_IMPLEMENTATION_ROADMAP.md](./RELATIONSHIP_ALIGNMENT_IMPLEMENTATION_ROADMAP.md)                             | Canonical implementation sequence to keep Workforce aligned with relationship-preserving role synthesis                                                                                                                                |
| [ACIS.md](./ACIS.md)                                                                                                               | Argent Continuous Improvement System — reusable closed-loop framework for contracts, telemetry, staged experiments, promotion, and rollback                                                                                            |
| [MEMORY_V3_OPERATOR_GUIDE.md](./MEMORY_V3_OPERATOR_GUIDE.md)                                                                       | Operator-facing guide to vaults, knowledge library, Cognee retrieval, discovery phase, and current safety model                                                                                                                        |
| [CD_V1_PLAN.md](./CD_V1_PLAN.md)                                                                                                   | Contracted Dispatch v1 phased execution plan with hard gates                                                                                                                                                                           |
| [CD_V1_TRACKER.md](./CD_V1_TRACKER.md)                                                                                             | Contracted Dispatch v1 progress tracker, baseline, and blocker protocol                                                                                                                                                                |
| [CD_V1_RUNBOOK.md](./CD_V1_RUNBOOK.md)                                                                                             | Contracted Dispatch v1 operator validation runbook and incident checks                                                                                                                                                                 |
| [ECONOMIC_WORKER_LAYER_BRIEF.md](./ECONOMIC_WORKER_LAYER_BRIEF.md)                                                                 | Economic transparency layer for jobs and workers: cost, value, margin, alerts, and leaderboard                                                                                                                                         |
| [OPERATOR_SETUP_PORTAL.md](./OPERATOR_SETUP_PORTAL.md)                                                                             | Single operator truth: setup values, verification logs, and incident triage                                                                                                                                                            |
| [OPERATOR_DOCS_SPRINT_PLAN.md](./OPERATOR_DOCS_SPRINT_PLAN.md)                                                                     | Cross-repo sprint board for docs, health surface, backups, and merge stabilization                                                                                                                                                     |
| [MEMORY_SIS_ISSUE_PACK.md](./MEMORY_SIS_ISSUE_PACK.md)                                                                             | Memory health, MemU guardrails, SIS parse hardening, and verification runbook                                                                                                                                                          |
| [MEMORY_ARCHITECTURE_V3_OBSIDIAN_COGNEE_INTEGRATION.md](./MEMORY_ARCHITECTURE_V3_OBSIDIAN_COGNEE_INTEGRATION.md)                   | Obsidian vault + Cognee knowledge graph integration plan for a four-source memory retrieval architecture                                                                                                                               |
| [ARGENTMUNCH_EPIC.md](./ARGENTMUNCH_EPIC.md)                                                                                       | Epic plan for shared code-intelligence MCP (multi-repo symbol indexing)                                                                                                                                                                |
| [CSM_PROVIDER_BUILD_PLAN.md](./CSM_PROVIDER_BUILD_PLAN.md)                                                                         | Concrete build plan for integrating Sesame CSM as an Argent voice provider with MemU continuity support                                                                                                                                |
| [MVP_VOICE_SYSTEM_PLAN.md](./MVP_VOICE_SYSTEM_PLAN.md)                                                                             | Concrete MVP plan for one-thread voice: Swift owns audio, dashboard owns visible chat                                                                                                                                                  |
| [WORKFORCE_FAMILY_CAPABILITY_AUDIT_2026_03_08.md](./WORKFORCE_FAMILY_CAPABILITY_AUDIT_2026_03_08.md)                               | Live capability audit: tool-side workforce creation vs operator-side board lifecycle gaps                                                                                                                                              |
| [WORKFORCE_PHASE4_DELETION_MAP.md](./WORKFORCE_PHASE4_DELETION_MAP.md)                                                             | File-by-file removal map for decommissioning SQLite workforce path after PG acceptance gates                                                                                                                                           |
| [CHAT_INTAKE_WORKFORCE_PHASED_IMPLEMENTATION_PLAN_2026-03-09.md](./CHAT_INTAKE_WORKFORCE_PHASED_IMPLEMENTATION_PLAN_2026-03-09.md) | Phased implementation plan for chat-intake classification, capability-gap honesty, and intent-coupled lane enforcement                                                                                                                 |
| [CHAT_INTAKE_WORKFORCE_WORKSTREAM_LEDGER.md](./CHAT_INTAKE_WORKFORCE_WORKSTREAM_LEDGER.md)                                         | Living parallel-work ledger for branch ownership, file claims, and master-thread handoff                                                                                                                                               |
| [MIGRATION.md](./MIGRATION.md)                                                                                                     | ArgentOS migration guide — "Bring Your Agent"                                                                                                                                                                                          |
| [VIRTUAL_EMPLOYEE_RUNBOOK.md](./VIRTUAL_EMPLOYEE_RUNBOOK.md)                                                                       | End-to-end operator setup for virtual employees (role, intent, jobs, simulation)                                                                                                                                                       |

## Integrated Systems

| System               | Repository                                                      | Description                          |
| -------------------- | --------------------------------------------------------------- | ------------------------------------ |
| **Memo** (Memory)    | [ArgentAIOS/memo](https://github.com/ArgentAIOS/memo)           | Persistent memory with SQLite + FTS5 |
| **Phoenix** (Backup) | [ArgentAIOS/phoenix](https://github.com/ArgentAIOS/phoenix)     | Automated backup and recovery        |
| **Dashboard**        | [ArgentAIOS/dashboard](https://github.com/ArgentAIOS/dashboard) | Web UI with Live2D avatar            |

## Operations

| Document                                                                                                     | Description                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| [NEW_MAC_USB_INSTALLER.md](./NEW_MAC_USB_INSTALLER.md)                                                       | Build a USB-transferable installer kit for fresh macOS installs/testing                                                     |
| [TTS_SUMMARY_STABILITY_FIX_2026-02-23.md](./TTS_SUMMARY_STABILITY_FIX_2026-02-23.md)                         | Incident write-up: streaming freeze, no-audio, one-line summary fixes                                                       |
| [PAUSE_HANDOFF_2026-02-28_MANAGER_MEETING_CAPTURE.md](./PAUSE_HANDOFF_2026-02-28_MANAGER_MEETING_CAPTURE.md) | Pause checkpoint for manager start failures + meeting capture resume plan                                                   |
| [BUILD_CYCLE_2026-03-03_ISSUE_55335.md](./BUILD_CYCLE_2026-03-03_ISSUE_55335.md)                             | Build-cycle sprint record (Issue #55335): delivered items, open priorities, pending regressions                             |
| [DEVELOPMENT_WORKFLOW.md](./DEVELOPMENT_WORKFLOW.md)                                                         | Day-to-day branch/worktree operating model (dev vs clean main, recovery, smoke standards)                                   |
| [LOCAL_RUNTIME_AND_INSTALL_WORKFLOW_2026-03-21.md](./LOCAL_RUNTIME_AND_INSTALL_WORKFLOW_2026-03-21.md)       | Current local separation model for dev workspace, clean validation tree, app replacement, and experimental monitor boundary |
| [KERNEL_MEMORY_PAUSE_HANDOFF_2026-03-21.md](./KERNEL_MEMORY_PAUSE_HANDOFF_2026-03-21.md)                     | Explicit handoff for the paused consciousness-kernel workspace and the rule that current runtime is non-kernel until ported |
| [public-core.manifest.example.json](./public-core.manifest.example.json)                                     | Repo-local example manifest for dry-run and staging export of the public Core surface                                       |
| [AGENT_COLLABORATION_WORKFLOW.md](./AGENT_COLLABORATION_WORKFLOW.md)                                         | Parallel-agent branch/worktree strategy, file claims, conflict handling                                                     |
| [AGENT_FILE_CLAIMS_TEMPLATE.md](./AGENT_FILE_CLAIMS_TEMPLATE.md)                                             | Template for per-file ownership claims during parallel agent edits                                                          |

## Co-Pilot Specs

| Document                                                                         | Description                                                                   |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [COPILOT_SYSTEM_SERIES.md](./COPILOT_SYSTEM_SERIES.md)                           | Program-level Co-Pilot pattern, governance baseline, tiered roadmap           |
| [COPILOT_RUNTIME_TOOLS.md](./COPILOT_RUNTIME_TOOLS.md)                           | Live runtime tool surface for Co-Pilot domains and governance access modes    |
| [COPILOT_INTENT_SPEC.md](./COPILOT_INTENT_SPEC.md)                               | Intent Co-Pilot: inspect/explain/interview/draft/diff/validate/apply/rollback |
| [COPILOT_WORKFORCE_OPERATIONS_SPEC.md](./COPILOT_WORKFORCE_OPERATIONS_SPEC.md)   | Workforce lifecycle Co-Pilot for worker/template/assignment/run operations    |
| [COPILOT_RUN_STORY_AUDIT_SPEC.md](./COPILOT_RUN_STORY_AUDIT_SPEC.md)             | Single-run deep trace and audit-story Co-Pilot                                |
| [COPILOT_TOOL_POLICY_SPEC.md](./COPILOT_TOOL_POLICY_SPEC.md)                     | Least-privilege tool policy governance Co-Pilot                               |
| [COPILOT_COMPANY_ONBOARDING_SPEC.md](./COPILOT_COMPANY_ONBOARDING_SPEC.md)       | Guided company onboarding and initial constitution drafting                   |
| [COPILOT_OBSERVABILITY_HEALTH_SPEC.md](./COPILOT_OBSERVABILITY_HEALTH_SPEC.md)   | Health interpretation and remediation Co-Pilot                                |
| [COPILOT_NUDGE_OFFTIME_SPEC.md](./COPILOT_NUDGE_OFFTIME_SPEC.md)                 | Nudge/cooldown/conflict tuning Co-Pilot                                       |
| [COPILOT_MEMORY_GOVERNANCE_SPEC.md](./COPILOT_MEMORY_GOVERNANCE_SPEC.md)         | Memory retention/recall governance Co-Pilot                                   |
| [COPILOT_VOICE_PRESENCE_SPEC.md](./COPILOT_VOICE_PRESENCE_SPEC.md)               | Voice route and identity consistency Co-Pilot                                 |
| [COPILOT_DEPARTMENT_ORG_DESIGN_SPEC.md](./COPILOT_DEPARTMENT_ORG_DESIGN_SPEC.md) | Department ownership and org-design Co-Pilot                                  |
| [COPILOT_DEPLOYMENT_ROLLOUT_SPEC.md](./COPILOT_DEPLOYMENT_ROLLOUT_SPEC.md)       | Staged production rollout and rollback readiness Co-Pilot                     |

## Implementation Status

> **Updated 2026-02-15 based on code audit.** See [CLAUDE.md](../../CLAUDE.md) for full details.

| System               | Status         | Description                                          |
| -------------------- | -------------- | ---------------------------------------------------- |
| Fork & Restructure   | ✅ Complete    | The Awakening — full OpenClaw independence           |
| Memory (Memo+MemU)   | ✅ Complete    | 12.5K LOC — `src/memory/`, auto-capture, embeddings  |
| Backup (Phoenix)     | ✅ Complete    | `src/backup/` — local/S3/R2, compression, restore    |
| Dashboard            | ✅ Complete    | 36K LOC — React, Live2D, chat, tasks, config, canvas |
| Task System          | ✅ Complete    | `src/data/tasks.ts` — CRUD, priorities, dependencies |
| Channels             | ✅ Complete    | 9.3K LOC — Telegram, Discord, Slack, WhatsApp        |
| Heartbeat            | ✅ Complete    | 3.3K LOC — `src/infra/heartbeat-*.ts`                |
| Contemplation (Loop) | ✅ Complete    | 795 LOC — `src/infra/contemplation-runner.ts`        |
| AEVP                 | 🔨 Mostly Done | Phase 1 complete, Phase 2 in progress                |
| SIS                  | 🔨 Partial     | Extraction works; **active lesson injection needed** |
| Model Router         | 🔨 Partial     | Discovery works; **complexity scoring needed**       |
| PG+Redis Migration   | 🔨 In Progress | StorageAdapter stack built; install + testing next   |

## Key Concepts

### Always-On Loop

```
EVENT SOURCES          EVENT QUEUE              AGENT RUNTIME
  Channels   ─┐
  Heartbeat  ─┼──►  Priority Queue  ──►  State Machine  ──►  Model Router
  Tasks      ─┤     (urgent→low)        (idle→processing)   (local→opus)
  Calendar   ─┤                                │
  Webhooks   ─┘                                ▼
                                         Context Assembly
                                               │
                                               ▼
                                         OUTPUT HANDLERS
                                         Reply │ Task │ Memory │ Dashboard
```

### Model Routing

```
Complexity Score → Model Tier
─────────────────────────────
   < 0.3        → Local (Llama via Ollama)     FREE
   0.3 - 0.5    → Fast (Claude Haiku)          $
   0.5 - 0.8    → Balanced (Claude Sonnet)     $$
   > 0.8        → Powerful (Claude Opus)       $$$
```

### Task Lifecycle

```
CREATED → PENDING → IN_PROGRESS → COMPLETED
                         │
                         ├──→ BLOCKED (waiting on dependency)
                         └──→ FAILED (error after max attempts)
```

## Configuration

Main config: `config/argent.json`

```json
{
  "agent": { "id": "argent-main" },
  "gateway": { "port": 18789 },
  "models": { "default": "balanced", "routing": { "enabled": true } },
  "heartbeat": { "enabled": true, "interval": "30s" },
  "memory": { "enabled": true, "workerPort": 37778 },
  "backup": { "enabled": true, "schedule": "0 */6 * * *" },
  "dashboard": { "port": 8080 }
}
```

## Commands (Target)

```bash
argent start              # Start all services
argent gateway start      # Start gateway only
argent dashboard start    # Start dashboard only
argent tasks list         # List pending tasks
argent backup now         # Run backup
argent status             # Show system status
```

---

_Last updated: 2026-02-16_

- `VOICE_MVP_STATUS_2026-03-07.md` - Voice MVP checkpoint, current state, and next fixes
- `TOOL_GOVERNANCE_OPERATOR_GUIDE.md` - How tool access resolves across global, department, agent, and approval-backed runtime layers
