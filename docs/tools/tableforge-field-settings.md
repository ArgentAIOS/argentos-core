---
summary: "Live TableForge field settings in the AppForge desktop."
read_when:
  - Working on AppForge or TableForge structured table fields
  - Debugging AppForge field edit persistence
  - Explaining which field settings are live versus planned
title: "TableForge Field Settings"
---

# TableForge Field Settings

TableForge field settings are edited from the AppForge desktop field inspector.
This surface is live for structured table metadata, but it is not yet the full
Airtable-class field system.

## Live in Core

- Field labels save through the structured base path.
- Field descriptions save through the structured base path.
- Supported default values save for text-like, number, date, checkbox, and
  select fields.
- Single-select and multi-select fields store rich select options with stable
  `id`, `label`, and `color` values.
- Legacy `options: string[]` labels stay synchronized with rich select options
  until all consumers move to `selectOptions`.
- Field type changes require an explicit apply action when the selected type
  differs from the stored type.

## Metadata-Only or Planned

- `required` is live metadata only. Record validation enforcement is planned.
- Attachment defaults are planned with the future asset storage slice.
- Linked-record defaults are planned with the future relationship storage slice.
- Type conversion is coercive once confirmed. This slice adds warning and
  confirmation, not a reversible conversion preview.

## Save Behavior

AppForge attempts to mirror structured table changes into the gateway-backed
AppForge store when a gateway connection is present. Metadata fallback remains
available for legacy AppForge apps and degraded/offline states.

The browser save path uses same-origin `/api/apps/:id/appforge-metadata` before
falling back to direct dashboard API XHR. Workflow event emission is best-effort
after persistence and must not turn a successful save into a red save failure.

For metadata-only bases, gateway seed writes must not send
`expectedRevision: 0`. A metadata-only base does not know the durable store
revision, and claiming revision `0` can cause a real conflict when the durable
mirror is already at revision `1` or later. Gateway-loaded bases still keep
revision preconditions.

## Smoke Expectations

A valid field settings smoke should prove:

- The field label changes in the grid header.
- The save state reaches `Saved` without a red timeout or stale-revision error.
- A reload/reopen still shows the changed field label.
- `appforge.bases.list` returns the changed field through the gateway read
  contract when the gateway is connected.
- Selecting a different field type shows a conversion warning and Apply/Cancel
  controls before any conversion is committed.
