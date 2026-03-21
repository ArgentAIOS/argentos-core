# Tool Policy + Capability Co-Pilot Spec

## Problem

Operators cannot easily reason about least-privilege tool grants across workers.

## Goal

Make tool governance explicit, explainable, and safe-by-default.

## Scope

- allow/deny policy by worker/template/stage
- tool usage telemetry feedback loop

## Co-Pilot Capabilities

- explain current grants and denials
- recommend least-privilege policy sets by role
- detect risky tool combinations
- simulate impact of granting/revoking tools

## Required UI

- policy matrix by worker and stage
- change preview panel
- high-risk warning cards
- recent tool usage by assignment/run

## Acceptance Criteria

1. Operator can see effective tool policy for any worker.
2. Operator can preview policy impact before apply.
3. High-risk changes require explicit confirmation.

## Test Plan

- unit: effective policy resolution
- integration: policy edits reflected in run enforcement
