# aos-quickbooks

`aos-quickbooks` is a first-pass vendored connector scaffold for QuickBooks.

This directory follows the existing `aos-*` layout:

- repo-visible connector metadata in `connector.json`
- Python Click agent harness in `agent-harness/`
- stable connector contract for `capabilities`, `health`, and `config show`

The scaffold is intentionally conservative. It exposes the Wave 2 bookkeeping/accounting surface in metadata and CLI shape, but it does not execute live QuickBooks API calls yet.

## Intended Wave 2 surface

Resources:

- `company`
- `customer`
- `invoice`
- `payment`
- `bill`
- `vendor`
- `account`
- `report`

Starter command families:

- company info
- customer lookup
- invoice list/read/create/update
- payment list/read/create
- bill list/read/create
- vendor list/read
- account list
- bookkeeping reports

## Auth model

The scaffold is wired for a QuickBooks Online OAuth setup.

Expected environment variables:

- `QBO_CLIENT_ID`
- `QBO_CLIENT_SECRET`
- `QBO_REFRESH_TOKEN` or `QBO_ACCESS_TOKEN`
- `QBO_REALM_ID`
- `AOS_QUICKBOOKS_ACCOUNT` optional account alias
- `AOS_QUICKBOOKS_ENVIRONMENT` optional, default `sandbox`
- `AOS_QUICKBOOKS_API_BASE` optional, default `https://quickbooks.api.intuit.com`

## Install

```bash
cd tools/aos/aos-quickbooks/agent-harness
python3 -m pip install -e .
```

## Examples

```bash
aos-quickbooks --json capabilities
aos-quickbooks --json health
aos-quickbooks --json --mode readonly config show
```

Example stub commands:

```bash
aos-quickbooks --json --mode readonly company read
aos-quickbooks --json --mode readonly invoice list --status Open
aos-quickbooks --json --mode write invoice create --customer-id 123 --amount 99.95
```

Until the backend bridge is implemented, resource commands return `NOT_IMPLEMENTED` after permission checks.
