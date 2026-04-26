# aos-hubspot agent harness

Python Click wrapper for the live `aos-hubspot` connector surface.

The harness resolves `HUBSPOT_ACCESS_TOKEN` and `HUBSPOT_PORTAL_ID` from
operator-controlled service keys first, then falls back to local `HUBSPOT_*`
or legacy `AOS_HUBSPOT_*` environment variables for local development.

Focused test run:

```bash
cd agent-harness
PYTHONPATH=. pytest tests/test_cli.py
```
