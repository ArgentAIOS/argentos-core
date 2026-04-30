# aos-close

Agent-native Close CRM connector with live reads, live low-risk CRM writes, and scaffolded outreach actions.

What is live now:

- `lead.list` and `lead.get` read lead scope.
- `lead.create` and `lead.update` perform live Close lead writes.
- `contact.list` and `contact.get` read contact scope, optionally filtered by lead.
- `contact.create` performs a live Close contact write.
- `opportunity.list` and `opportunity.get` read opportunity scope, with optional lead and status-type filters.
- `opportunity.create` performs a live Close opportunity write.
- `activity.list` reads activity scope; `activity.create` creates a live Close note activity.
- `task.list` reads task scope; `task.create` creates a live Close task.

What is still scaffolded:

- `email.send`, `sms.send`, and `call.create` return explicit scaffold responses and do not deliver outreach yet.

## Auth

The connector resolves `CLOSE_API_KEY` from operator-controlled API Keys first, then falls back to the environment only inside the local service-key helper.

Optional scope hints:

- `CLOSE_LEAD_ID` to preselect a lead scope.
- `CLOSE_CONTACT_ID` to preselect a contact scope.
- `CLOSE_OPPORTUNITY_ID` to preselect an opportunity scope.

## Live Reads

The harness uses the Close REST API for lead, contact, opportunity, activity, and task discovery. If the API key is present but the live backend rejects requests, `health` and `doctor` report the API failure instead of pretending the connector is ready.

## Writes

Live CRM writes are limited to records that are straightforward to create safely through the Close REST API: leads, contacts, opportunities, note activities, and tasks.

Outreach commands remain scaffolded on purpose. They still advertise their eventual surface area, but the runtime returns `scaffold_write_only` until delivery, consent, and audit safeguards exist for email, SMS, and calls.
