# Relationship Alignment Architecture

Date: 2026-03-06  
Status: Product Architecture Draft  
Owner: ArgentOS Core Team

## Why This Document Exists

ArgentOS already has strong primitives for:

1. memory
2. intent policy
3. role execution
4. simulation mode
5. run tracking

That is necessary, but it is not sufficient for the product vision.

The missing layer is `relationship alignment`.

The system can already answer:

- what work should be done
- who should do it
- what boundaries apply

But the deeper objective is:

- how an agent should preserve the identity, tone, trust, and relational continuity of a company while doing the work

That is a different class of system from generic automation.

## The Core Truth

For internal automation, the task is the unit.

For customer-facing and human-representative roles, the relationship is the unit.

That means a role can fail even when the output is technically correct.

Examples of relational failure:

1. accurate but cold
2. fast but trust-damaging
3. efficient but misaligned with company tone
4. helpful but overconfident
5. correct but escalated too late

In these cases, the system completed work but failed the role.

## Product Thesis

ArgentOS Workforce should not merely schedule AI labor.

It should synthesize `organizational roles` with enough structure to preserve:

1. brand identity
2. customer trust
3. department boundaries
4. continuity of relationship
5. approved service style
6. escalation discipline

This is closer to `organizational role synthesis` than task automation.

## The Missing Primitive: Relationship Contract

Current systems model:

1. role contract
2. SOP
3. definition of done
4. intent policy
5. tool policy

The next primitive should be:

6. `relationship contract`

The relationship contract is the part of a role that defines:

1. how the company should feel to the other party
2. what trust-preserving behavior looks like
3. what relational damage looks like
4. what continuity must be maintained
5. how uncertainty should be communicated

This should be first-class in the platform, not buried in prompt text.

## Relationship Contract: Proposed Structure

Each customer-facing role should support a relationship contract with fields like:

1. `relationshipObjective`
   - what kind of relationship the role is supposed to preserve
2. `toneProfile`
   - calm, direct, warm, formal, reassuring, etc.
3. `trustPriorities`
   - ordered list such as:
     - protect trust
     - reduce anxiety
     - be accurate
     - be fast
4. `continuityRequirements`
   - what context must be retained and carried forward
5. `honestyRules`
   - how uncertainty, risk, and incomplete knowledge must be disclosed
6. `relationalFailureModes`
   - examples of unacceptable but superficially competent behavior
7. `handoffStyle`
   - how escalation should preserve dignity and confidence

## Role Architecture: Four Layers

The correct Workforce model is not just template plus assignment.

It should be understood as four layers:

### 1. Organizational Identity

Defines:

1. company values
2. service norms
3. what the company refuses to do
4. how the company wants to be experienced

Today this is spread across:

1. global intent
2. alignment docs
3. support docs and policy docs

### 2. Department Identity

Defines:

1. how Support differs from Engineering
2. how Finance differs from Office Ops
3. what counts as success within the department
4. how the department should sound and escalate

Today this mostly maps to:

1. department intent
2. department RAG collections

### 3. Role Contract

Defines:

1. responsibilities
2. scope
3. authority
4. allowed and denied tools
5. SOP
6. definition of done

Today this maps to:

1. job template
2. execution mode
3. tool restrictions

### 4. Relationship Contract

Defines:

1. trust-preserving behavior
2. tone and empathy
3. continuity expectations
4. escalation style
5. what relational failure looks like

This is the missing first-class layer.

## Intent vs Relationship Alignment

Intent and relationship alignment are related but not identical.

### Intent answers

1. what is allowed
2. what is forbidden
3. what requires approval
4. when to escalate
5. what tradeoffs are preferred

### Relationship alignment answers

1. how this role should make people feel
2. how to preserve confidence while being honest
3. what tone is correct for this company
4. how a handoff should preserve dignity and trust
5. what continuity failures count as real failures

Intent is the constitution.

Relationship alignment is the lived service posture.

## Internal vs External Roles

This distinction should be native in the platform.

### Internal technical roles

These can be highly autonomous because they are bounded and testable.

Examples:

1. router audits
2. compliance evidence collection
3. drift detection
4. patch verification
5. server checks
6. internal pen testing

Primary evaluation dimensions:

1. correctness
2. completeness
3. speed
4. bounded risk

### External or human-representative roles

These require stricter governance.

Examples:

1. Tier 1 support
2. customer communication
3. escalation messaging
4. front-line department representation

Primary evaluation dimensions:

1. trust preservation
2. emotional steadiness
3. escalation integrity
4. brand alignment
5. continuity preservation
6. honesty under uncertainty

## Proposed Workforce Data Model Extensions

To support the vision, Workforce should grow beyond:

1. template
2. assignment
3. run

Recommended additions:

### Job Template

Add fields such as:

1. `departmentId`
2. `identityProfileId`
3. `sop`
4. `definitionOfDone`
5. `allowedTools`
6. `forbiddenTools`
7. `publicFacing`
8. `relationshipContract`
9. `evaluationRubric`
10. `promotionPolicy`
11. `rollbackPolicy`

### Assignment

Add fields such as:

1. `deploymentStage`
   - `simulate`
   - `shadow`
   - `limited-live`
   - `live`
2. `scopeLimit`
   - customer subset
   - department subset
   - tool subset
3. `promotionState`
4. `rollbackState`

### Run

Add metadata such as:

