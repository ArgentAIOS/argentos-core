# Buffer agent harness

This harness provides the Buffer connector CLI for ArgentOS.

Live reads are implemented against Buffer's public GraphQL API for:

- account and organization discovery
- channel discovery and direct channel reads
- post discovery within accessible organizations

The `profile.*` commands are legacy aliases over the same live channel data.

Write commands stay permission-gated and preview-only:

- `post create-draft`
- `post schedule`

They do not execute social publishing mutations from the harness.
