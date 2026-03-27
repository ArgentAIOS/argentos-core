# aos-canva

Agent-native Canva Connect API connector for design automation.

This connector exposes Canva's design, template, brand template, asset, folder, and export surfaces. The standout capability is **autofill** — populating brand template placeholders with agent-supplied data to produce ready-to-export designs without manual editing.

## Workflow Example

```
Agent writes social media copy
  → autofill.create fills brand template with copy + images
    → export.start renders to PNG
      → post to social channel
```

## Auth

The connector expects a Canva Connect API key via `CANVA_API_KEY`. Generate one at https://www.canva.com/developers/.

Required OAuth scopes:

- `design:content:read`, `design:content:write`, `design:meta:read`
- `asset:read`, `asset:write`
- `folder:read`, `folder:write`
- `brandtemplate:content:read`, `brandtemplate:meta:read`

Optional scope hints:

- `CANVA_FOLDER_ID` to scope design and asset listings to a specific folder.
- `CANVA_BRAND_TEMPLATE_ID` to preselect a brand template for autofill workflows.
- `CANVA_EXPORT_FORMAT` to default the export format (`png`, `jpg`, `pdf`, `svg`, `mp4`, `gif`).

## Read Commands

| Command               | Description                                  |
| --------------------- | -------------------------------------------- |
| `design.list`         | List designs (optionally scoped to a folder) |
| `design.get`          | Get a design by ID                           |
| `template.list`       | List available templates                     |
| `template.get`        | Get a template by ID                         |
| `brand_template.list` | List brand templates                         |
| `asset.list`          | List assets (optionally scoped to a folder)  |
| `folder.list`         | List folders                                 |
| `export.start`        | Start a design export job                    |
| `export.status`       | Check export job status                      |
| `export.download`     | Download an exported design                  |

## Write Commands

| Command                        | Description                                                 |
| ------------------------------ | ----------------------------------------------------------- |
| `design.create`                | Create a new design from a template                         |
| `design.clone`                 | Clone an existing design                                    |
| `brand_template.create_design` | Create a design from a brand template                       |
| `asset.upload`                 | Upload an asset to Canva                                    |
| `folder.create`                | Create a folder                                             |
| `autofill.create`              | Autofill a brand template with data and create a new design |

## Autofill

The `autofill.create` action is the primary automation surface. It accepts a brand template ID and a JSON object mapping placeholder names to values. Canva replaces text and image placeholders in the template, producing a new design ready for export.

```json
{
  "brand_template_id": "DAGxyz...",
  "autofill_data": {
    "headline": "Spring Sale — 30% Off",
    "body": "Limited time offer for all products",
    "hero_image": "https://example.com/hero.jpg"
  }
}
```

This enables fully automated content pipelines: copywriting agent produces text, autofill renders it into on-brand designs, export delivers print-ready or web-ready assets.
