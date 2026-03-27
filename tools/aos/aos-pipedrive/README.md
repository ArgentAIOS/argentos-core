# aos-pipedrive

Agent-native Pipedrive CRM connector.

This connector supports live reads and live writes:

- `deal.list` and `deal.get` expose deal scope for pipeline pickers.
- `deal.create` and `deal.update` execute live deal mutations.
- `person.list` and `person.get` expose person scope for contact pickers.
- `person.create` executes live person creation.
- `organization.list` and `organization.get` expose organization scope for company pickers.
- `organization.create` executes live organization creation.
- `activity.list` lists activities; `activity.create` executes live activity creation.
- `pipeline.list` exposes pipelines for deal routing.
- `stage.list` exposes stages within a pipeline.
- `note.create` executes live note creation.

## Auth

The connector expects a Pipedrive API token via `PIPEDRIVE_API_TOKEN`.

Optional scope hints:

- `PIPEDRIVE_COMPANY_DOMAIN` to override the default API domain.
- `PIPEDRIVE_DEAL_ID` to preselect a deal scope.
- `PIPEDRIVE_PERSON_ID` to preselect a person scope.
- `PIPEDRIVE_ORG_ID` to preselect an organization scope.
- `PIPEDRIVE_PIPELINE_ID` to preselect a pipeline scope.

## Live Reads

The harness uses the Pipedrive REST API for deal, person, organization, activity, pipeline, and stage discovery. If the API token is present but the live backend rejects requests, `health` and `doctor` report the API failure instead of pretending the connector is ready.

## Writes

Write commands execute live Pipedrive mutations with the configured API token.
