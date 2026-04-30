# Buffer agent harness

This harness provides the Buffer connector CLI for ArgentOS.

Live reads are implemented against Buffer's public GraphQL API for:

- account and organization discovery
- channel discovery and direct channel reads
- post discovery within accessible organizations

The `profile.*` commands are legacy aliases over the same live channel data.

Draft and schedule writes are intentionally absent until a live write bridge and
approval policy are implemented.

The harness resolves `BUFFER_API_KEY` or `BUFFER_ACCESS_TOKEN` from
operator-controlled service keys first. Optional service keys can pin
`BUFFER_BASE_URL`, `BUFFER_ORGANIZATION_ID`, `BUFFER_CHANNEL_ID`,
`BUFFER_PROFILE_ID`, and `BUFFER_POST_ID`. Local `BUFFER_*` environment
variables are harness fallback only; scoped repo service keys block env fallback.
Live write smoke is not claimed.
