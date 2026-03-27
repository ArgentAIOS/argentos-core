# aos-stripe

Agent-native Stripe connector for payments, billing, and subscription management.

## Actions

### Read (live)

- `balance.get` — account balance
- `customer.list` / `customer.get` — customer lookup
- `payment.list` / `payment.get` — payment intent lookup
- `subscription.list` / `subscription.get` — subscription lookup
- `invoice.list` / `invoice.get` — invoice lookup

### Write (mode=write)

- `customer.create` — create a customer
- `payment.create` — create a payment intent
- `subscription.create` / `subscription.cancel` — manage subscriptions
- `invoice.send` — send an invoice

## Auth

The connector expects a Stripe secret API key via `STRIPE_SECRET_KEY`.

Use test-mode keys (`sk_test_...`) during development to avoid live charges.

Optional scope hints:

- `STRIPE_CUSTOMER_ID` — preselect a customer scope
- `STRIPE_SUBSCRIPTION_ID` — preselect a subscription scope
- `STRIPE_PRICE_ID` — preselect a price for subscription creation

## Live Reads

The harness uses Stripe's REST API for balance, customer, payment intent, subscription, and invoice lookups. If the API key is present but the live backend rejects requests, `health` and `doctor` report the API failure.

## Writes

Write commands require `--mode write` and perform live Stripe mutations. Use test-mode keys during development.
