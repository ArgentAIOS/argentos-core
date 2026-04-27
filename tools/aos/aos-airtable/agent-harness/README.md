# aos-airtable agent harness

Python Click wrapper for the `aos-airtable` connector.

The harness resolves Airtable credentials from operator-controlled service keys
before falling back to local environment variables. It supports live reads and
permission-gated record create/update writes through Airtable's REST API.
`AIRTABLE_API_TOKEN` and `AIRTABLE_BASE_ID` are required; table, workspace, and
API base URL are optional defaults. Scoped repo service keys block env fallback,
including legacy `AOS_AIRTABLE_*` aliases. Live write smoke is not claimed.
