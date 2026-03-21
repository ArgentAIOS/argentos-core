# Co-Pilot Runtime Tools

This document maps the Co-Pilot specs to live callable tools in runtime.

## Implemented Tools

1. `intent_tool`
2. `copilot_system_tool`

## `intent_tool` Actions

- `overview`
- `company_get`
- `department_get`
- `agent_get`
- `effective_resolve`
- `draft_from_interview`
- `diff`
- `validate`
- `apply`
- `access_mode_get`
- `access_mode_set`
- `history`
- `rollback`

### Example

```json
{
  "action": "draft_from_interview",
  "departmentId": "support",
  "role": "tier_1_support_specialist",
  "interviewNotes": "truth-first, escalation-aware, no external commitments"
}
```

## `copilot_system_tool` Actions

- Governance:
  - `overview`
  - `domain_status`
  - `access_mode_get`
  - `access_mode_set`
- Workforce:
  - `workforce_overview`
  - `run_story`
  - `tool_policy_preview`
- Operator Surfaces:
  - `observability_overview`
  - `onboarding_plan`
  - `memory_governance_overview`
  - `voice_presence_overview`
  - `nudge_offtime_overview`
  - `department_org_overview`
  - `deployment_rollout_overview`

### Example

```json
{
  "action": "access_mode_set",
  "domain": "workforce",
  "mode": "assist-live-limited"
}
```

## Persisted Governance State

Co-Pilot access modes and intent change history persist in:

- `~/.argentos/copilot/state.json`

This state tracks:

- per-domain access mode
- intent change history for rollback/audit
