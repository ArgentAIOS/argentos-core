# Workforce + Family Creation Capability Audit (2026-03-08)

## Live audit basis

This audit was performed from Argent's live runtime and cross-checked against Workforce dashboard screenshots.

Tools exercised:

- `family.list`
- `workforce_setup_tool(action="agent_options")`
- `workforce_setup_tool(action="draft", ...)`
- `workforce_setup_tool(action="project_start", ...)`

## Executive summary

- Agent-side creation is real and working.
- Operator-side visibility is better than first assumed.
- Operator-side lifecycle control is still incomplete.
- Highest mismatch is now editability, binding clarity, execution/review controls, and fleet-level observability.

## Confirmed live capabilities (agent/tool side)

### Family layer

- Family worker list and routing are available.
- Persistent worker creation/registration is available.
- Family messaging/spawn/dispatch flows are available.
- Live list included `relay`, `tier-1-technical-support`, and other workforce-related members.

### Workforce setup layer

- `agent_options` works.
- `draft` works.
- `project_start` works and can create worker + template + assignment in one action.

### Successful project_start evidence

Worker:

- id: `tier-1-technical-support`
- name: `Titanium Tier 1 Audit`
- role: `tier_1_technical_support`
- team: `MSP Team`

Template:

- id: `6345c1ac-7083-42e9-a982-615ad97d57c4`
- name: `Tier 1 Technical Support`
- mode: `simulate`
- stage: `simulate`
- toolsAllow included Atera + memory/tasks toolset

Assignment:

- id: `5a913205-7055-4978-ad98-762438425628`
- title: `Titanium Computing Tier 1 Technical Support Simulation Audit`
- executionMode: `simulate`
- deploymentStage: `simulate`
- promotionState: `draft`
- cadenceMinutes: `1440`
- reviewRequired: `true`

## Board readout after screenshot review

### Already visible in board (stronger than initial assumption)

- Worker roster with counts/status.
- Selected worker summary.
- Stage and trigger model.
- Linked assignments/templates.
- Role contract and success definition.
- Relationship objective and tool policy.
- Scenario coverage.
- Assignment list with title/cadence/stage/scope.
- Template editor with checklist and persistent create button.
- Run list/status visibility.

### Still weak/incomplete

1. Existing family worker discovery/binding consistency:

- Setup flows can still bias toward `Argent (Primary)` instead of clearly enumerating existing family workers.

2. Create/edit/bind semantics:

- Operator state is unclear: create vs edit vs clone vs rebind.

3. Runs + review action depth:

- Needs explicit `Run now`, retry, in-context promote/hold/rollback, review notes/history.

4. Artifact editability:

- Details are visible but edit controls for existing workers/templates/assignments are still weak.

5. Assignment disambiguation:

- Similar titles are difficult to distinguish without stronger identity markers.

6. Fleet-level operations overview:

- Missing top-down control-tower view across all workers.

## Most important mismatches to fix next

1. Existing family worker discovery in setup/binding.
2. Explicit create/edit/bind mode labeling.
3. Run-now and review intervention controls.
4. Editing for existing workers/templates/assignments.
5. Assignment disambiguation markers.
6. Workforce Operations Overview page:

- worker, role, team
- active/inactive
- current assignment
- next run
- last run result
- attention-needed indicators
- direct log/review drilldown

## Recommendation

Treat the dashboard as operator-visible but operator-incomplete.
The system can create workforce artifacts from tooling today; the board now needs lifecycle management and fleet governance parity.
