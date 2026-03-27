# PagerDuty Connector Harness

ArgentOS harness for the `aos-pagerduty` connector.

## What it does

- Uses a Click CLI with `--json`, `--mode`, and `--verbose`
- Talks to the live PagerDuty REST API for read commands
- Keeps manifest-only write commands scaffolded and permission gated
- Exposes `capabilities`, `health`, `config show`, and `doctor`

## Notes

- Live reads require `PAGERDUTY_API_KEY`
- Optional scope env vars:
  - `PAGERDUTY_SERVICE_ID`
  - `PAGERDUTY_INCIDENT_ID`
  - `PAGERDUTY_ESCALATION_POLICY_ID`
  - `PAGERDUTY_URGENCY`
  - `PAGERDUTY_TITLE`
  - `PAGERDUTY_DESCRIPTION`
