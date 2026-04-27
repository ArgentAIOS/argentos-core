# aos-klaviyo

Agent-native Klaviyo connector for live Klaviyo reads.

This connector is currently live-read-only:

- `account.read` confirms the connected Klaviyo account.
- `list.list` and `list.read` expose list scope for audience pickers.
- `profile.list` and `profile.read` expose profile scope for member pickers.
- `campaign.list` and `campaign.read` expose campaign scope for worker-flow pickers.
- no Klaviyo write commands are exposed yet.

## Auth

The connector expects operator-controlled service keys first. For local harness
runs, the service-key helper can fall back to matching environment variables.

Operator service keys:

- `KLAVIYO_API_KEY`
- `KLAVIYO_REVISION`
- `KLAVIYO_LIST_ID`
- `KLAVIYO_PROFILE_ID`
- `KLAVIYO_PROFILE_EMAIL`
- `KLAVIYO_CAMPAIGN_ID`

## Live Reads

The harness uses Klaviyo's read endpoints for account, list, profile, and campaign discovery. If the API key is present but the live backend rejects requests, `health` and `doctor` report the API failure instead of pretending the connector is ready.

## Writes

Write commands are intentionally not exposed yet. This connector should be treated as a truthful live-read-only surface until Klaviyo mutation safeguards and approvals are added.
