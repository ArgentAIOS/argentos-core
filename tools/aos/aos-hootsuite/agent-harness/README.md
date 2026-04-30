# aos-hootsuite agent harness

Python Click wrapper for the `aos-hootsuite` connector.

The harness exposes live read commands for authenticated member, organization,
social profile, team, and outbound message discovery. Publish and schedule writes
are intentionally absent until a live publish bridge exists.

The harness resolves `HOOTSUITE_ACCESS_TOKEN` from operator-controlled service
keys first. Optional service keys can pin `HOOTSUITE_BASE_URL`,
`HOOTSUITE_ORGANIZATION_ID`, `HOOTSUITE_SOCIAL_PROFILE_ID`, `HOOTSUITE_TEAM_ID`,
and `HOOTSUITE_MESSAGE_ID`. Local `HOOTSUITE_*` environment variables are
harness fallback only; scoped repo service keys block env fallback. Live write
smoke is not claimed.
