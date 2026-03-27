# aos-calendly

Agent-native Calendly connector for scheduling, event management, and availability.

## Actions

### Read (live)

- `events.list` / `events.get` — scheduled event lookup
- `event_types.list` / `event_types.get` — event type discovery
- `invitees.list` — invitee lookup for a specific event
- `availability.get` — availability windows for an event type

### Write (mode=write)

- `events.cancel` — cancel a scheduled event
- `scheduling_links.create` — create a single-use booking link

## Auth

The connector expects a Calendly personal access token via `CALENDLY_API_KEY`.

Generate one from Calendly Settings > Integrations > API & Webhooks.

Optional scope hints:

- `CALENDLY_EVENT_TYPE_UUID` — preselect an event type scope
- `CALENDLY_EVENT_UUID` — preselect an event scope

## Live Reads

The harness uses Calendly's v2 REST API. The connector auto-discovers your user URI on first probe via `/users/me`. If the API key is present but the live backend rejects requests, `health` and `doctor` report the API failure.

## Writes

Write commands (events.cancel, scheduling_links.create) require `--mode write`. Cancellation is permanent and cannot be undone.
