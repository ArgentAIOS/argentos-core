---
name: email-delivery
description: "Use the email_delivery core tool to test and send email through Resend, Mailgun, and SendGrid from core runtime."
---

# Email Delivery Skill

Use `email_delivery` for provider-based email sending.

Primary actions:

- `test_provider`
- `send_resend`
- `send_mailgun`
- `send_sendgrid`

Supported keys:

- `RESEND_API_KEY`
- `MAILGUN_API_KEY` (or `MAILGUN_TITANIUM_API_KEY`) and `MAILGUN_DOMAIN`
- `SENDGRID_API_KEY`
