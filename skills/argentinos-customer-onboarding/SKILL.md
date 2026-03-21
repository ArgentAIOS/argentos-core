---
name: argentinos-customer-onboarding
description: Run the full ArgentOS customer onboarding pipeline from structured intake through a 5-phase discovery session to deployment-ready outputs. Use when the user asks for complete customer onboarding, architecture definition, or generation of strategy/spec/bootstrap and skills-gap artifacts.
---

# ArgentOS Customer Onboarding

Use this skill for full discovery-to-design onboarding, not a lightweight demo call.

## Pipeline Contract

Always deliver four artifacts:

1. Customer strategy document
2. Technical implementation spec
3. Bootstrap prompt
4. Skills gap report

## Execution Sequence

1. Run intake capture using [intake-form.md](references/intake-form.md)
2. Run five discovery phases using [discovery-phases.md](references/discovery-phases.md)
3. Map pain points to archetypes with [agent-archetypes.md](references/agent-archetypes.md)
4. Generate artifacts using [output-artifacts.md](references/output-artifacts.md)
5. Generate gap report using [skills-gap-report.md](references/skills-gap-report.md)
6. Stage delivery plan using [phase-plan.md](references/phase-plan.md)
7. Capture intake payload contract from [docpanel-intake-contract.md](references/docpanel-intake-contract.md)
8. Use baseline artifact shape from [ctsa-artifact-examples.md](references/ctsa-artifact-examples.md)
9. Run `onboarding_pack` with the intake payload to emit the four artifacts in one execution.

## Interview Discipline

- Ask for concrete workflows, not abstract goals.
- Convert each pain statement into trigger, actor, and failure mode.
- Keep phase-one scope narrow and measurable.
- Make approval boundaries explicit.

## Minimum Evidence To Return

- Confirmed business context
- Confirmed top pain points and phase-one anchor
- Proposed agent roster with role mapping
- Required integrations and data sources
- Guardrails and escalation rules
- Artifact completion status and blockers

## References

- [intake-form.md](references/intake-form.md)
- [discovery-phases.md](references/discovery-phases.md)
- [agent-archetypes.md](references/agent-archetypes.md)
- [output-artifacts.md](references/output-artifacts.md)
- [skills-gap-report.md](references/skills-gap-report.md)
- [phase-plan.md](references/phase-plan.md)
- [docpanel-intake-contract.md](references/docpanel-intake-contract.md)
- [docpanel-intake.schema.json](references/docpanel-intake.schema.json)
- [ctsa-artifact-examples.md](references/ctsa-artifact-examples.md)
