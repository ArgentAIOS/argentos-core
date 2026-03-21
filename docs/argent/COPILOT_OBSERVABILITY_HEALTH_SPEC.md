# Observability + Health Co-Pilot Spec

## Problem

Operators lack a unified, actionable interpretation of platform health.

## Goal

Summarize health and prioritize highest-impact fixes automatically.

## Scope

- workforce run health
- queue/task health
- model/provider stability
- memory and policy drift signals

## Co-Pilot Capabilities

- daily/real-time health brief
- recurring failure cluster detection
- stale worker and zombie run detection
- recommended remediation list

## Required UI

- health summary board
- anomaly feed
- remediation queue with one-click drilldowns

## Acceptance Criteria

1. Operator can identify top 1-3 issues within one screen.
2. Every recommendation links to concrete evidence.
3. Health state is explainable, not opaque scoring.

## Test Plan

- integration: anomaly detection + recommendation rendering
