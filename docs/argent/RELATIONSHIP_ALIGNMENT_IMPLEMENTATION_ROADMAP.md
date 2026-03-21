# Relationship Alignment Implementation Roadmap

Date: 2026-03-06  
Status: Canonical Build Sequence  
Owner: ArgentOS Core Team

## Purpose

This roadmap exists to prevent product drift.

ArgentOS Workforce must not degrade into a generic job scheduler with nicer labels.
The product direction is:

1. role synthesis
2. relationship preservation
3. simulation-first promotion
4. governance before autonomy
5. rollback when trust is threatened

This document defines the implementation order required to preserve that vision.

## Non-Negotiable Product Thesis

For internal technical automation, the task is the unit.

For customer-facing or human-representative roles, the relationship is the unit.

That means the Workforce system must evaluate more than:

1. completion
2. speed
3. technical correctness

It must also evaluate:

1. trust preservation
2. escalation integrity
3. continuity preservation
4. brand alignment
5. honesty under uncertainty

## What Has Already Been Implemented

The first relationship-alignment slice is now in the product:

1. `relationshipContract` primitive on job templates
2. explicit deployment stages:
   - `simulate`
   - `shadow`
   - `limited-live`
   - `live`
3. run metadata carrying relational evaluation fields
4. Workforce Board support for:
   - relationship objective
   - deployment stage
   - relationship score summary

This is a foundation only.
It is not the full vision.

## What Must Not Happen

Do not continue building generic workforce mechanics without the next role-governance layers.

Specifically, do not treat these as optional polish:

1. shadow review workflow
2. promotion gates
3. rollback workflow
4. department identity inheritance
5. deeper relational evaluation

Those are core architecture, not future nice-to-haves.

## Canonical Sequence

## Phase 1 — Foundation

Status: complete

Delivered:

1. relationship contract primitive
2. deployment stages in storage/runtime/UI
3. basic relationship scoring surfaced in runs

Representative commit:

- `78b23d34b` `feat: add workforce relationship contracts and stages`

## Phase 2 — Promotion Governance

Status: next required phase

This phase implements the operational ladder from simulation to live.

### Required outcomes

1. `shadow` becomes a first-class review mode
2. assignments gain explicit promotion state
3. promotion requires operator decision, not silent drift
4. rollback becomes explicit and operator-visible
5. run review UI supports:
   - promote
   - hold
   - rollback

### Required model additions

On assignments:

1. `promotionState`
   - `draft`
   - `in-review`
   - `approved-next-stage`
   - `held`
   - `rolled-back`
2. `rollbackState`
3. `scopeLimit`
4. `reviewRequired`

On runs:

1. `reviewStatus`
2. `reviewedBy`
3. `reviewedAt`
4. `promotionRecommendation`
5. `rollbackRecommendation`

### Required UI additions

1. Shadow review inbox/panel
2. Promote/Hold/Rollback controls
3. Stage history visibility
4. Rationale field for operator review decisions

### Why this phase is required

Without promotion governance, the system still behaves like a job runner with extra metadata.
That is below the intended product bar.

## Phase 3 — Relationship Contract Expansion

Status: required immediately after Phase 2, can overlap in implementation

The current `relationshipContract` is intentionally thin.
This phase makes it expressive enough to represent real company-facing roles.

### Required fields

1. `toneProfile`
2. `trustPriorities`
3. `continuityRequirements`
4. `honestyRules`
5. `handoffStyle`
6. `relationalFailureModes`
7. `nonGoals`

### Required UI additions

1. structured relationship contract editor
2. inline examples for support-facing roles
3. visible distinction between:
   - role contract
   - relationship contract

### Why this phase is required

A single relationship objective string is not enough to represent a brand-bearing role.

## Phase 4 — Deeper Relational Evaluation

Status: required after Phase 2/3 foundation is usable

The current scoring is heuristic and lightweight.
That is acceptable for the first slice, but not for real promotion gates.

### Required outcomes

A run should be evaluated against a structured rubric that includes:

1. trust preservation
2. brand alignment
3. continuity preservation
4. honesty under uncertainty
5. escalation correctness
6. technical correctness

### Required implementation

1. dedicated evaluator module
2. normalized rubric schema
3. scoring explanations and evidence excerpts
4. operator-facing review notes

### Required UI additions

1. score breakdown panel
2. reasons/evidence view
3. failure-mode highlighting

### Why this phase is required

Promotion and rollback become weak if the scoring layer is shallow.

## Phase 5 — Department Identity Inheritance

Status: core architecture phase, not optional

This phase ensures roles inherit the company and department posture instead of being isolated prompt artifacts.

### Required outcomes

1. roles inherit department identity
2. department identity can define:
   - tone norms
   - escalation norms
   - service style
   - tool posture
   - approval posture
3. roles can tighten department constraints, not loosen them

### Required model additions

1. `departmentId`
2. `identityProfileId`
3. department-linked policy/knowledge references

### Required systems integration

1. Workforce
2. Intent hierarchy
3. knowledge collections
4. alignment docs where appropriate

### Why this phase is required

Without department inheritance, each role remains a local configuration object rather than part of a living organizational system.

## Phase 6 — Limited-Live Guardrails

Status: follows promotion governance

`limited-live` must be a real stage, not just a label.

### Required outcomes

1. scoped live execution boundaries
2. restricted customer or task scope
3. narrower tool access than full live
4. visible blast-radius controls

### Examples

1. one customer set only
2. one department queue only
3. read-mostly plus approved outbound actions
4. escalations mandatory beyond narrow thresholds

## Phase 7 — Organizational Memory of Relationship Performance

Status: later but important

The system should learn not just from task outcomes but from relational outcomes.

### Required outcomes

1. store relationship failures as first-class lessons
2. preserve known trust-damaging patterns
3. improve role prompts/contracts from evaluation history
4. feed lessons into SIS and future simulations

## Priority Order

If work must be sequenced tightly, use this order:

1. Phase 2 — Promotion Governance
2. Phase 3 — Relationship Contract Expansion
3. Phase 4 — Deeper Relational Evaluation
4. Phase 5 — Department Identity Inheritance
5. Phase 6 — Limited-Live Guardrails
6. Phase 7 — Organizational Memory of Relationship Performance

## Delivery Rule

No future Workforce work should be described as "complete" unless it moves the system materially along this sequence.

Specifically:

- generic scheduling improvements are not enough
- cosmetic UI renames are not enough
- more runs without governance are not enough

The bar is:

1. safer simulation
2. real promotion decisions
3. real rollback ability
4. stronger relationship modeling
5. stronger organizational inheritance

## Next Required Build Slice

The next required implementation slice is:

1. shadow review workflow
2. promotion states and gates
3. rollback workflow
4. operator review UI

That is the immediate product priority.

## Final Standard

ArgentOS Workforce succeeds when an operator can:

1. define a role inside the values and posture of a real company
2. simulate it safely
3. inspect relational and technical failures
4. promote it cautiously
5. rollback it immediately if trust degrades

That is the standard.
