# AOS VIP Email

`aos-vip-email` is a read-only alert scanner surface for Google Workspace/Gmail VIP sender monitoring.

Required operator configuration:

- `GOOGLE_WORKSPACE_ACCOUNT`
- `VIP_EMAIL_SENDERS`

Optional operator configuration:

- `VIP_EMAIL_ACCOUNTS`
- `VIP_EMAIL_SCAN_CADENCE_SECONDS`
- `VIP_EMAIL_LOOKBACK_DAYS`
- `VIP_EMAIL_MAX_RESULTS`
- `VIP_EMAIL_DEDUPE_WINDOW_SECONDS`
- `VIP_EMAIL_QUIET_HOURS`
- `VIP_EMAIL_ALERT_DESTINATIONS`

The connector emits structured alert candidates. It does not schedule itself; Workflows owns timers and delivery.
