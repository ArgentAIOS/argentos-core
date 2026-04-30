# aos-google-drive agent harness

Python CLI harness for the `aos-google-drive` connector.

This harness exposes live Google Drive read/export/search operations only:

- file listing and metadata reads
- folder listing
- permission listing
- PDF and DOCX exports
- Drive search

Write commands are intentionally absent until live Google Drive write workflows
and approval policy are implemented and verified.

The harness resolves required OAuth keys and optional linking/filter keys from
operator-controlled service keys first, then falls back to process env only for
local development.
