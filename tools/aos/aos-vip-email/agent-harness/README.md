# AOS VIP Email Connector Harness

Read-only AOS connector that scans Gmail through the configured Google Workspace CLI and emits structured `operator.alert.candidate` events for VIP sender messages.

Workflows owns scheduling, Run Now, retries, dedupe handoff, reminder semantics, and delivery. This harness does not recreate the legacy `vip_email` cron path.
