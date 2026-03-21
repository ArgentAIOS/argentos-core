# Run Story + Audit Co-Pilot Spec

## Problem

Operators still need log archaeology to understand why a run behaved a certain way.

## Goal

Provide a single narrative audit for each run with drilldown evidence.

## Scope

- run context, tools used, decisions, outputs, blockers, policy effects

## Co-Pilot Capabilities

- generate a "run story" summary
- explain stop/block/fail reasons
- map decision points to intent/policy/rule sources
- suggest next operator action: retry, hold, rollback, promote

## Required UI

- run deep-trace panel
- timeline with event ordering
- policy influence section (company/department/agent source)
- evidence/artifacts links

## Acceptance Criteria

1. Operator can open any run and get a coherent story in one panel.
2. Run story cites the concrete evidence used for claims.
3. Operator can jump from story to retry/review/promotion controls.

## Test Plan

- integration: run event ingestion -> story assembly
- e2e: blocked run analysis and operator recovery actions
