# Nudge + Off-Time Behavior Co-Pilot Spec

## Problem

Nudge behavior is powerful but currently hard to tune and evaluate.

## Goal

Make nudge policy tunable with measurable impact over time.

## Scope

- nudge authoring, weighting, cooldowns, overlap/conflict detection

## Co-Pilot Capabilities

- propose nudge text and cadence
- explain weight/cooldown interactions
- detect conflicting nudges
- report nudge effectiveness trends

## Required UI

- nudge editor with validation
- overlap/conflict warnings
- effectiveness dashboard

## Acceptance Criteria

1. Operator can author nudges with immediate safety/quality feedback.
2. Operator can see which nudges influence behavior over time.
3. Conflicting nudges are flagged before activation.

## Test Plan

- unit: conflict detection rules
- integration: nudge analytics aggregation
