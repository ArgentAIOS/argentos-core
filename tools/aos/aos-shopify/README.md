# aos-shopify

`aos-shopify` is a setup-first Shopify connector scaffold for store operations.

- Backend: `shopify-admin`
- Interface: stable `aos-*` contract
- Status: configuration and diagnostics are truthful; worker-visible commands are scaffold-only
- Writes: not implemented yet

## Runtime Surface

Implemented surfaces:

- `capabilities`
- `health`
- `config show`
- `doctor`

Worker-visible commands are present for:

- `shop.read`
- `product.list`
- `product.read`
- `product.update`
- `order.list`
- `order.read`
- `order.cancel`
- `customer.list`
- `customer.read`
- `fulfillment.create`

Every command returns a structured scaffold response until a live Shopify bridge is added.

## Auth

Required service keys:

- `SHOPIFY_SHOP_DOMAIN`
- `SHOPIFY_ADMIN_ACCESS_TOKEN`

Interactive setup:

1. Create a Shopify custom app for the target store.
2. Add `SHOPIFY_SHOP_DOMAIN` and `SHOPIFY_ADMIN_ACCESS_TOKEN` in API Keys.
3. Grant read scopes for products, orders, and customers before assigning the connector to workers.
4. Keep write scopes disabled until mutation support is implemented and reviewed.

## Install

```bash
cd aos-shopify/agent-harness
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
aos-shopify --json capabilities
aos-shopify --json health
aos-shopify --json config show
aos-shopify --json doctor
```

## Notes

- `health` reports setup readiness only; it does not claim live Shopify API execution.
- `doctor` summarizes missing keys and confirms the connector is scaffold-only.
- All worker-visible commands are intentionally stubbed and do not perform live writes.
