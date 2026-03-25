# aos-quickbooks

Agent-native QuickBooks Online accounting connector.

## Generated From ArgentOS

- System: QuickBooks Online
- Category: finance-backoffice
- Backend: quickbooks-online
- Target root: /Users/sem/code/argentos-wave2-rollout-20260318/tools/aos

## Commands

- `capabilities` (readonly)
- `health` (readonly)
- `config show` (readonly)
- `doctor` (readonly)
- `company.read` (readonly)
- `customer.list` (readonly)
- `customer.search` (readonly)
- `customer.read` (readonly)
- `vendor.list` (readonly)
- `vendor.search` (readonly)
- `vendor.read` (readonly)
- `invoice.list` (readonly)
- `invoice.search` (readonly)
- `invoice.read` (readonly)
- `invoice.create_draft` (write)
- `bill.list` (readonly)
- `bill.search` (readonly)
- `bill.read` (readonly)
- `bill.create_draft` (write)
- `payment.list` (readonly)
- `payment.read` (readonly)
- `account.list` (readonly)
- `account.read` (readonly)
- `transaction.list` (readonly)
- `transaction.read` (readonly)

Write paths remain scaffolded and permission-gated:

- `invoice.create_draft` (write)
- `bill.create_draft` (write)

## Auth

- Kind: oauth-service-key
- Required: yes
- Service keys:
  - QBO_CLIENT_ID
  - QBO_CLIENT_SECRET
  - QBO_REFRESH_TOKEN
  - QBO_REALM_ID
- Interactive setup:
- Create an Intuit developer app for QuickBooks Online.
- Add QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REFRESH_TOKEN, and QBO_REALM_ID in API Keys.
- Set QBO_API_BASE_URL to `https://sandbox-quickbooks.api.intuit.com` when targeting a sandbox company.
- Keep company, account, and date-window scope narrow before enabling write actions.

## Next Steps

1. Create a venv and install with `pip install -e '.[dev]'`.
2. Run `aos-quickbooks --json doctor` to verify auth and backend readiness.
3. Use readonly commands for live QuickBooks reads while write paths remain scaffolded.
4. Add integration tests against QuickBooks Online when sandbox credentials are available.
