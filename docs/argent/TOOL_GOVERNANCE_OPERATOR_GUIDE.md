# Tool Governance Operator Guide

## Purpose

Tool governance answers two operator questions:

1. What can this agent or worker actually use right now?
2. Which tools require explicit operator approval before they run?

ArgentOS currently resolves tool policy through multiple layers. This guide reduces that to one operator model.

## The effective order

Concrete tool access resolves in this order:

1. Global tool policy
2. Department tool policy
3. Agent tool policy
4. Session or channel policy
5. Workforce template, assignment, and stage restrictions

Intent is related, but different. Intent describes behavioral rules and approval principles. Tool governance is the hard runtime allow, ask, or deny decision.

## Policy states

Each tool can be in one of three practical states:

- `allow`: tool can run normally
- `ask`: tool stays visible but requires operator approval where runtime approval is wired
- `deny`: tool is blocked regardless of prompt wording

## What `ask` means today

`ask` is fully runtime-backed for the current high-risk set:

- `exec`
- `message`
- `send_payload`
- `email_delivery`
- `namecheap_dns`

For other tools, `ask` is still useful as operator policy intent, but runtime approval pause and resume is not yet wired.

## Where department comes from

Department is currently assigned through intent:

- `intent.agents.<agentId>.departmentId`

That department id is then used to resolve:

- `tools.departments.<departmentId>`

This means department-level tool governance is real, but the department assignment itself still lives in the intent layer.

## Operator model

Use the following mental model:

- Global: what exists at the system level
- Department: what this operating function normally gets
- Agent: what this specific identity is allowed to do
- Session/channel: what is safe in this context right now
- Workforce stage: what is safe for this job at this maturity level

## Current dashboard truth surface

The Config `Capabilities` tab is the current operator truth surface.

It now shows:

- selected agent
- effective visible tools
- whether a tool is in `ask`
- whether that `ask` is runtime-backed
- where the `ask` came from:
  - `global`
  - `department`
  - `agent`

It also shows the current policy chain snapshot:

- global ask list
- department id and department ask list
- agent ask list

## Recommended operator usage

Use `ask` for tools that can:

- cost money
- create an external commitment
- send customer-visible communication
- make destructive changes
- create legal or compliance risk

Examples:

- `namecheap_dns`: usually `ask`
- `email_delivery`: usually `ask`
- `exec`: often `ask` or `deny` outside engineering/admin contexts

Use `deny` for tools that should never run in a role or stage.

Use `allow` for tools that are normal and low-risk for the role.

## Relationship to workforce

Workforce adds one more policy layer on top of core tool policy:

- template `toolsAllow`
- template `toolsDeny`
- assignment overrides
- stage restrictions like `simulate` or `shadow`

This means a tool can be globally allowed but still blocked for a simulated workforce assignment.

## Known current gaps

The system is now operator-readable, but not yet fully unified.

Still missing:

- first-class department editor for tool policy
- full per-tool approval wiring for every `ask` tool
- a dedicated fleet-wide effective tool access viewer
- stronger visibility for workforce-stage tool resolution in the same panel

## Practical rule

If an operator wants to know why a tool is or is not available:

1. Start in `Config -> Capabilities`
2. Check whether the tool is visible
3. Check whether it is marked `ask`
4. Check the `source` of that `ask`
5. Then check workforce assignment or stage restrictions if the worker is running in workforce mode
