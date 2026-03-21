# Economic Worker Layer Brief

> Status: Design brief
>
> Scope: Add economic transparency, valuation, and operator-facing cost insight to ArgentOS jobs and execution worker without weakening existing safety and intent controls.

## Summary

ArgentOS already has the stronger production execution stack: jobs, assignments, execution worker, execution modes, intent enforcement, evidence checks, and dashboard controls.

What it does not yet expose cleanly is the economic shape of that work:

- What did this run cost?
- What was the estimated value of the task?
- Was the run margin-positive?
- Which agents, models, and job templates create surplus versus hidden burn?
- When should the operator tighten scope, lower model tier, or pause a workflow?

This brief proposes an **Economic Worker Layer** for ArgentOS: a telemetry and decision layer that sits on top of the existing jobs and worker runtime and turns autonomous work into an inspectable operating ledger.

The goal is not to turn Argent into a benchmark game. The goal is to give operators the missing financial and operational visibility needed to manage autonomous workers as real systems.

## Problem Statement

Today the operator can inspect:

- task state
- run state
- blocked versus completed outcomes
- assignment cadence and execution mode
- worker pause/resume and basic metrics

But several critical questions remain partially hidden:

- token spend is not surfaced as first-class run economics
- tool and API costs are not tied to job outcome quality
- model routing cost is not visible in downstream job profitability
- the system cannot rank agents, assignments, or departments by efficiency
- SIS has no economic feedback signal
- the operator cannot easily see where automation is producing negative margin

This creates an operational blind spot: the system may look productive while quietly burning budget on low-value work.

## Goals

- Make worker cost visible at the run, task, assignment, agent, department, and fleet levels.
- Attach estimated value and realized value to job execution.
- Compute margin and efficiency from real runtime behavior.
- Preserve existing safety architecture: intent, execution modes, evidence requirements, and tool policy boundaries stay authoritative.
- Give operators a dashboard surface for economic triage and decision-making.
- Create feedback signals for model routing, assignment tuning, and SIS.

## Non-Goals

- Replacing the execution worker.
- Replacing SpecForge or the jobs system.
- Building a GDPVal-style benchmark as a core runtime primitive.
- Using synthetic wage classification as the sole source of truth for task value.
- Optimizing purely for revenue at the expense of intent, safety, or relationship quality.

## Design Principles

1. **Economics are observability first**
   The first phase is measurement, not automation policy.

2. **Real runtime beats synthetic scoring**
   Prefer actual model, token, tool, and API usage over rough estimates whenever possible.

3. **Value is operator-defined and overrideable**
   The system should support heuristics and defaults, but operators must be able to define value models by job template, department, or workflow.

4. **Safety outranks margin**
   An unsafe but profitable run is still a failed run.

5. **Economic signals must feed decisions**
   Metrics are not enough. The layer should eventually influence routing, assignments, and SIS.

## Existing ArgentOS Surfaces To Build On

### Execution Worker

The current worker already provides the right execution envelope:

- queue draining
- agent-busy gating
- session tool policy overrides
- explicit execution prompting
- simulation and limited-live boundaries
- evidence requirements
- no-progress detection and auto-blocking
- per-agent runtime status and controls

Primary implementation anchor:

- `src/infra/execution-worker-runner.ts`

### Jobs System

The jobs system already provides the right planning and accountability substrate:

- templates
- assignments
- cadence
- execution modes
- runs
- per-assignment context
- role prompts, SOPs, success definitions, and relationship contracts

Primary runtime and UI anchors:

- `src/gateway/server-methods/execution-worker.ts`
- `dashboard/src/components/ConfigPanel.tsx`

### Model Router

The router is the natural place to consume cost and margin feedback:

- model tier selection
- fallback chains
- provider/model overrides
- complexity versus cost tradeoffs

Primary anchor:

- `src/models/router.ts`

### SIS

SIS should eventually learn not only from outcomes, but from **economic outcomes**:

- what behaviors improved margin
- what behaviors wasted tokens
- what workflows benefit from preparation or cheaper models

Primary anchors:

- `src/infra/sis-runner.ts`
- `src/infra/sis-active-lessons.ts`

## Proposed System

### Core Concept

Each execution attempt produces an **Economic Run Record**.

That record joins:

