# aos-shopify agent harness

Python Click harness for the Shopify Admin connector.

## Install

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
aos-shopify --json capabilities
aos-shopify --json health
aos-shopify --json config show
aos-shopify --json doctor
```

## Runtime

Required service keys:

- `SHOPIFY_SHOP_DOMAIN`
- `SHOPIFY_ADMIN_ACCESS_TOKEN`

Operator-controlled service keys are resolved first. Process env is only a fallback.

The harness is setup-oriented and truthful:

- `health` and `doctor` report live probe readiness and supported command surfaces.
- Read commands execute live against the Shopify Admin REST API.
- `product.update` only mutates `title` and `status`.
- `order.cancel` only performs conservative cancellations.
- `fulfillment.create` only executes when exactly one fulfillment order is eligible.
