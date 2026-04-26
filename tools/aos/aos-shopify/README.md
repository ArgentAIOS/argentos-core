# aos-shopify

`aos-shopify` is a Shopify Admin connector for store operations.

- Backend: `shopify-admin`
- Interface: stable `aos-*` contract
- Status: live reads plus conservative Admin API mutations
- Writes: limited but implemented

## Runtime Surface

Implemented surfaces:

- `capabilities`
- `health`
- `config show`
- `doctor`

Implemented worker-visible commands:

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

Read commands execute against the live Shopify Admin REST API. The write commands below also execute live with narrow payloads:

- `product.update`: updates only `title` and/or `status`
- `order.cancel`: conservative cancel only, with optional Shopify cancel reason
- `fulfillment.create`: creates a fulfillment only when the order resolves to exactly one eligible fulfillment order

## Auth

Required service keys:

- `SHOPIFY_SHOP_DOMAIN`
- `SHOPIFY_ADMIN_ACCESS_TOKEN`

Operator-controlled `auth.service_keys` are resolved first. Local process environment variables are only a fallback.

Interactive setup:

1. Create a Shopify custom app for the target store.
2. Add `SHOPIFY_SHOP_DOMAIN` and `SHOPIFY_ADMIN_ACCESS_TOKEN` in connector service keys.
3. Grant the Shopify Admin read scopes needed for products, orders, and customers.
4. Grant the corresponding Shopify Admin write scopes before using `product.update`, `order.cancel`, or `fulfillment.create`.

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

- `health` uses a live shop probe; it does not prove write scopes.
- `doctor` reports supported live reads and writes, but write calls can still fail if the store app lacks the needed Shopify scopes.
- `product.update` intentionally limits mutations to `title` and `status`.
- `order.cancel` intentionally sends a conservative cancel payload and does not orchestrate refund payloads.
- `fulfillment.create` intentionally refuses ambiguous orders with multiple eligible fulfillment orders instead of guessing.