1. `relationshipScore`
2. `brandAlignmentScore`
3. `trustPreservationScore`
4. `continuityScore`
5. `honestyScore`
6. `escalationIntegrityScore`
7. `evaluationNotes`

## Proposed Simulation Model

Simulation should not be treated as just "no side effects."

It should be a structured role evaluation harness.

### Stage 1: Spec the role

Define:

1. identity
2. department
3. role contract
4. relationship contract
5. SOP
6. allowed and denied tools
7. escalation rules
8. success and failure conditions

### Stage 2: Run scenario simulations

Scenario coverage should include:

1. angry customer
2. confused customer
3. incomplete internal notes
4. ambiguous symptoms
5. VIP pressure
6. policy edge case
7. mixed emotional + technical issue
8. out-of-scope request

### Stage 3: Evaluate

The simulation rubric should score both technical and relational behavior.

## Proposed Evaluation Rubric

Every public-facing run should be evaluated along these dimensions:

1. `technicalCorrectness`
2. `resolutionIntegrity`
3. `trustPreservation`
4. `emotionalSteadiness`
5. `brandAlignment`
6. `boundaryCompliance`
7. `continuityPreservation`
8. `honestyUnderUncertainty`
9. `escalationCorrectness`

This is the minimum viable rubric for a role that represents the company.

## Promotion Pipeline

Promotion should not be subjective.

It should be earned through evidence.

### Stage 1: Simulation

The role can think and act in a non-live sandbox.

### Stage 2: Shadow

The role drafts but does not send.

### Stage 3: Limited Live

The role operates in narrow scope:

1. limited customer set
2. limited tool surface
3. limited authority

### Stage 4: Full Live

The role is trusted to operate within its defined scope.

### Stage 5: Rollback

If the role damages trust, breaks alignment, or violates boundaries:

1. revert to simulation or shadow
2. capture failure pattern
3. repair role contract, relationship contract, intent, or tools

## Relationship Failure Modes

The system should explicitly model these as failures:

1. technically correct but emotionally cold
2. overconfident despite uncertainty
3. efficient but dismissive
4. fast closure that harms trust
5. escalation too late
6. escalation phrased in a trust-damaging way
7. continuity loss across interactions
8. crossing department voice boundaries

These are not cosmetic problems. They are role failures.

## Tool Surface Design

Capability is not entitlement.

A role should only have the smallest tool surface required for the role.

For public-facing roles:

1. tool allow-lists should be explicit
2. denied tools should be explicit
3. live-write tools should be restricted by stage
4. shadow mode should support draft-only actions

This is how relational safety stays enforceable.

## Relationship Memory and Continuity

Relationship preservation requires continuity.

That means public-facing roles need first-class support for:

1. preserving customer context
2. carrying forward unresolved emotional state
3. avoiding repeated forced restatement
4. preserving prior commitments and handoffs

The memory system should not only remember facts.

It should help preserve the felt continuity of the relationship.

## UI Implications

The current Workforce Board is useful but still reflects internal implementation concepts.

To match the vision, the UI should evolve toward:

1. `Role Definition`
2. `Relationship Contract`
3. `Simulation Lab`
4. `Promotion Gate`
5. `Live Scope`
6. `Rollback Controls`
7. `Run Evaluation`

The operator should not have to reverse-engineer these ideas from low-level fields.

## Suggested UI Sections

### Role Definition

1. role name
2. department
3. responsibilities
4. scope
5. authority
6. non-goals

### Relationship Contract

1. tone
2. trust goals
3. escalation style
4. continuity requirements
5. honesty rules
6. relational failure modes

### Tool Boundaries

1. allowed tools
2. forbidden tools
3. stage-specific tool permissions

### Simulation Lab

1. scenario packs
2. shadow runs
3. evaluation history

### Promotion Gate

1. technical score
2. relationship score
3. blocked conditions
4. operator signoff

## Mapping To Existing ArgentOS Systems

This vision can be built on existing foundations.

### Already present

1. alignment docs
2. intent hierarchy
3. simulation mode
4. execution worker
5. job templates and assignments
6. run tracking
7. knowledge collections and ACL

### Missing first-class concepts

1. relationship contract
2. relational scoring
3. shadow mode as a clear stage
4. promotion and rollback state machine
5. role evaluation beyond throughput
6. brand/department identity packaging

## Strategic Conclusion

ArgentOS should not optimize only for task completion.

For many roles, especially customer-facing ones, the product must optimize for:

1. trustworthy execution
2. bounded autonomy
3. relationship preservation
4. company identity continuity

This is the difference between:

- AI that completes tasks

and

- AI that can safely hold a role inside a living company

That is the real direction of Workforce.

## Next Build Steps

1. add first-class `relationshipContract` to job template design
2. add a simulation rubric with relational scoring
3. add explicit `shadow` and `limited-live` stages
4. add promotion and rollback controls
5. add department identity packaging for support-facing roles
6. add UI sections that expose the relational model directly

## Related Docs

1. [Workforce + Intent Quick Start](./WORKFORCE_INTENT_QUICKSTART.md)
2. [Intent and Support Playbook](./INTENT_AND_SUPPORT_PLAYBOOK.md)
3. [Virtual Employee Runbook](./VIRTUAL_EMPLOYEE_RUNBOOK.md)
4. [ArgentMunch Epic](./ARGENTMUNCH_EPIC.md)
