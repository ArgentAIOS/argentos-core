# Virtual Employee Runbook (Operator)

This runbook explains how to set up a relationship-bearing virtual employee in ArgentOS from zero to production-safe operation.

## What This System Is

A virtual employee in ArgentOS is not just a scheduled task runner. It is a role with:

1. identity and alignment docs
2. intent guardrails
3. a role contract
4. a relationship contract
5. department identity
6. staged deployment (`simulate` -> `shadow` -> `limited-live` -> `live`)
7. operator review, promotion, hold, and rollback
8. run evidence and relationship scoring

For internal technical work, the unit is usually the task.

For customer-facing or human-representative work, the unit is the relationship.

That means a role can fail even when the output is technically correct.

## System Model (How It Works)

1. Operator defines a `Job Template`.
2. Operator assigns the template to an agent with cadence and deployment stage.
3. Execution Worker materializes due assignments into tasks.
4. Worker executes with injected context:
   - role contract
   - relationship contract
   - department identity
   - SOP / definition of done
   - deployment stage
   - scope limits
   - simulation scenarios
5. Intent policy is resolved for the target agent and attached at runtime.
6. Stage-specific behavior is enforced:
   - `simulate`: draft-only, no live side effects
   - `shadow`: draft/review behavior, no live side effects
   - `limited-live`: live actions within explicit scope only
   - `live`: full allowed scope
7. Run result is recorded with:
   - task status
   - review state
   - intent verdict
   - relationship scoring
   - promotion / rollback recommendation
8. Operator reviews the run and chooses to:
   - promote
   - hold
   - roll back
   - finish current stage and queue the next one

## Preconditions

Before setting up a role, confirm:

1. Gateway is healthy and connected.
2. The target agent exists and is reachable.
3. Execution Worker is enabled if this role is meant to run automatically.
4. The agent has alignment docs saved:
   - `SOUL.md`
   - `IDENTITY.md`
   - `USER.md`
   - `TOOLS.md`
   - `HEARTBEAT.md`
   - `CONTEMPLATION.md`
5. Intent hierarchy exists and is deliberate:
   - Global
   - Department
   - Agent
6. You know whether this role is:
   - internal technical work
   - external / customer-facing work

That last distinction matters because external roles need stricter governance.

## The Four Design Layers

Every good virtual employee setup should be built in this order:

### 1. Organizational Identity

What the company values, what it refuses to do, and how it should feel to others.

### 2. Department Identity

How this lane behaves differently from other lanes.

Examples:

- Support should reassure and escalate honestly.
- Engineering should be precise and explicit about uncertainty.
- Finance should be conservative and approval-heavy.

### 3. Role Contract

What the worker is responsible for.

This includes:

- scope
- authority
- SOP
- allowed tools
- denied tools
- definition of done

### 4. Relationship Contract

How this role should preserve trust, tone, continuity, and honesty.

This includes:

- relationship objective
- tone profile
- trust priorities
- continuity requirements
- honesty rules
- handoff style
- relational failure modes

## Setup: Start to Finish

### Step 1: Define the role's identity

In `Settings -> Alignment`:

1. Select the target agent.
2. Update role-specific guidance in:
   - `IDENTITY.md`
   - `SOUL.md`
   - `TOOLS.md`
3. Make sure the docs match the actual job the role will perform.

Use specific role language such as:

- `Tier 1 MSP Triage`
- `Customer Billing Escalation Coordinator`
- `Internal Patch Verification Analyst`

### Step 2: Define intent guardrails

In `Settings -> Intent`:

1. Set global baseline rules.
2. Set department policy.
3. Set agent-specific narrowing.
4. Keep hierarchy monotonic:
   - child can tighten
   - child cannot loosen
5. Start with runtime mode `advisory` if you are validating a new setup.
6. Move to `enforce` only when the policy is stable.

Intent answers:

- what is allowed
- what is forbidden
- what requires approval
- when to escalate

### Step 3: Create the job template

In `Settings -> Agent -> Job Board`:

Create a `Job Template` with these fields filled intentionally:

1. `Job Template Name`
2. `Department ID`
3. `Role / Job Contract`
4. `Relationship Objective`
5. `Tone Profile`
6. `Trust Priorities`
7. `Continuity Requirements`
8. `Honesty Rules`
9. `Handoff Style`
10. `Relational Failure Modes`
11. `Simulation Scenarios`
12. default stage

