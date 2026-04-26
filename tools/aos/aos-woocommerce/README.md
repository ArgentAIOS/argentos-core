# aos-woocommerce

Agent-native WooCommerce REST connector for orders, products, customers, coupons, and reports.

Real today:

- connector setup and health
- order reads: `order.list`, `order.get`
- product reads: `product.list`, `product.get`
- customer reads: `customer.list`, `customer.get`
- coupon reads: `coupon.list`
- report reads: `report.sales`, `report.top_sellers`

Still scaffolded:

- `order.create`
- `order.update`
- `product.create`
- `product.update`
- `customer.create`
- `coupon.create`

Those write commands are intentionally present as AOS placeholders and return
`scaffold_write_only` instead of performing live WooCommerce mutations.

## Auth

The connector resolves `WOO_STORE_URL`, `WOO_CONSUMER_KEY`, and
`WOO_CONSUMER_SECRET` from operator-controlled service keys first, then falls
back to local process env only inside the harness service-key helper for
development.

## Backend

- Store URL: `https://example.com`
- API base: `{store_url}/wp-json/wc/v3`
- Auth: WooCommerce REST API consumer key + consumer secret via Basic auth

## References

- https://woocommerce.github.io/woocommerce-rest-api-docs/
- https://woocommerce.com/document/woocommerce-rest-api/
