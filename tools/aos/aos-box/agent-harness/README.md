# aos-box agent harness

Python CLI harness for the `aos-box` connector.

This connector is a live read-only AOS connector. It exposes Box file/folder
listing, file/folder metadata lookup, file download, collaboration listing,
search, and metadata reads. It intentionally does not expose upload, copy, move,
folder creation, shared-link mutation, collaboration creation, or metadata writes
until a write bridge and approval policy are verified.

Operator-controlled service keys are resolved before local environment fallback:

- `BOX_ACCESS_TOKEN`
- `BOX_CLIENT_ID`
- `BOX_CLIENT_SECRET`
- `BOX_JWT_CONFIG`
- `BOX_FOLDER_ID`
- `BOX_FILE_ID`
- `BOX_QUERY`
