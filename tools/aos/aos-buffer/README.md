# aos-buffer

Buffer connector for ArgentOS.

This connector now treats Buffer's current public GraphQL API as the live contract for:

- account metadata and organization discovery
- channel discovery and direct channel reads
- post discovery within accessible organizations

The `profile.*` commands are retained as legacy aliases over the same channel data so existing workers can keep using a Buffer "profile" mental model while the live backend stays truthful to Buffer's current terminology.

Draft and schedule writes are intentionally not advertised until a live write bridge
and approval policy are implemented.

Credentials resolve from operator-controlled service keys first. `BUFFER_API_KEY`
or `BUFFER_ACCESS_TOKEN` is required for live reads; `BUFFER_BASE_URL`,
`BUFFER_ORGANIZATION_ID`, `BUFFER_CHANNEL_ID`, `BUFFER_PROFILE_ID`, and
`BUFFER_POST_ID` are optional operator-controlled defaults. Local environment
variables are harness-only fallback and scoped repo service keys are not bypassed
with env fallback. `live_write_smoke_tested` remains false until a real operator
Buffer tenant write smoke is run.

Docs used for this connector:

- https://developers.buffer.com/guides/introduction.html
- https://developers.buffer.com/guides/rest-migration.html
