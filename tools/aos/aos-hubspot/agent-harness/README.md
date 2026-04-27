# aos-hubspot agent harness

Python Click wrapper for the live `aos-hubspot` connector surface.

The harness resolves `HUBSPOT_ACCESS_TOKEN` and `HUBSPOT_PORTAL_ID` from
operator-controlled service keys first, then falls back to local `HUBSPOT_*`
or legacy `AOS_HUBSPOT_*` environment variables for local development. Scoped
service-key entries must be injected by the operator runtime and are not
bypassed with local env. Production live-write smoke is not claimed until tested
against an operator HubSpot portal.

Focused test run:

```bash
cd agent-harness
PYTHONPATH=. pytest tests/test_cli.py
```
