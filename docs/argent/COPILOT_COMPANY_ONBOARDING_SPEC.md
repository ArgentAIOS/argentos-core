# Company Onboarding Co-Pilot Spec

## Problem

Initial setup for a new company is high-friction and easy to misconfigure.

## Goal

Provide guided discovery that outputs deployable initial intent + workforce setup.

## Scope

- company goals, risk posture, departments, approval boundaries
- starter worker roles and rollout plan

## Co-Pilot Capabilities

- interview operator with structured question sets
- draft company constitution and department defaults
- flag contradictions/unknowns
- generate rollout phases

## Required UI

- onboarding wizard
- progress tracker + unresolved items list
- final review package with apply controls

## Acceptance Criteria

1. Operator can complete onboarding without editing raw config.
2. System produces reviewable drafts for intent + starter workforce.
3. Operator can accept partial outputs and resume later.

## Test Plan

- e2e onboarding from blank state to approved starter deployment
