# ArgentOS Co-Pilot System Series

## Purpose

This document defines the Co-Pilot program for ArgentOS and links the subsystem-specific specs.

The Co-Pilot pattern is used where a subsystem is:

- powerful,
- consequential,
- and too cognitively expensive for normal operators without guided help.

## Reusable Co-Pilot Pattern

Every Co-Pilot spec should implement this lifecycle:

1. Inspect
2. Explain
3. Interview
4. Draft
5. Validate
6. Diff
7. Apply (if authorized)
8. Rollback
9. Audit

## Governance Baseline

All Co-Pilots inherit the same operator-control model:

- `off`: operator-only
- `assist-draft`: AI may inspect + draft only
- `assist-propose`: AI may draft + prepare change sets for approval
- `assist-live-limited`: AI may apply only inside operator-approved scopes

Required controls:

- visible access mode indicator
- explicit mode toggle
- approval gate for production-impacting changes
- full change history with actor, rationale, and before/after diff

## Priority Tiers

Tier 1:

1. Intent Co-Pilot
2. Workforce Operations Co-Pilot
3. Run Story / Audit Co-Pilot

Tier 2:

1. Company Onboarding Co-Pilot
2. Tool Policy / Capability Co-Pilot
3. Observability / Health Co-Pilot

Tier 3:

1. Nudge / Off-Time Behavior Co-Pilot
2. Memory Governance Co-Pilot
3. Voice / Presence Co-Pilot
4. Department / Org Design Co-Pilot
5. Deployment / Rollout Co-Pilot

## Spec Pack

- [Intent Co-Pilot Spec](./COPILOT_INTENT_SPEC.md)
- [Workforce Operations Co-Pilot Spec](./COPILOT_WORKFORCE_OPERATIONS_SPEC.md)
- [Run Story + Audit Co-Pilot Spec](./COPILOT_RUN_STORY_AUDIT_SPEC.md)
- [Tool Policy + Capability Co-Pilot Spec](./COPILOT_TOOL_POLICY_SPEC.md)
- [Company Onboarding Co-Pilot Spec](./COPILOT_COMPANY_ONBOARDING_SPEC.md)
- [Observability + Health Co-Pilot Spec](./COPILOT_OBSERVABILITY_HEALTH_SPEC.md)
- [Nudge + Off-Time Behavior Co-Pilot Spec](./COPILOT_NUDGE_OFFTIME_SPEC.md)
- [Memory Governance Co-Pilot Spec](./COPILOT_MEMORY_GOVERNANCE_SPEC.md)
- [Voice + Presence Co-Pilot Spec](./COPILOT_VOICE_PRESENCE_SPEC.md)
- [Department + Org Design Co-Pilot Spec](./COPILOT_DEPARTMENT_ORG_DESIGN_SPEC.md)
- [Deployment + Rollout Co-Pilot Spec](./COPILOT_DEPLOYMENT_ROLLOUT_SPEC.md)

## Implementation Order Recommendation

Phase A:

- Intent + Workforce + Run Story

Phase B:

- Tool Policy + Company Onboarding + Health

Phase C:

- Memory + Voice + Nudge + Org + Rollout

## Exit Criteria for "Co-Pilot Ready"

A spec is implementation-ready only when it includes:

- concrete tool/action surface,
- dashboard entry points,
- operator approvals + rollback,
- acceptance criteria,
- test plan.
