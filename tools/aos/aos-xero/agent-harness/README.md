# aos-xero agent harness

Python Click harness for the `aos-xero` connector.

This harness provides live-read access to the Xero Accounting API and leaves
write commands explicitly scaffolded because the manifest marks the connector
as `scaffold_only: true`.

## Runtime expectations

- `XERO_CLIENT_ID`
- `XERO_CLIENT_SECRET`
- `XERO_REFRESH_TOKEN`
- `XERO_TENANT_ID`

Optional defaults:

- `XERO_CONTACT_ID`
- `XERO_INVOICE_ID`
- `XERO_PAYMENT_ID`
- `XERO_API_BASE_URL`
- `XERO_TOKEN_URL`

## Verification

```bash
cd tools/aos/aos-xero/agent-harness
python -m pytest tests/
```
