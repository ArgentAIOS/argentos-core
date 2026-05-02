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

- `QBO_ENVIRONMENT` - `sandbox` or `production`; defaults to `production`
- `QBO_API_BASE_URL` - override the environment-derived QuickBooks API base URL only when needed
- `QBO_TOKEN_URL` - override the Intuit OAuth token endpoint if needed
- `QBO_MINOR_VERSION` - default QuickBooks API minor version is `75`
- `QBO_HTTP_TIMEOUT_SECONDS` - request timeout for live probes and reads

Per-install OAuth setup:

1. Create an Intuit developer app with the QuickBooks Online Accounting scope.
2. Configure either Intuit OAuth Playground or a local callback redirect URL in the developer app.
3. Authorize the target company through that redirect and capture the returned `realmId`.
4. Exchange the authorization grant for a refresh token.
5. Store `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REALM_ID`, `QBO_REFRESH_TOKEN`, and `QBO_ENVIRONMENT` in operator-controlled service keys outside git.
6. Run `aos-quickbooks --json health`; until it succeeds, the connector remains `needs_setup` and not live-ready.

Do not paste client secrets or refresh tokens into Threadmaster, git, docs, or
test fixtures. Live Intuit reads/writes require explicit Master authorization
after the credentials are stored outside git.

## Notes

Readonly commands now use live QuickBooks Online API calls.
Write commands now use live QuickBooks Online API calls and remain blocked unless the connector runs in `write` mode or higher.

Write command arguments use `key=value` pairs:

- `invoice create_draft customer_id=<id> item_id=<sales item id> amount=<amount>`
- `bill create_draft vendor_id=<id> account_id=<account id> amount=<amount>`
