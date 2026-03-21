---
name: workforce-setup
description: Guide the operator through creating a workforce role, drafting the relationship contract, choosing the target family/primary agent, and starting the worker in the correct staged mode. Use when the user wants to set up a worker, employee role, job template, or assignment conversationally.
---

# Workforce Setup

Use this skill when the operator wants Argent to collaborate on creating a worker role instead of manually filling out the Workforce Board.

## Primary Tool

Use `workforce_setup_tool` as the system of record for drafting and creating:

- role templates
- assignments
- target-agent selection
- new family worker creation
- initial deployment stage

Do not rely on raw `jobs_tool` calls unless you are repairing or inspecting an existing workforce artifact.

If you are unsure whether workforce setup capability is available in the current runtime, call
`tool_search` first with terms like `workforce worker family setup role assignment simulate`
before claiming the capability does not exist.

## Operator Conversation Sequence

Collect and confirm these in order:

1. `roleName`
2. `rolePrompt` or concise role brief
3. `relationshipObjective`
4. `successDefinition`
5. `simulationScenarios`
6. `targetMode`
7. if `targetMode=existing`, collect `targetAgentId`
8. if `targetMode=create`, collect a worker draft:
   - `newAgentName`
   - `newAgentRole`
   - optional `newAgentPersona`
   - optional `newAgentTeam`
   - optional `newAgentModel`
   - optional `newAgentTools`
9. `cadenceMinutes`
10. optional:

- `departmentId`
- `scopeLimit`
- `toolsAllow`
- `toolsDeny`
- `sop`
- `assignmentTitle`

If the operator is still thinking, use `workforce_setup_tool` with `action="draft"` to surface missing fields and the next best follow-up questions.

## Required Framing

Always explain the role in operator terms:

- `Argent (Primary)` means the main agent owns the role
- an `existing family worker` is a persistent specialist that already exists
- `create new family worker` means provisioning a new persistent specialist with its own identity and boundaries
- new roles should start in `simulate`, then move deliberately through `shadow`, `limited-live`, and `live`

Do not create the worker immediately unless the operator clearly wants you to proceed.

## Creation Rules

1. Start with `action="draft"` if the request is incomplete.
2. Use `action="agent_options"` if target assignment is ambiguous.
3. If the operator wants a new worker, use `action="worker_create"` only after the new worker draft is confirmed.
4. Use `action="template_create"` only after the role contract is complete.
5. Use `action="assignment_create"` after the operator confirms the target agent and cadence.
6. Use `action="project_start"` when the operator wants the whole setup created in one step; it can create the worker first if `targetMode=create`.

## Worker Ownership Guidance

Prefer:

- `targetMode="primary"` when the operator wants Argent herself to own the role
- `targetMode="existing"` when a current family worker should take on one or more workforce jobs
- `targetMode="create"` when the role is a durable specialization that deserves a dedicated family worker

Remember:

- one family worker can hold one or many workforce jobs
- workforce jobs are assignments layered on top of the worker’s persistent identity
- do not create a new worker unless the operator actually wants a new persistent specialist

## Safety Rules

- Default deployment stage to `simulate`.
- Do not skip relationship objectives or simulation scenarios for customer-facing roles.
- If the operator asks for a public-facing or trust-bearing role, push for at least 2-3 realistic simulation scenarios before creation.
- If the role boundaries are vague, slow down and clarify the scope before creating anything.

## Good Outcomes

A good workforce setup conversation ends with:

- a clear operator-readable role name
- a real job/relationship contract
- explicit success criteria
- explicit target choice (`Argent`, `existing worker`, or `new worker`)
- a simulation-first launch posture

## Example Use

When the user says:

- "Help me set up a Tier 1 support worker"
- "I want Argent to help me build a job role for Maya"
- "Let's create an employee role and assign it to a family agent"

You should use this skill and drive the setup conversationally instead of telling the operator to fill out the board manually.
