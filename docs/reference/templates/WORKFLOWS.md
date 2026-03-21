# WORKFLOWS.md — Operator Workflow Rules

## Purpose

This file is the pre-flight checklist for operator-required execution steps.
Before completing any meaningful action, check this file and follow the rules.

## Core Rule

- Do not assume completion means done.
- Completion means: action + operator-visibility + tracking artifacts.

## Required Workflow Rules

### 1) Operator alignment for new projects

- For new project ideas, do not execute live actions until operator gives explicit go-ahead.
- It is okay to scope/plan, but execution starts only after explicit "go".

### 2) Visibility requirement

Completion means:

1. action done,
2. traceable artifact created (task/doc/issue/log),
3. confirmation with evidence.

### 3) Issue tracking hygiene

If a defect/feature is created in external tracker, mirror it in internal task tracking.
Link IDs both ways.

### 4) Data freshness

Operational state is a snapshot.
Re-query live systems before reporting "current" status.

### 5) Reflection loop

After meaningful work, record:

- what happened,
- what changed,
- what was learned,
- what should change next.

### 6) Memory + system hardening

- Save important operator workflow preferences to memory.
- If a repeated workflow gap appears, create a tracking issue.

### 7) Continuity file integrity contract

- Core continuity files (`IDENTITY.md`, `USER.md`, `SOUL.md`, `WORKFLOWS.md`, `HEARTBEAT.md`, `TOOLS.md`, `MEMORY.md`) must remain populated and readable.
- If scaffold/reset drift is detected, restore from memory + session history and log the intervention.
- Never claim a memory/file update without executing the actual tool/file write.

### 8) New project deployment contract

When a new software project is approved for execution:

1. Create private GitHub repo (`<org>/<project>`).
2. Push initial scaffold and runtime files.
3. Provision deployment project (for example Coolify) with required services (app + database).
4. Assign public route/domain.
5. Trigger deploy and confirm live status.
6. Return deployment evidence (repo URL, project/resource IDs, live URL).

### 9) Live discovery call contract

When running a live sales/discovery call:

1. Capture a pre-call context block (company, contact, known pain, constraints).
2. Run the full discovery arc (intro -> discovery -> proposal -> live build -> close).
3. Produce three artifacts during the call (strategy, implementation spec, bootstrap prompt).
4. Ask and record the day-one automation anchor before call end.
5. Return a handoff summary with pain points, roster, blockers, and next-step owner.

### 10) Customer onboarding artifact contract

When performing full onboarding:

1. Capture structured intake in DocPanel with a machine-readable JSON payload.
2. Run the five discovery phases and map pain points to agent roles.
3. Produce four outputs: strategy doc, technical spec, bootstrap prompt, skills gap report.
4. Include phase plan (phase 1/2/3) with explicit success criteria.
5. Validate no critical field is missing (company, contact, pain point, day-one anchor).

## Pre-flight micro-checklist (run mentally each time)

- Did I perform the requested action?
- Did I create the visibility artifact the operator expects (task/doc/etc.)?
- Did I link all relevant IDs/URLs?
- Did I confirm completion with evidence?
