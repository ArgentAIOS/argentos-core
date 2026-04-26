# aos-quickbooks agent harness

Python Click harness for QuickBooks Online.

## Install

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
aos-quickbooks --json capabilities
aos-quickbooks --json health
aos-quickbooks --json config show
aos-quickbooks --json doctor
```

## Readiness

Required service keys:

- `QBO_CLIENT_ID`
- `QBO_CLIENT_SECRET`
- `QBO_REFRESH_TOKEN`
- `QBO_REALM_ID`

Optional runtime controls:

- `QBO_API_BASE_URL` - use the sandbox base URL for sandbox companies
- `QBO_TOKEN_URL` - override the Intuit OAuth token endpoint if needed
- `QBO_MINOR_VERSION` - default QuickBooks API minor version is `75`
- `QBO_HTTP_TIMEOUT_SECONDS` - request timeout for live probes and reads

## Notes

Readonly commands now use live QuickBooks Online API calls.
Write commands now use live QuickBooks Online API calls and remain blocked unless the connector runs in `write` mode or higher.

Write command arguments use `key=value` pairs:

- `invoice create_draft customer_id=<id> item_id=<sales item id> amount=<amount>`
- `bill create_draft vendor_id=<id> account_id=<account id> amount=<amount>`