- cost
- estimated value
- realized value
- quality
- evidence
- execution mode
- safety verdict
- routing choices
- final outcome

This record becomes the source of truth for economic dashboards, leaderboards, and optimization loops.

### Economic Entities

#### 1. Economic Run Record

One record per worker-executed attempt.

Fields:

- `runId`
- `taskId`
- `assignmentId`
- `agentId`
- `departmentId`
- `jobTemplateId`
- `executionMode`
- `deploymentStage`
- `status`
- `startedAt`
- `finishedAt`
- `durationMs`
- `modelProvider`
- `modelName`
- `inputTokens`
- `outputTokens`
- `modelCostUsd`
- `toolCostUsd`
- `externalApiCostUsd`
- `totalCostUsd`
- `estimatedValueUsd`
- `realizedValueUsd`
- `qualityScore`
- `evidenceScore`
- `intentVerdict`
- `relationshipScore`
- `marginUsd`
- `roi`

#### 2. Value Policy

A configurable rule set for assigning estimated and realized value.

Scopes:

- global default
- department
- job template
- assignment override

Possible modes:

- fixed value per completion
- priority-weighted value
- SLA risk avoided
- estimated time saved
- operator-entered value
- external revenue-linked value

#### 3. Economic Snapshot

Aggregated view over time for:

- agent
- department
- assignment
- template
- model
- entire fleet

#### 4. Economic Alert

Operator-facing signal generated from thresholds such as:

- sustained negative margin
- expensive runs with low evidence
- low-value tasks using premium models
- high block rate on high-cost assignments
- rising cost without quality improvement

## Value Model

### Estimated Value

Estimated value is required even before the system can calculate realized value well.

Recommended initial sources:

- assignment-level operator-entered `estimatedValueUsd`
- template-level default value
- optional heuristic fallback derived from:
  - priority
  - urgency
  - expected effort
  - department policy

This should be explicit and editable in the dashboard.

### Realized Value

Realized value should be narrower and more conservative than estimated value.

Phase 1 rules:

- if run fails safety or intent gates: `realizedValueUsd = 0`
- if run completes with evidence but no evaluator: use capped percentage of estimated value
- if run has artifact/outcome evaluation: realized value = `estimatedValueUsd × qualityScore`

Phase 2 rules:

- allow operator sign-off to finalize realized value
- allow workflow-specific validators to set realized value from domain outcomes
- allow negative realized value for incidents, reversions, or customer-visible failures

## Cost Model

### Cost Components

Costs should be captured separately, then rolled up:

- `modelCostUsd`
- `toolCostUsd`
- `searchCostUsd`
- `ocrCostUsd`
- `browserCostUsd`
- `sandboxCostUsd`
- `messageDeliveryCostUsd`
- `otherExternalApiCostUsd`

### Cost Capture Strategy

Phase 1:

- model cost from provider/model usage metadata where available
- fallback to catalog pricing in `models-db`
- explicit cost hooks for tools that call priced external services

Phase 2:

- attach cost emitters to all paid tools
- support flat-rate and token-rate external billing models
- support blended infrastructure cost estimates for self-hosted models

## Quality Model

Economic reporting without quality invites bad optimization. The layer needs a quality side.

### Initial Quality Signals

- worker evidence presence
- task state transition validity
- blocked/completed outcome
- intent verdict
- relationship execution score
- optional artifact evaluator score

### Future Quality Signals

- operator approval
- customer reply sentiment or acceptance
- downstream task reopen rate
- regression or incident creation rate
- domain validators

## Key Metrics

### Run Level

- total cost
- estimated value
- realized value
- margin
- ROI
- cost per evidence-backed completion
- cost per blocked attempt

### Agent Level

- total spend
- total realized value
- gross margin
- median cost per run
- completion rate
- evidence-backed completion rate
- block rate
- model mix

### Assignment Level

- cost by cadence window
- value realized per run
- margin trend
- block trend
- premium-model overuse

### Fleet Level

- top positive-margin agents
- top negative-margin assignments
- most expensive templates
- best model efficiency by task class
- avoidable spend opportunities

## Dashboard Requirements

Add an **Economic Ops** surface to the dashboard.

### Views

#### 1. Fleet Overview

- total spend
- total estimated value
- total realized value
- margin trend
- top agents by realized margin
- top loss centers

#### 2. Agent Leaderboard

