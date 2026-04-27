# Square agent harness

This harness provides the Square connector CLI for ArgentOS.

The harness resolves `SQUARE_ACCESS_TOKEN` from operator-controlled service keys
first, then falls back to local process environment variables for development.

Live reads are implemented for:

- payments via Square Payments API
- customers via Square Customers API
- orders via Square Orders API
- catalog items via Square Catalog API
- invoices via Square Invoices API
- locations via Square Locations API

Write surfaces are intentionally absent until live Square write workflows and
approval policy are implemented.
