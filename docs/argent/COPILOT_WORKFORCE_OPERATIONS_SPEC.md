# Workforce Operations Co-Pilot Spec

## Problem

Workforce is operator-visible but still operator-incomplete for lifecycle management.

## Goal

Make workforce setup and operation explainable, editable, and governable from one operator loop.

## Scope

- workers, templates, assignments, stages, runs, review
- existing family worker discovery
- create vs edit vs bind clarity

## Co-Pilot Capabilities

- explain workforce object model
- interview to draft worker role contracts
- propose template/assignment changes
- identify blocked/due-now/failing workload
- recommend cadence/stage/scope adjustments

## Required UI

- control-tower overview
- clear mode labels: create/edit/clone/rebind
- worker detail edit surface
- assignment semantics helper text
- run-now/retry/review actions in-context

## Guardrails

- all stage promotions require explicit operator action (unless separately authorized)
- destructive actions require confirmation + preview of impact

## Acceptance Criteria

1. Operator can create/edit/bind worker roles without ambiguity.
2. Existing family workers are discoverable and selectable.
3. Run intervention actions are available from same board context.
4. Tool policy and scope limits are visible before save.

## Test Plan

- e2e: worker create -> template create -> assignment bind -> simulate run -> review
- e2e: edit existing artifacts and verify persistence on refresh
