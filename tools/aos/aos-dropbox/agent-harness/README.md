# aos-dropbox agent harness

Python CLI harness for the `aos-dropbox` connector.

This connector is a live read-only AOS connector. It exposes Dropbox file/folder
metadata listing, file metadata lookup, file content download, shared-link
listing, and search. It intentionally does not expose upload, delete, move,
folder creation, or shared-link creation until a write bridge and approval policy
are verified.

Operator-controlled service keys are resolved before local environment fallback:

- `DROPBOX_APP_KEY`
- `DROPBOX_APP_SECRET`
- `DROPBOX_REFRESH_TOKEN`
- `DROPBOX_PATH`
- `DROPBOX_FILE_ID`
- `DROPBOX_QUERY`
- `DROPBOX_CURSOR`
- `DROPBOX_LIMIT`
- `DROPBOX_BASE_URL`
- `DROPBOX_CONTENT_URL`
