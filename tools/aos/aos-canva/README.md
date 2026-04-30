# aos-canva

Agent-native Canva Connect API connector for design metadata, asset uploads,
folder operations, brand-template autofill, and export jobs.

This lane is a real AOS connector for the Canva Connect REST API, but it is not
a generic Canva "template marketplace" wrapper and it does not advertise a fake
clone endpoint. The live surfaces are the ones backed by documented Connect API
endpoints.

## Auth

The connector expects a Canva user access token, resolved from operator-managed
service keys first and local process env second:

- primary: `CANVA_ACCESS_TOKEN`
- legacy fallback: `CANVA_API_KEY`

Canva Connect uses OAuth 2.0 to obtain user access tokens. The harness sends
the resolved value as a Bearer token.

Useful optional defaults:

- `CANVA_FOLDER_ID`
- `CANVA_DESIGN_ID`
- `CANVA_BRAND_TEMPLATE_ID`
- `CANVA_EXPORT_FORMAT`
- `CANVA_EXPORT_JOB_ID`
- `CANVA_ASSET_FILE`
- `CANVA_ASSET_URL`
- `CANVA_ASSET_NAME`
- `CANVA_AUTOFILL_DATA`

## Live read commands

| Command               | Notes                                                                           |
| --------------------- | ------------------------------------------------------------------------------- |
| `design.list`         | Lists designs, optionally scoped through `CANVA_FOLDER_ID` via folder contents. |
| `design.get`          | Gets design metadata by ID.                                                     |
| `brand_template.list` | Lists enterprise brand templates the token can access.                          |
| `brand_template.get`  | Gets brand template metadata by ID.                                             |
| `asset.list`          | Lists image assets in a folder.                                                 |
| `folder.list`         | Lists folder contents.                                                          |
| `folder.get`          | Gets folder metadata by ID.                                                     |
| `export.status`       | Gets export job status.                                                         |
| `export.download`     | Returns the finished export job URLs.                                           |

## Live write commands

| Command                        | Notes                                                                 |
| ------------------------------ | --------------------------------------------------------------------- |
| `design.create`                | Creates a new blank Canva design using a preset design type.          |
| `brand_template.create_design` | Starts a brand-template autofill job and returns the job payload.     |
| `asset.upload`                 | Starts a file or URL asset upload job.                                |
| `folder.create`                | Creates a folder under `root` or the configured parent folder.        |
| `export.start`                 | Starts an export job for a design.                                    |
| `autofill.create`              | Starts an autofill job directly from a brand template plus JSON data. |

## Removed false advertising

- No generic `template.list` or `template.get` commands are exposed. Canva
  Connect documents brand templates, not a generic template catalog endpoint.
- No `design.clone` command is exposed. The harness does not pretend Canva has
  a true clone endpoint for this lane.

## Autofill

`autofill.create` is the primary automation surface. It accepts a brand
template ID and JSON data that maps template dataset keys to values, then
starts Canva's asynchronous autofill job flow.