Use the template for the reusable role definition.

Recommended contract pattern:

- responsibility
- boundaries
- escalation behavior
- non-goals

Recommended relationship pattern:

- how the other party should feel
- what trust damage looks like
- how uncertainty must be communicated

### Step 4: Add simulation scenarios

For any customer-facing or high-risk role, define scenarios in the template.

Good examples:

- angry customer
- confused customer
- incomplete internal notes
- VIP pressure
- policy question outside scope
- uncertain outage conditions
- mixed technical plus emotional context

A role is not well-specified until it can be exercised against realistic edge cases.

### Step 5: Create the assignment

Assign the template to an agent.

Set:

1. target agent
2. cadence in minutes
3. optional assignment title
4. optional event triggers
5. deployment stage
6. scope limit

Start with:

- `simulate` for most new roles
- `shadow` only when a prior simulated role has already stabilized

### Step 6: Review the first run

In the Workforce Board, inspect:

1. run status
2. workflow stage
3. side-effect mode
4. blocker text
5. relationship scores
6. relationship reasons
7. review state

A first run is useful only if you review it as evidence, not just as activity.

### Step 7: Promote carefully

Promotion should be earned, not assumed.

Use this stage ladder:

1. `simulate`
   - no live side effects
   - safe rehearsal
2. `shadow`
   - observe or draft behavior
   - operator review required
3. `limited-live`
   - live actions inside explicit scope only
4. `live`
   - full allowed production behavior

When a run finishes, review it and choose one:

- `Promote`
- `Hold`
- `Roll Back`

Then finish the stage and queue the next stage only if the evidence supports it.

## What Good Evidence Looks Like

For internal technical roles:

- correct outcome
- clean evidence
- bounded blast radius
- no unexplained failure

For customer-facing roles:

- trust preserved
- calm and accurate tone
- honest uncertainty
- clean escalation
- continuity maintained
- no relational failure mode triggered

## What Counts as Failure

Examples of relational failure:

- technically correct but cold
- fast but trust-damaging
- overconfident under uncertainty
- escalated too late
- crossed department tone boundaries
- forced the user to restate context unnecessarily

These are real failures, not cosmetic issues.

## Operator Review Checklist

Before promoting a role forward, confirm:

1. role contract is specific
2. relationship contract is specific
3. department identity is correct
4. scenarios cover realistic edge cases
5. latest run has no unexplained blocker
6. relationship reasons are acceptable
7. escalation behavior is correct
8. scope limit is tight enough for the current stage
9. rollback would be simple if needed

## Recommended Rollout Pattern

### Day 1

- define role
- define intent
- create template
- start in `simulate`

### Day 2-3

- refine scenarios
- fix blockers
- improve relationship contract
- continue `simulate`

### Day 4

- review trend and reasons
- move to `shadow` if the role is stable

### Day 5-6

- inspect shadow runs carefully
- move to `limited-live` only if evidence supports it

### Day 7+

- move to `live` only after successful staged review

## Troubleshooting

### No runs appearing

- verify assignment is enabled
- verify cadence or event triggers
- verify worker is enabled

### Runs are always blocked

- inspect blocker reason
- tighten SOP
- tighten tool policy
- reduce scope

### Relationship scores are weak

- rewrite relationship contract
- add better scenarios
- narrow department identity
- fix escalation rules

### Role feels too aggressive

- move back one stage
- reduce scope limit
- move intent runtime to stricter mode

### Dashboard says things are healthy but behavior is wrong

- inspect actual run reasons and review notes
- do not trust green badges alone

## The Most Important Rule

Do not ask whether the role can complete the work.

Ask whether the role can preserve the company's way of relating while completing the work.

That is the actual standard for a first-class virtual employee.

## Related Docs

- [Argent Docs Index](./INDEX.md)
- [Workforce + Intent Quick Start](./WORKFORCE_INTENT_QUICKSTART.md)
- [Intent and Support Playbook](./INTENT_AND_SUPPORT_PLAYBOOK.md)
- [Relationship Alignment Architecture](./RELATIONSHIP_ALIGNMENT_ARCHITECTURE.md)
- [Relationship Alignment Implementation Roadmap](./RELATIONSHIP_ALIGNMENT_IMPLEMENTATION_ROADMAP.md)
