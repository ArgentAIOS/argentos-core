# aos-lion-report

Agent-native LION Report / VaultLion connector — first-party reference implementation.

LION Report is an intelligence reporting platform. This connector provides full read and write access to reports, data sources, analyses, templates, and exports.

- `report.list`, `report.get`, `report.generate`, and `report.schedule` manage the report lifecycle.
- `data.list_sources`, `data.query`, and `data.import` manage data ingestion and querying.
- `analysis.run` and `analysis.list` trigger and browse data analyses.
- `template.list` and `template.get` browse report templates.
- `export.pdf`, `export.csv`, and `export.email` handle report distribution.

## Auth

The connector expects a LION Report API key via `LION_REPORT_API_KEY`.

Optional scope hints:

- `LION_REPORT_ID` to preselect a report scope.
- `LION_DATA_SOURCE` to default data source filters.
- `LION_TEMPLATE_ID` to preselect a report template.

## Live Reads + Writes

This is a first-party connector with full live read and write support. All commands hit the LION Report API directly. Report generation and analysis runs are async operations that return immediately with a job ID.
