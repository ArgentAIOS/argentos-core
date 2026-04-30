# PagerDuty Connector Harness

ArgentOS harness for the `aos-pagerduty` connector.

## What it does

- Uses a Click CLI with `--json`, `--mode`, and `--verbose`
- Talks to the live PagerDuty REST API for reads and incident writes
- Talks to the PagerDuty Events API v2 for `change-event create`
- Exposes `capabilities`, `health`, `config show`, and `doctor`

## Notes

- `incident list|get`, `service list|get`, `escalation-policy list`, `on-call list`, `alert list`, `incident create`, `incident acknowledge`, and `incident resolve` require `PAGERDUTY_API_KEY`
- Incident write commands also require `PAGERDUTY_FROM_EMAIL`
- `change-event create` requires `PAGERDUTY_EVENTS_ROUTING_KEY`
- Operator-injected `service_keys` are preferred for secrets; env fallback is only in the service-key helper
- Optional scope env vars:
  - `PAGERDUTY_SERVICE_ID`
  - `PAGERDUTY_INCIDENT_ID`
  - `PAGERDUTY_ESCALATION_POLICY_ID`
  - `PAGERDUTY_URGENCY`
  - `PAGERDUTY_TITLE`
  - `PAGERDUTY_DESCRIPTION`
  - `PAGERDUTY_SUMMARY`
  - `PAGERDUTY_RESOLUTION`
