# aos-stripe

Stripe connector scaffold for payments, billing, invoicing, and refund workflows.

## Shape

- `connector.json` manifest for the Stripe connector
- `agent-harness/` Click-based CLI harness
- `permissions.json` mode gate map
- Focused harness tests for capabilities, health, config, permission enforcement, and live read paths

## Runtime Expectations

The scaffold is wired for these environment variables:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_ACCOUNT_ID`

The harness now performs first-pass live Stripe reads for balance, customer, payment intent, and invoice lookups.

Write paths remain truthful stubs and return `NOT_IMPLEMENTED`.
