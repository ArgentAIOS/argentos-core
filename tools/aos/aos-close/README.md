# aos-close

Agent-native Close CRM connector scaffold.

This first pass is live-read-first and keeps mutations scaffolded:

- `lead.list` and `lead.get` expose lead scope for pipeline pickers.
- `lead.create` and `lead.update` are scaffolded write paths only.
- `contact.list` and `contact.get` expose contact scope for record pickers.
- `contact.create` is a scaffolded write path only.
- `opportunity.list` and `opportunity.get` expose opportunity scope for deal pickers.
- `opportunity.create` is a scaffolded write path only.
- `activity.list` lists activities; `activity.create` is a scaffolded write path.
- `task.list` lists tasks; `task.create` is a scaffolded write path.
- `email.send`, `sms.send`, and `call.create` are scaffolded outreach write paths only.

## Auth

The connector expects a Close API key via `CLOSE_API_KEY`.

Optional scope hints:

- `CLOSE_LEAD_ID` to preselect a lead scope.
- `CLOSE_CONTACT_ID` to preselect a contact scope.

## Live Reads

The harness uses the Close REST API for lead, contact, opportunity, activity, and task discovery. If the API key is present but the live backend rejects requests, `health` and `doctor` report the API failure instead of pretending the connector is ready.

## Writes

Write commands are intentionally scaffolded and do not perform live mutations yet. They exist so the connector contract is complete and worker flows can see the eventual mutation surface. Outreach commands (email.send, sms.send, call.create) require additional approval gates before going live.
