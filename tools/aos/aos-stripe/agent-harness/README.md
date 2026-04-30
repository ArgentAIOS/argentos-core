# Stripe Agent Harness

This directory contains the Click CLI harness for `aos-stripe`.

## Commands

- `capabilities`
- `health`
- `doctor`
- `config show`
- `balance.get` (`balance.read` remains as a compatibility alias)
- `customer.list`
- `customer.get`
- `customer.create`
- `payment.list`
- `payment.get`
- `payment.create`
- `subscription.list`
- `subscription.get`
- `subscription.create`
- `subscription.cancel`
- `invoice.list`
- `invoice.get`
- `invoice.send`

Read commands and permission-gated write commands are wired to the live Stripe API. Compatibility aliases remain for older read command names used by existing tests and operators.

## Development

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .[dev]
pytest -q
```
