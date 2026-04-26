# aos-hootsuite agent harness

Python Click wrapper for the `aos-hootsuite` connector.

The harness exposes live read commands for authenticated member, organization,
social profile, team, and outbound message discovery, while keeping
`message.schedule` scaffolded until a live publish bridge exists.

Credential resolution prefers operator-controlled service keys for
`HOOTSUITE_ACCESS_TOKEN`, with local environment variables used only as a
harness fallback.
