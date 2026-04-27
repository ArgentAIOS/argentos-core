# aos-xero agent harness

Python Click harness for the `aos-xero` connector.

This harness provides live-read access to the Xero Accounting API. Write
commands are intentionally absent until live Xero write workflows and approval
policy are implemented and verified.

## Runtime expectations

The harness resolves required and optional keys from operator-controlled
service keys first, then falls back to process env only for local development.

Required:

- `XERO_CLIENT_ID`
- `XERO_CLIENT_SECRET`
- `XERO_REFRESH_TOKEN`
- `XERO_TENANT_ID`

Optional defaults:

- `XERO_CONTACT_ID`
- `XERO_INVOICE_ID`
- `XERO_PAYMENT_ID`
- `XERO_DATE`
- `XERO_API_BASE_URL`
- `XERO_TOKEN_URL`

## Verification

```bash
cd tools/aos/aos-xero/agent-harness
python -m pytest tests/
```
