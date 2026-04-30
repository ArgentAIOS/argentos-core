---
summary: "SpecForge guides development-project intake from kickoff through PRD approval before implementation."
read_when:
  - Building or changing project-intake behavior
  - Debugging why a development-project request did or did not enter SpecForge
  - Documenting the SpecForge tool or project-build skill trigger
title: "SpecForge"
---

# SpecForge

SpecForge is the Core development-project intake workflow. It turns broad build
requests into a staged specification session before implementation starts.

Use SpecForge when the user asks to build, plan, spec, architect, or scope a
software project, app, API, agent, platform, tool, SaaS product, or major
development feature.

## Tool

Tool name: `specforge`

Actions:

- `handle` — process the latest user message and advance the staged workflow.
- `status` — inspect the active SpecForge stage without mutation.
- `exit` — clear the active SpecForge state for the current session.

The tool requires an agent session key. Chat-triggered use supplies this context
automatically.

## Trigger Path

When chat receives a development-project kickoff phrase, the gateway appends a
directive telling the agent to call:

```json
{ "action": "handle", "message": "<exact user message>" }
```

The bundled `specforge-project` skill gives the model the same rule from the
skill-loading path: project-build requests must go through SpecForge before
implementation.

## Stages

SpecForge enforces this order:

1. `project_type_gate` — classify GREENFIELD vs BROWNFIELD.
2. `intake_interview` — collect problem, users, success criteria, constraints,
   scope, non-scope, and technical context.
3. `draft_review` — draft or revise the PRD/spec.
4. `awaiting_approval` — wait for explicit approval or requested changes.
5. `approved_execution` — implementation handoff is unlocked.

Implementation, scaffolding, task assignment, and orchestration should not start
before `approved_execution`.

## Execution Handoff

After approval, SpecForge should route code/project execution to the coding
family team by default:

- Use `family.dispatch_contracted` for auditable development work with explicit
  `toolsAllow`, timeout, and heartbeat settings.
- Use `family.dispatch` for lighter development work. Technical/code tasks
  auto-prefer the `dev-team` family specialists.
- Use `family.spawn` with `mode="family"` only when a specific named coding
  family member is required.
- Use `team_spawn` when the approved plan needs multiple coordinated agents with
  shared dependencies.
- Use `sessions_spawn` only for a single isolated background task when
  family/team routing does not fit.

Each handoff task should stay contracted with files to edit, acceptance checks,
tests, non-scope, and docs impact.

Recommended coding-family skills:

- Planner/architect: `argentos-implementation-planning`.
- Implementer/debugger: `argentos-test-driven-development` and
  `argentos-systematic-debugging`.
- Reviewer/integrator: `argentos-code-verification`.
- Multi-agent execution: `argentos-family-team-development`.
- Browser/UI proof: Browser Use with Chrome-backed inspection instead of
  standalone Playwright.

The main agent remains the orchestrator after handoff. It should keep checking
`family.contract_history` for active contracts and heartbeat/timeouts,
`team_status` for member/task/dependency state when `team_spawn` is used, and
completion announcements mirrored back into the requester transcript. Use
Redis-backed `family.message`/`family.inbox` for live agent-to-agent
coordination, then mirror durable decisions, blockers, merge requests, and
containment proof to the Threadmaster bus. The main agent should update the
operator when work starts, blocks, completes, fails, or changes scope, and
escalate blocked or expired contracts instead of silently waiting.

## Core Boundary

Core owns the strict guide-mode intake and approval flow. Business-only
autoscaffold, workforce/job orchestration, commercial execution flows, and
licensing logic stay outside this Core tool unless a later boundary decision
explicitly moves them.
