# Intent & Support Playbook

Status: Operator Draft v2  
Date: 2026-03-06  
Owner: ArgentOS Core Team

## Why This Exists

The current system is powerful, but the operator model is easy to lose.

This playbook explains the system in plain language:

1. `Intent` is the behavioral constitution.
2. `Workforce` is the role and execution system.
3. `Simulation` is how a role earns promotion to live use.

This is the bridge between policy, service quality, and safe deployment.

## The One-Sentence Model

If Workforce answers:

- "What work should this agent do?"

Intent answers:

- "How is this agent allowed to behave while doing it?"

That distinction matters.

- Workforce is about role, schedule, execution, and runs.
- Intent is about boundaries, escalation, approvals, and tradeoffs.

Do not treat them as the same feature.

## The Core Principle

Support and other human-representative roles cannot be measured only by closure speed.

The role includes:

1. preserving trust
2. reducing anxiety
3. escalating honestly
4. staying inside company boundaries
5. resolving accurately

The output is not the whole job. The relationship is part of the job.

## What Intent Actually Is

Intent should encode both:

1. What the agent can and cannot do.
2. How the agent should behave when the situation is ambiguous, risky, emotional, or outside scope.

In practice, Intent is where you define:

1. objective
2. tradeoff hierarchy
3. never-do rules
4. approval requirements
5. escalation thresholds
6. sticky behavior requirements

## The Three Layers

ArgentOS uses three levels of intent:

1. `Global`
   - company-wide rules
   - what no agent should violate
2. `Department`
   - how Support differs from Engineering, Ops, Research, or Office
3. `Agent`
   - the final narrowing for one specific worker

The rule is monotonic inheritance:

- child policy can tighten
- child policy cannot loosen

Examples:

- a department can add more escalation rules than global
- an agent can require more approvals than department
- an agent cannot remove a global "never do" rule

## The Operator Mental Model

Use this model when configuring the system:

1. `Global intent`
   - what the company believes and refuses
2. `Department intent`
   - how this lane operates
3. `Agent intent`
   - what this specific worker must optimize for
4. `Job template`
   - what repeatable role/work should exist
5. `Assignment`
   - who runs it, how often, and in what mode
6. `Run`
   - what actually happened

That means:

- intent defines behavior
- workforce defines work
- runs provide evidence

## Current UI: How To Use It

### Intent System

Use the intent editor when you need to answer:

1. What must never happen?
2. What always needs approval?
3. When should the agent stop and escalate?
4. What should it optimize for when tradeoffs appear?

The safe order is:

1. set `Global` baseline
2. set `Department` behavior
3. add `Agent` narrowing only where needed
4. start with `runtimeMode: advisory`
5. move to `enforce` only after simulation and review

### Workforce Board

Use the Workforce Board when you need to answer:

1. What repeatable role should exist?
2. Which agent should carry that role?
3. Should it run in `simulate` or `live` mode?
4. What happened when it executed?

Current board mapping:

1. `Template`
   - reusable job definition
   - the role contract for repeatable work
2. `Assignment`
   - binds template to agent + cadence + mode
3. `Run Queue`
   - execution history and current state

If the board feels unclear, use this translation:

- `Role contract` = what this worker is supposed to do
- `simulate` = rehearse safely with guardrails
- `live` = real side effects allowed
- `blocked` = system or policy prevented safe completion

## Recommended Operator Workflow

For a new worker:

1. define alignment docs
2. define intent
3. define job template
4. assign job in `simulate`
5. inspect runs
6. tighten role contract, SOP, intent, or tools
7. repeat
8. only then promote to `live`

If you skip simulation, you are promoting an unproven role into production.

## Recommended Intent Structure

For most deployments:

1. `intent.global`
2. `intent.departments.operations`
3. `intent.agents.main`
4. `intent.departments.support`
5. support agents reference `departmentId: "support"`

Do not create unnecessary departments just because you can.

Use a new department only when the behavior model is materially different.

## Support Department Pattern

### Support Objective

Support should usually prioritize:

1. protect trust first
2. reduce customer anxiety second
3. resolve accurately third
4. resolve quickly fourth

That order changes behavior materially.

### Tradeoff Order (example)

1. `long_term_relationship_value`
2. `accuracy_and_trust`
3. `resolution_quality`
4. `resolution_speed`
5. `operational_efficiency`

### Never-Do examples

1. blame or shame the user
2. close unresolved tickets to improve metrics
3. ignore frustration signals
4. make unauthorized policy or financial commitments

### Requires-Human-Approval examples

1. policy exceptions above threshold
2. refunds or credits above threshold
3. legal, compliance, or PR-risk responses
4. termination or suspension actions

### Escalation examples

1. escalate after N failed attempts
2. escalate when sentiment drops below threshold
3. escalate when conversation exceeds time threshold
4. escalate immediately for regulated or high-risk requests

## Internal Automation vs Customer-Facing Roles

Do not govern all roles the same way.

### Good candidates for high autonomy

These can usually be more autonomous:

