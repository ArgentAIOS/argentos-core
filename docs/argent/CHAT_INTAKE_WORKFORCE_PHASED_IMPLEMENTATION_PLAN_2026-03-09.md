# Chat Intake, Workforce, and Capability-Gap Plan (Phased)

Date: 2026-03-09
Status: Planning approved, implementation not started
Owner: Platform Architecture
Thread Type: Master orchestration input

## Objective

Build a first-class operator intelligence layer so ArgentOS can:

1. Classify inbound asks before execution.
2. Select the right execution lane (assistant, cron, workforce, guided workflow).
3. Enforce policy through Intent and approval controls.
4. Detect missing capabilities honestly (no fake data).
5. Offer actionable next options when blocked.

## Existing Runtime Surfaces (Current Truth)

1. Chat ingress and directive injection: `src/gateway/server-methods/chat.ts`
2. Intent hierarchy and runtime hinting: `src/agents/intent.ts`
3. Workforce APIs and lifecycle: `src/gateway/server-methods/jobs.ts`
4. Workforce setup co-pilot behavior: `src/agents/tools/workforce-setup-tool.ts`
5. Job orchestration (due/event task materialization): `src/infra/job-orchestrator-runner.ts`
6. Execution runtime for tasks/jobs: `src/infra/execution-worker-runner.ts`
7. Cron runtime and tooling: `src/cron/*`, `src/agents/tools/cron-tool.ts`
8. Approval controls: `src/infra/exec-approvals.ts`, `src/infra/outbound/outbound-policy.ts`

## Core Principle

Classifier decides what kind of work it is.
Capability registry decides if it is feasible now.
Intent decides if it is permitted now.
Runtime executes only after all three pass.

## Lane Model (Authoritative)

1. `assistant`

- One-off, low-risk, operator-directed work.

2. `cron`

- Deterministic recurring work with predictable inputs/outputs.

3. `workforce`

- Standing role continuity via templates, assignments, runs, and promotion states.

4. `guided_workflow`

- Consequential multi-step intake requiring explicit staged questioning and approvals.

## Decision Questions Required At Intake

The intake router must answer these before normal execution:

1. Is this a project?
2. Does this require programming?
3. Does this require a standing worker/agent role?
4. Can this be done now with existing capabilities?
5. Does owner or operator approval/decision apply?
6. Is this repeatable and promotable to cron/workforce/workflow?

## Intent Integration Model

Intent is the policy gate, not the classifier.

1. Classifier computes lane and risk.
2. Capability check computes readiness (`ready`, `key_missing`, `tool_missing`, `unknown`).
3. Intent evaluates autonomous allowance:

- `allowedActions`
- `requiresHumanApproval`
- escalation thresholds and policy constraints

4. If policy or capability fails, switch to blocked/clarification mode only.

## Capability-Gap Handling Contract (No Fabrication)

When a request cannot be completed natively:

1. Never synthesize fake outputs or fake data.
2. Respond with explicit sections:

- What can be done now
- What cannot be done now
- What unlocks it (service key vs tool build vs custom integration)
- Immediate options

3. Offer options:

- Partial execution with current tools
- Add credentials and continue
- Create org-specific tool request
- Create ecosystem tool request
- Open GitHub issue with structured payload

## Org-Specific vs Ecosystem Tool Rubric

Default decision rubric:

1. Build ecosystem tool when:

- Integration is broad market (for example QuickBooks, Odoo)
- Reuse is expected across customers
- Maintenance can be centralized

2. Build org tool when:

- Workflow/policy is unique to a specific operator
- Data model is custom or tenant-specific
- Compliance/process constraints are unique

3. Promotion rule:

- Org tool can be promoted to ecosystem tool after repeated reuse signals.

## Phased Implementation

## Phase 0: Contract and Schemas

Deliverables:

1. Intake decision schema (lane, risk, repeatability, owner/operator decision, missing fields).
2. Capability readiness schema (ready/key missing/tool missing/unknown).
3. Blocked-response schema (honest options, no-fabrication contract).
4. Org-vs-ecosystem decision schema.

Acceptance:

1. Schema reviewed and approved by architecture + operator owner.
2. No runtime behavior changed yet.

## Phase 1: Capability Registry and Probes

Deliverables:

1. Machine-readable capability registry (tools, integrations, auth requirements, scope).
2. Readiness probes (key exists, tool callable, permission scope, last validation timestamp).
3. Registry endpoint/tool read path for chat preflight.

Acceptance:

1. Chat can resolve required capabilities against registry.
2. Missing capability states are deterministic and auditable.

## Phase 2: Chat Intake Router (Preflight Gate)

Deliverables:

1. Preflight in `chat.ts` before normal run dispatch.
2. Required-question gate when ambiguity or missing requirements is high.
3. Lane recommendation + confidence score emitted into run metadata.

Acceptance:

1. Agent does not bypass required intake questions on consequential asks.
2. Lane selection is observable in logs/events.

## Phase 3: Intent-Coupled Enforcement

Deliverables:

1. Map lane/risk classes to intent action classes.
2. Enforce `requiresHumanApproval` and escalation rules at preflight decision boundary.
3. Block and explain policy-denied paths with alternatives.

Acceptance:

1. Policy denials are explicit, not silent.
2. Cross-lane policy behavior is consistent (assistant/cron/workforce/workflow).

## Phase 4: Capability-Gap UX and Issue Escalation

Deliverables:

1. Standard blocked-response format with options.
2. Optional “create GitHub issue” action with structured payload.
3. Capability-gap telemetry and repeated-demand tracking.

Acceptance:

1. No-fabrication behavior holds in blocked scenarios.
2. Operators receive concrete options instead of dead ends.

## Phase 5: Tool Build Pipeline (Org and Ecosystem)

Deliverables:

1. Lightweight intake for tool requests (org vs ecosystem).
2. Priority scoring (demand, risk, effort, reuse).
3. Promotion path from org tool to ecosystem tool.

Acceptance:

1. Common integrations (for example QuickBooks/Odoo) have a standardized decision path.
2. Tool backlog is visible and deduplicated.

## Phase 6: Harden and Rollout

Deliverables:

1. Feature flags per phase.
2. Simulation-first rollout for workforce and consequential lanes.
3. Regression tests for routing, policy, and blocked-response behavior.

Acceptance:

1. Safe staged rollout with rollback path.
2. No degradation in existing cron/workforce/specforge flows.

## Non-Goals (Current Plan)

1. No immediate implementation of QuickBooks/Odoo in this planning phase.
2. No migration of existing workforce model; this layers on top of current runtime.
3. No removal of existing SpecForge behavior.

## Risks

1. Over-questioning can create operator friction.
2. Under-questioning can cause unsafe execution.
3. Capability registry drift can create false availability claims.

Mitigations:

1. Minimum-question policy with confidence thresholds.
2. Probe-based capability status.
3. Policy and routing observability with audit logs.

## Implementation Notes for Parallel Threads

1. This document is planning authority for chat-intake routing work.
2. Parallel efforts (for example TTS/SIS) should not be blocked by this plan.
3. Use the coordination ledger for per-thread status and file touch claims.

## Success Metrics

1. Reduction in “wrong lane” executions.
2. Reduction in fabricated/assumed outputs in blocked-capability asks.
3. Increased conversion from ad hoc asks to reusable cron/workforce/workflow assets.
4. Mean time from blocked ask to actionable backlog item.
