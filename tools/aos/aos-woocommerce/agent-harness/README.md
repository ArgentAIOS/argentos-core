# WooCommerce agent harness

This harness provides the WooCommerce connector CLI for ArgentOS.

## Auth

The harness resolves `WOO_STORE_URL`, `WOO_CONSUMER_KEY`,
`WOO_CONSUMER_SECRET`, and optional WooCommerce linking keys through
operator-controlled service keys first, then falls back to local process env
only in the service-key helper for development.

## Live Reads

Implemented today:

- orders via WooCommerce REST API v3
- products via WooCommerce REST API v3
- customers via WooCommerce REST API v3
- coupons via WooCommerce REST API v3
- sales and top sellers reports via WooCommerce REST API v3

## Writes

Write commands are intentionally absent until live WooCommerce write workflows
and approval policy are implemented and verified.
