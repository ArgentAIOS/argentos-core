# Intent Co-Pilot Spec

## Problem

Intent configuration is too hard to shape safely without architecture-level understanding.

## Goal

Enable guided intent authoring while preserving strict operator control.

## Scope

- company/global intent
- department intent
- agent intent
- effective resolved intent + inheritance source tracing

## Tool Surface (MVP)

`intent_tool` actions:

- `overview`
- `company_get`
- `department_get`
- `agent_get`
- `effective_resolve`
- `draft_from_interview`
- `diff`
- `validate`
- `apply`
- `access_mode_get`
- `access_mode_set`
- `history`
- `rollback`

## UI Surfaces

- Intent Overview page (company + department + agent cards)
- Intent Builder interview flow
- Intent diff + validation panel
- Access mode toggle + status badge
- Change history + rollback controls

## Guardrails

- default access mode: `assist-draft`
- operator approval required for apply unless mode explicitly allows limited live apply
- AI-authored drafts/proposals clearly labeled

## Acceptance Criteria

1. Operator can interview and produce a valid draft intent pack.
2. Operator can view effective resolved intent for any agent with source layer attribution.
3. Operator can diff, validate, approve, apply, and rollback changes.
4. Every change is logged with actor, rationale, and before/after snapshot.

## Test Plan

- unit: action dispatch + validation
- integration: draft->diff->validate->apply->history->rollback
- e2e: operator flow from onboarding prompt to approved intent update
