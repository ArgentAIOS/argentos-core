# aos-airtable agent harness

Python Click wrapper for the `aos-airtable` connector.

The harness resolves Airtable credentials from operator-controlled service keys
before falling back to local environment variables. It supports live reads and
permission-gated record create/update writes through Airtable's REST API.
