# aos-klaviyo

Agent-native Klaviyo connector scaffold.

This first pass is live-read-first and keeps mutations scaffolded:

- `account.read` confirms the connected Klaviyo account.
- `list.list` and `list.read` expose list scope for audience pickers.
- `profile.list` and `profile.read` expose profile scope for member pickers.
- `campaign.list` and `campaign.read` expose campaign scope for worker-flow pickers.
- `campaign.create` and `profile.upsert` are scaffolded write paths only.

## Auth

The connector expects a private Klaviyo API key via `KLAVIYO_API_KEY`.

Optional scope hints:

- `KLAVIYO_REVISION` to pin the API revision header.
- `KLAVIYO_LIST_ID` to preselect a list scope.
- `KLAVIYO_PROFILE_ID` or `KLAVIYO_PROFILE_EMAIL` to preselect a profile scope.
- `KLAVIYO_CAMPAIGN_ID` to preselect a campaign scope.

## Live Reads

The harness uses Klaviyo's read endpoints for account, list, profile, and campaign discovery. If the API key is present but the live backend rejects requests, `health` and `doctor` report the API failure instead of pretending the connector is ready.

## Writes

Write commands are intentionally scaffolded and do not perform live mutations yet. They exist so the connector contract is complete and worker flows can see the eventual mutation surface.
