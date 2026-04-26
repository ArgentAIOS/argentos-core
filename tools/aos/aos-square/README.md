# aos-square

Square AOS connector for ArgentOS.

Live read surfaces are implemented against Square REST API v2 for:

- payments (`payment.list`, `payment.get`)
- customers (`customer.list`, `customer.get`)
- orders (`order.list`, `order.get`)
- catalog items (`item.list`, `item.get`)
- invoices (`invoice.list`)
- locations (`location.list`)

Scaffold-only write surfaces remain explicit and non-live for:

- payments (`payment.create`)
- customers (`customer.create`, `customer.update`)
- orders (`order.create`)
- catalog items (`item.create`)
- invoices (`invoice.create`, `invoice.send`)

Credential resolution uses ArgentOS operator-controlled service keys first for `SQUARE_ACCESS_TOKEN`, with local `process.env` as a development fallback only.

Docs used for this scaffold:

- https://developer.squareup.com/reference/square
- https://developer.squareup.com/docs/payments-api/overview
- https://developer.squareup.com/docs/customers-api/what-it-does
- https://developer.squareup.com/docs/orders-api/what-it-does
- https://developer.squareup.com/docs/catalog-api/what-it-does
- https://developer.squareup.com/docs/invoices-api/overview
