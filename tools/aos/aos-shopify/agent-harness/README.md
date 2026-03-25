# aos-shopify agent harness

Python Click harness for the Shopify connector scaffold.

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

Required environment:

- `SHOPIFY_SHOP_DOMAIN`
- `SHOPIFY_ADMIN_ACCESS_TOKEN`

The harness is setup-oriented and truthful:

- `health` and `doctor` only report configuration readiness.
- All worker-visible commands are scaffold-only.
- No live Shopify writes are implemented yet.
