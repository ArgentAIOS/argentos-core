# Stripe Agent Harness

This directory contains the Click CLI scaffold for `aos-stripe`.

## Commands

- `capabilities`
- `health`
- `doctor`
- `config show`
- `account.read`
- `balance.read`
- `customer.list`
- `customer.search`
- `customer.read`
- `payment.list`
- `payment.read`
- `invoice.list`
- `invoice.read`
- `invoice.create_draft`
- `refund.create`

Read commands are wired to the live Stripe API. Write commands are truthful stubs and return `NOT_IMPLEMENTED`.

## Development

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .[dev]
pytest -q
```
