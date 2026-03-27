# aos-sendgrid

Agent-native SendGrid connector for transactional and marketing email delivery.

## Capabilities

### Email Sending

- `email.send` sends a transactional email with inline HTML body.
- `email.send_template` sends an email using a SendGrid dynamic template.

### Contacts & Lists

- `contacts.list`, `contacts.search`, and `contacts.add` manage marketing contacts.
- `lists.list`, `lists.create`, and `lists.add_contacts` manage contact lists.

### Templates

- `templates.list` and `templates.get` browse dynamic templates for template-based sends.

### Stats

- `stats.global` and `stats.category` retrieve delivery, open, and click metrics.

## Auth

The connector expects a SendGrid API key via `SENDGRID_API_KEY`.

Optional scope hints:

- `SENDGRID_FROM_EMAIL` to pin the default sender address.
- `SENDGRID_TEMPLATE_ID` to preselect a dynamic template.
- `SENDGRID_LIST_ID` to preselect a contact list.

## Live Reads

The harness uses the SendGrid v3 API for contact, list, template, and stats discovery. If the API key is present but the live backend rejects requests, `health` and `doctor` report the API failure instead of pretending the connector is ready.

## Writes

Write commands (`email.send`, `email.send_template`, `contacts.add`, `lists.create`, `lists.add_contacts`) perform live mutations when mode is `write` or higher. The `email.send` and `email.send_template` commands call the SendGrid Mail Send endpoint directly.
