# aos-resend

Agent-native Resend connector for transactional and batch email delivery.

## Capabilities

### Email Sending

- `email.send` sends a single email with inline HTML body.
- `email.batch_send` sends multiple emails in a single API call.

### Domains

- `domains.list` shows verified sending domains.
- `domains.verify` triggers DNS verification for a domain.

### Audiences & Contacts

- `audiences.list` and `audiences.create` manage audience groups.
- `contacts.list`, `contacts.create`, and `contacts.remove` manage contacts within audiences.

## Auth

The connector expects a Resend API key via `RESEND_API_KEY`.

Optional scope hints:

- `RESEND_FROM_EMAIL` to pin the default sender address.
- `RESEND_AUDIENCE_ID` to preselect an audience scope.
- `RESEND_DOMAIN_ID` to preselect a domain for verification.

## Live Reads

The harness uses the Resend REST API for domain, audience, and contact discovery. If the API key is present but the live backend rejects requests, `health` and `doctor` report the API failure instead of pretending the connector is ready.

## Writes

Write commands (`email.send`, `email.batch_send`, `domains.verify`, `audiences.create`, `contacts.create`, `contacts.remove`) perform live mutations when mode is `write` or higher.
