# Workforce + Intent Quick Start

Date: 2026-03-08  
Audience: Operator

## Use This First

If you only need the short version:

1. `Intent` defines behavior.
2. `Workforce` defines the role and execution path.
3. `Relationship contract` defines how the role should preserve trust.
4. `Simulation` is the safety gate before live use.

## The Mental Model

### Intent

Use Intent to decide:

1. what must never happen
2. what needs human approval
3. when the agent must escalate
4. what the agent should optimize for in tradeoffs

Think of Intent as the behavioral constitution.

### Workforce

Use Workforce to decide:

1. what role exists
2. which agent runs it
3. how often it runs
4. what stage it is in
5. how it is reviewed and promoted

Think of Workforce as the role synthesis and deployment system.

### Relationship Contract

Use the relationship contract to decide:

1. how this role should make people feel
2. what trust-preserving behavior looks like
3. how uncertainty must be communicated
4. how escalation should preserve confidence
5. what relational failure looks like

This is the part that stops the role from becoming a fast but harmful automation.

## The Three Intent Layers

1. `Global`
   - company-wide rules
2. `Department`
   - lane-specific behavior, like Support or Engineering
3. `Agent`
   - the final narrowing for one specific worker

Rule:

- child policy can tighten
- child policy cannot loosen

## The Three Workforce Objects

1. `Job Template`
   - reusable role definition
2. `Assignment`
   - which agent runs it, how often, and in what stage
3. `Run History`
   - what actually happened, how it was scored, and what the operator decided

## The Four Deployment Stages

1. `simulate`
   - draft-only, no live side effects
2. `shadow`
   - observe or draft behavior under review
3. `limited-live`
   - live behavior inside explicit scope limits only
4. `live`
   - full allowed production behavior

Do not skip the ladder for customer-facing roles.

## The Safe Workflow

1. define the role
2. define intent guardrails
3. define the relationship contract
4. add simulation scenarios
5. assign it in `simulate`
6. inspect run results and relationship reasons
7. promote, hold, or roll back
8. only reach `live` when staged evidence supports it

## What To Fill In On The Workforce Board

### Job Template

Fill in:

1. `Job Template Name`
   - short role name
   - example: `Tier 1 Morning Triage`
2. `Department ID`
   - which lane this role belongs to
3. `Role / Job Contract`
   - responsibility, boundaries, escalation behavior
4. `Relationship Objective`
   - what kind of relationship this role must preserve
5. `Tone Profile`
   - calm, direct, reassuring, formal, etc.
6. `Trust Priorities`
   - ordered list of what matters most
7. `Continuity Requirements`
   - context that must be carried forward
8. `Honesty Rules`
   - how uncertainty or incomplete knowledge must be disclosed
9. `Handoff Style`
   - how escalation should sound and feel
10. `Relational Failure Modes`

- what behavior is unacceptable even if technically correct

11. `Simulation Scenarios`

- one scenario per line

Good role contract example:

`Triage overnight support items, reduce customer anxiety, never bluff certainty, escalate policy or billing issues immediately.`

Good relationship objective example:

`Preserve trust by sounding calm, honest, and competent even when the issue is not resolved in one turn.`

### Assignment

Fill in:

1. template
2. agent
3. optional assignment title
4. cadence in minutes
5. optional event triggers
6. deployment stage
7. scope limit

Start with:

- `simulate` for new or risky roles
- `shadow` only after stable simulation evidence

## Recommended Priority Order For Support Roles

1. protect trust
2. reduce anxiety
3. resolve accurately
4. resolve quickly

If the system optimizes only for speed, it will damage the relationship.

## Promotion Gate

Before moving forward a stage, confirm:

1. the role contract is clear
2. the relationship contract is clear
3. the intent policy is in place
4. realistic scenarios exist
5. blocked runs are understood
6. relationship reasons look acceptable
7. the scope limit fits the current stage
8. the operator explicitly approves the change

## If You Only Remember Two Things

1. Intent tells the worker how to behave.
2. Workforce tells the worker what role to perform, at what stage, and under what review.

## Related Docs

1. [Virtual Employee Runbook](./VIRTUAL_EMPLOYEE_RUNBOOK.md)
2. [Intent and Support Playbook](./INTENT_AND_SUPPORT_PLAYBOOK.md)
3. [Relationship Alignment Architecture](./RELATIONSHIP_ALIGNMENT_ARCHITECTURE.md)
4. [Argent Docs Index](./INDEX.md)
