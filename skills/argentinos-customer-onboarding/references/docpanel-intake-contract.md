# DocPanel Intake Contract

Use this contract when storing onboarding intake in DocPanel and passing structured context to discovery.

## Contract Version

- `schemaVersion`: `1.0.0`
- Schema file: [docpanel-intake.schema.json](docpanel-intake.schema.json)

## Submission Envelope

```json
{
  "kind": "argentos.customer-intake",
  "schemaVersion": "1.0.0",
  "submittedAt": "2026-03-04T00:00:00.000Z",
  "submittedBy": "operator-or-agent-id",
  "payload": {}
}
```

## DocPanel Save Mapping

When persisting to DocPanel:

- `title`:
  - `Customer Intake - <company.name>`
- `tags`:
  - `onboarding`
  - `intake`
  - `<company.industry>`
  - `<company.name-slug>`
- `text`:
  - Human-readable markdown summary
  - Include embedded JSON block of the exact payload

Recommended markdown pattern:

````markdown
# Customer Intake - ACME

## Summary

- Industry: MSP
- Headcount: 42
- Day-one anchor: Auto-triage P1 incidents

## Structured Payload

```json
{ ...exact envelope... }
```
````

## Discovery Session Mapping

Map intake fields to discovery phases:

- `payload.company` -> Phase 1 Business Context
- `payload.painPoints` -> Phase 2 Pain Points
- `payload.stack` and `payload.integrations` -> Phase 4 Systems Audit
- `payload.guardrails` -> Phase 5 Alignment And Guardrails
- `payload.outcomes.dayOneAnchor` -> Phase-1 deployment target

## Validation Rule

Reject intake as incomplete if any is missing:

- company name
- primary contact
- at least one pain point
- at least one target outcome
