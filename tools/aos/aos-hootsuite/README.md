# aos-hootsuite

Agent-native Hootsuite connector for social scheduling and engagement operations.

This first pass gives ArgentOS a truthful Hootsuite surface for:

- connector setup and health
- authenticated member reads
- organization reads and lists
- social profile reads and lists
- team reads and lists
- outbound message reads and lists

Publish and schedule writes are intentionally not advertised until a live write bridge,
artifact handling, and approval safety rules are implemented.

Credentials and scope defaults resolve from operator-controlled service keys first.
`HOOTSUITE_ACCESS_TOKEN` is required for live reads; `HOOTSUITE_BASE_URL`,
`HOOTSUITE_ORGANIZATION_ID`, `HOOTSUITE_SOCIAL_PROFILE_ID`, `HOOTSUITE_TEAM_ID`,
and `HOOTSUITE_MESSAGE_ID` are optional operator-controlled defaults. Local
environment variables are harness-only fallback and scoped repo service keys are
not bypassed with env fallback. `live_write_smoke_tested` remains false until a
real operator Hootsuite tenant write smoke is run.
