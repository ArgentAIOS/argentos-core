# aos-discord-workflow agent harness

Python CLI harness for the `aos-discord-workflow` connector.

The harness resolves operator-controlled service keys for Discord bot auth,
webhook auth, and stable scope IDs before falling back to local environment
variables. Bot-backed commands stay permission-gated, and `webhook.send` is the
only write path that can run without a bot token.

Scoped repo service keys block local environment fallback because the operator
runtime must inject them. `live_write_smoke_tested=false` until a real operator
Discord guild or webhook smoke test verifies writes.
