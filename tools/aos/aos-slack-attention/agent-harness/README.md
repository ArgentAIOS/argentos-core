# AOS Slack Attention Connector Harness

Read-only AOS connector that scans configured Slack channels for direct attention signals and emits structured `operator.alert.candidate` events.

Workflows owns scheduling, Run Now, retries, dedupe handoff, reminder semantics, and delivery.
