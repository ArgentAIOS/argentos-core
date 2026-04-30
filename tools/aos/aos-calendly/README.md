# aos-calendly

Agent-native Calendly connector for scheduling, event management, and availability.

## Actions

### Read (live)

- `events.list` / `events.get` — scheduled event lookup
- `event_types.list` / `event_types.get` — event type discovery
- `invitees.list` — invitee lookup for a specific event
- `availability.get` — availability windows for an event type

### Write (mode=write)

- `events.cancel` — live cancel of a scheduled event
- `scheduling_links.create` — scaffold-only preview of single-use booking-link creation inputs

## Auth

The connector expects a Calendly personal access token via `CALENDLY_API_KEY`.

Auth resolution order:

1. Operator-controlled service key `CALENDLY_API_KEY`
2. Environment variable fallback inside the connector's service-key helper

Generate one from Calendly Settings > Integrations > API & Webhooks.

Optional scope hints from plain environment variables:

- `CALENDLY_EVENT_TYPE_UUID` — preselect an event type scope
- `CALENDLY_EVENT_UUID` — preselect an event scope

## Live Reads

The harness uses Calendly's v2 REST API. The connector auto-discovers your user URI on first probe via `/users/me`. If the API key is present but the live backend rejects requests, `health` and `doctor` report the API failure.

## Writes

`events.cancel` executes a live `POST /scheduled_events/{uuid}/cancellation` request when `--mode write` is supplied. Cancellation is permanent and cannot be undone.

`scheduling_links.create` is still scaffolded. It returns a truthful preview payload instead of attempting a live write until the request/response contract is verified end-to-end in this harness.
