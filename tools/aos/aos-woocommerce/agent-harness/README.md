# WooCommerce agent harness

This harness provides the WooCommerce connector CLI for ArgentOS.

## Auth

The harness resolves `WOO_STORE_URL`, `WOO_CONSUMER_KEY`, and
`WOO_CONSUMER_SECRET` through operator-controlled service keys first, then
falls back to local process env only in the service-key helper for development.

## Live Reads

Implemented today:

- orders via WooCommerce REST API v3
- products via WooCommerce REST API v3
- customers via WooCommerce REST API v3
- coupons via WooCommerce REST API v3
- sales and top sellers reports via WooCommerce REST API v3

## Scaffolded Writes

These commands are scaffold-only and return `scaffold_write_only`:

- `order create`
- `order update`
- `product create`
- `product update`
- `customer create`
- `coupon create`

Run them with `--mode write` when testing AOS write-path wiring, but they do
not perform live WooCommerce mutations yet.