Rank agents by:

- realized margin
- value per dollar spent
- completion quality
- evidence-backed throughput

The leaderboard should support toggles so operators can avoid rewarding reckless behavior:

- margin
- safety-adjusted margin
- quality-adjusted margin
- value per premium-model dollar

#### 3. Assignment Profitability

- each assignment with cadence, cost, value, margin, block rate
- show assignments that should be paused, rerouted, or rewritten

#### 4. Run Explorer

- per-run ledger
- full cost breakdown
- model/tool usage
- evidence summary
- quality signals
- route taken
- final verdict

#### 5. Value Policy Editor

- set estimated value defaults by template or assignment
- choose realized value rules
- define alert thresholds

## API and Data Model Changes

### New Storage Objects

Add storage support for:

- `economic_run_records`
- `economic_snapshots`
- `economic_alerts`
- `value_policies`

### New Gateway Methods

Candidate methods:

- `economic.overview`
- `economic.agents.list`
- `economic.agent.detail`
- `economic.assignments.list`
- `economic.runs.list`
- `economic.valuePolicies.list`
- `economic.valuePolicies.upsert`
- `economic.alerts.list`

### Dashboard Polling / Streaming

Reuse the existing gateway/dashboard pattern:

- periodic refresh first
- live events later

Candidate events:

- `economic_run_recorded`
- `economic_alert_created`
- `economic_snapshot_updated`

## Runtime Integration Plan

### Phase 1: Telemetry Only

Add economic fields to worker run completion without changing behavior.

Deliverables:

- capture token/model cost for worker runs
- record execution duration and model choice
- compute estimated value from assignment/template settings
- compute simple margin
- expose read-only dashboard views

Success criteria:

- operator can identify expensive workflows and model misuse
- no behavior regressions in execution worker

### Phase 2: Outcome Scoring

Add realized value and quality-adjusted margin.

Deliverables:

- artifact evaluator hook for eligible jobs
- realized value formula
- run explorer with quality signals
- assignment profitability table

Success criteria:

- operator can distinguish expensive-good from expensive-bad automation

### Phase 3: Alerts and Policy

Make economic signals actionable.

Deliverables:

- negative-margin alerts
- premium-model misuse alerts
- low-evidence high-cost alerts
- dashboard policy editor

Success criteria:

- operator can change value policies and immediately improve system efficiency

### Phase 4: Adaptive Optimization

Feed economics into the runtime.

Deliverables:

- router hints from historical margin by task class
- assignment recommendations
- SIS lesson extraction on economic wins and losses

Success criteria:

- system reduces avoidable spend without reducing quality or safety

## Integration With Existing Safety Controls

This layer must remain subordinate to existing safety systems.

Rules:

- simulation violations always zero out realized value
- intent violations always count as failed economics regardless of raw output
- relationship failures reduce or zero realized value for human-facing roles
- limited-live boundary breaches are treated as economic failures, not profitable runs

This keeps the system from rewarding unsafe shortcuts.

## Open Questions

1. Where should default value policy live: config, database, or both?
2. Should realized value require operator confirmation for certain job classes?
3. Which external tools need first-class cost instrumentation first?
4. Should self-hosted model inference cost be estimated from hardware/runtime usage or left configurable?
5. How should multi-agent jobs attribute value across cooperating workers?
6. Should negative realized value be introduced in Phase 2 or Phase 3?

## Recommended Initial Implementation Slice

The first slice should be intentionally narrow:

- instrument execution worker runs with model cost and duration
- add `estimatedValueUsd` to job templates and assignment overrides
- compute `marginUsd = estimatedValueUsd - totalCostUsd`
- expose read-only economic overview and per-assignment profitability
- add a simple leaderboard by safety-adjusted margin

This gets the operator the key benefit quickly:

visibility into where Argent is creating value versus silently burning budget.

## Expected Operator Value

If implemented correctly, the Economic Worker Layer gives operators:

- transparency into hidden runtime costs
- confidence in which workers and assignments are economically healthy
- a direct way to tune job policy, model choice, and cadence
- a way to pause negative-margin automation before it compounds
- a path to make SIS and routing optimize for useful business outcomes rather than abstract completion counts

In short, this turns ArgentOS from a system that can execute work into a system that can explain whether its autonomous work is operationally worth it.