1. router audits
2. compliance evidence collection
3. drift detection
4. patch verification
5. internal infrastructure analysis

These are bounded and mostly technical.

### Roles that need stricter governance

These require much stronger intent and simulation gates:

1. Tier 1 support
2. customer messaging
3. escalation handling
4. front-line role representation

These roles are representing the company, not just completing tasks.

## Department RAG Design for Support

Intent alone is not enough. Support also needs behavior-specific knowledge.

Create support collections:

1. `support-policy`
2. `support-tone`
3. `support-goodwill`
4. `support-runbooks`
5. `support-exceptions`

Retrieval pattern:

1. technical issue -> `support-runbooks`
2. emotional or frustrated user -> also pull `support-tone`
3. policy, waiver, or goodwill decision -> `support-policy` + `support-goodwill`

## Simulation, Shadow, and Promotion

This is the safe path to live use.

### Stage 1: Spec the role

Define:

1. identity
2. department
3. role contract
4. SOP
5. definition of done
6. allowed tools
7. forbidden tools
8. escalation rules
9. success and failure conditions

### Stage 2: Run simulation

Test on scenarios like:

1. angry customer
2. confused customer
3. missing internal notes
4. ambiguous symptoms
5. VIP pressure
6. requests outside scope

### Stage 3: Evaluate behavior

Score:

1. technical correctness
2. trust preservation
3. escalation integrity
4. emotional steadiness
5. brand alignment
6. boundary compliance

### Stage 4: Shadow mode

If available in the workflow, let the agent draft or observe without sending.

### Stage 5: Limited live exposure

Use narrow customer scope, narrow tools, narrow permissions.

### Stage 6: Promotion or rollback

Promote only with evidence.

Rollback immediately if the role harms trust or violates boundaries.

## Runtime Enforcement Beyond Intent

Intent is necessary but not sufficient. Runtime quality checks should exist for support roles.

Recommended validators:

1. empathy presence
2. no-blame language
3. resolution integrity
4. escalation correctness
5. claim-evidence consistency

If an agent claims action was taken, the tool evidence should exist in the same run.

## Example Intent Snippet (Support Department)

```json
{
  "intent": {
    "enabled": true,
    "validationMode": "warn",
    "runtimeMode": "advisory",
    "global": {
      "version": "2026-03-01",
      "objective": "Deliver trustworthy outcomes while preserving long-term user trust.",
      "tradeoffHierarchy": [
        "long_term_relationship_value",
        "accuracy_and_trust",
        "resolution_quality",
        "resolution_speed",
        "operational_efficiency"
      ],
      "allowedActions": [
        "resolve_known_pattern",
        "request_missing_context",
        "prepare_handoff_packet",
        "update_task_state_with_evidence"
      ],
      "requiresHumanApproval": ["policy_exception", "financial_commitment", "legal_or_pr_risk"]
    },
    "departments": {
      "support": {
        "version": "2026-03-01",
        "tradeoffHierarchy": [
          "long_term_relationship_value",
          "accuracy_and_trust",
          "resolution_quality",
          "resolution_speed",
          "operational_efficiency",
          "de_escalation_quality",
          "customer_dignity"
        ],
        "allowedActions": [
          "resolve_known_pattern",
          "request_missing_context",
          "prepare_handoff_packet",
          "update_task_state_with_evidence"
        ],
        "neverDo": ["blame_customer", "dismiss_customer_emotion", "close_unresolved_ticket"],
        "requiresHumanApproval": [
          "policy_exception",
          "financial_commitment",
          "legal_or_pr_risk",
          "goodwill_above_threshold"
        ],
        "escalation": {
          "maxAttemptsBeforeEscalation": 2,
          "timeInConversationMinutes": 8
        }
      }
    }
  }
}
```

Note: keep hierarchy monotonic. Child values may tighten or extend parent constraints, never loosen them.

## Second-Brain Main Agent Pattern

For the operator-facing `main` agent:

1. keep `departmentId: "operations"` unless there is a real reason not to
2. encode second-brain behavior on `intent.agents.main`

Typical `main` agent intent should include:

1. evidence-first progress
2. explicit handoff on blockers
3. approval requirements for external writes
4. escalation after repeated no-progress attempts

That yields second-brain behavior without inventing unnecessary departments.

## What Good Looks Like

A good support or workforce role should:

1. behave predictably under stress
2. preserve trust, not just throughput
3. escalate honestly
4. stay inside tool and policy boundaries
5. be promotable from simulation to live based on evidence

## Operator Checklist

Before promoting any role to live, confirm:

1. the role contract is explicit
2. intent is set at the right layer
3. approvals are clear
4. escalation thresholds are explicit
5. simulation runs are stable
6. blocked runs have been reviewed
7. the role preserves relationship quality, not only output speed

## Related Docs

1. [Virtual Employee Runbook](./VIRTUAL_EMPLOYEE_RUNBOOK.md)
2. [SpecForge Intent Enforcement](./SPECFORGE_INTENT_ENFORCEMENT.md)
3. [Argent Docs Index](./INDEX.md)
