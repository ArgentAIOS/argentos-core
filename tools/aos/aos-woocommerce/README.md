# aos-woocommerce

Agent-native WooCommerce REST connector for orders, products, customers, coupons, and reports.

Real today:

- connector setup and health
- order reads: `order.list`, `order.get`
- product reads: `product.list`, `product.get`
- customer reads: `customer.list`, `customer.get`
- coupon reads: `coupon.list`
- report reads: `report.sales`, `report.top_sellers`

Write surfaces are intentionally not advertised until live WooCommerce write
workflows and approval policy are implemented and verified.

## Auth

The connector resolves `WOO_STORE_URL`, `WOO_CONSUMER_KEY`,
`WOO_CONSUMER_SECRET`, and optional WooCommerce linking keys from
operator-controlled service keys first, then falls back to local process env
only inside the harness service-key helper for development.

## Backend

- Store URL: `https://example.com`
- API base: `{store_url}/wp-json/wc/v3`
- Auth: WooCommerce REST API consumer key + consumer secret via Basic auth

## References

- https://woocommerce.github.io/woocommerce-rest-api-docs/
- https://woocommerce.com/document/woocommerce-rest-api/
