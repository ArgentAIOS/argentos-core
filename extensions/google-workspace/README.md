# Google Workspace Admin Extension

> **Management-Level Extension** — Requires a Google service account with domain-wide delegation. Provides administrative access to email reports, user directory, and domain-wide reporting.

## Prerequisites

1. **Google Cloud Project** with the following APIs enabled:
   - Admin SDK API (`admin.googleapis.com`)

2. **Service Account** with domain-wide delegation:
   - Create in Google Cloud Console > IAM & Admin > Service Accounts
   - Download the JSON key file
   - Note the service account's Client ID

3. **Domain-Wide Delegation** authorized in Google Admin Console:
   - Go to Security > Access and data control > API controls > Manage Domain Wide Delegation
   - Add the service account Client ID with these scopes:
     ```
     https://www.googleapis.com/auth/admin.reports.usage.readonly
     https://www.googleapis.com/auth/admin.reports.audit.readonly
     https://www.googleapis.com/auth/admin.directory.user.readonly
     ```

4. **Super Admin Email** — The service account impersonates this user for API access.

## Configuration

Add to your ArgentOS config (`~/.argentos/argent.json`):

```json
{
  "extensions": {
    "google-workspace": {
      "serviceAccountKeyPath": "/path/to/service-account-key.json",
      "adminEmail": "admin@yourdomain.com",
      "domain": "yourdomain.com"
    }
  }
}
```

## Tool Reference

All actions are accessed through the `gworkspace` tool.

### `setup` — Test Connectivity

Verify auth is working and show config status.

```
gworkspace action=setup
```

### `user_email_stats` — Daily Email Counts

Daily sent/received/spam counts for a user over a date range.

```
gworkspace action=user_email_stats user=jason@domain.com start_date=2026-02-10 end_date=2026-02-15
```

Parameters:

- `user` (required) — Email address, or `"all"` for all users
- `start_date` — YYYY-MM-DD (default: 7 days ago minus 2-day lag)
- `end_date` — YYYY-MM-DD (default: 2 days ago)

### `email_activity` — Granular Gmail Events

Individual send/receive events with timestamps. Auto-chunks ranges longer than 30 days.

```
gworkspace action=email_activity user=jason@domain.com start_date=2026-02-01 end_date=2026-02-15 event_type=send
```

Parameters:

- `user` — Email address or omit for all users
- `start_date` / `end_date` — Date range
- `event_type` — Filter: `send`, `receive`, etc.
- `max_results` — Cap on returned events (default: 50)

### `user_lookup` — Single User Info

```
gworkspace action=user_lookup user=jason@domain.com
```

Returns: name, email, org unit, last login, suspended status, admin status, creation time.

### `user_list` — List/Search Users

```
gworkspace action=user_list org_unit=/Engineering query="name:Jason"
```

Parameters:

- `org_unit` — Filter by organizational unit path
- `query` — Directory API query string
- `max_results` — Cap on returned users (default: 50)

### `email_summary` — Management Overview

Org-wide email volume with top senders and receivers.

```
gworkspace action=email_summary start_date=2026-02-10 end_date=2026-02-15 top_n=5
```

Parameters:

- `start_date` / `end_date` — Date range
- `top_n` — Number of top senders/receivers (default: 10)

## Known Limitations

- **2-day report lag** — Google Reports API data is delayed by approximately 2 days. Queries for very recent dates will return no data; the tool handles this gracefully.
- **30-day activity window** — The Activities API supports a maximum 30-day window per request. The tool auto-chunks longer ranges into 30-day windows.
- **Rate limits** — Google Admin SDK has per-user and per-domain rate limits. The tool includes retry with exponential backoff (3 retries) but sustained high-volume queries may hit limits.
- **Read-only** — This extension only reads data. It cannot modify users, send emails, or change settings.
