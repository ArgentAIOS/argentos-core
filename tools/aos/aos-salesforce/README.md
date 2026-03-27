# aos-salesforce

Agent-native Salesforce CRM connector.

This connector supports live reads and live writes:

- `lead.list` and `lead.get` expose lead scope for pipeline pickers.
- `lead.create` and `lead.update` execute live lead mutations.
- `contact.list` and `contact.get` expose contact scope for record pickers.
- `contact.create` executes live contact creation.
- `opportunity.list` and `opportunity.get` expose opportunity scope for deal pickers.
- `opportunity.create` and `opportunity.update` execute live opportunity mutations.
- `account.list` and `account.get` expose account scope for organization pickers.
- `task.list` lists tasks; `task.create` executes a live task mutation.
- `report.run` executes a Salesforce report by ID.
- `search.soql` executes arbitrary SOQL queries for flexible data access.

## Auth

The connector expects a Salesforce access token via `SALESFORCE_ACCESS_TOKEN` and the instance URL via `SALESFORCE_INSTANCE_URL`.

Optional scope hints:

- `SALESFORCE_RECORD_ID` to preselect a record scope.
- `SALESFORCE_REPORT_ID` to preselect a report scope.

## Live Reads

The harness uses the Salesforce REST API for lead, contact, opportunity, account, task, report, and SOQL query discovery. If the access token is present but the live backend rejects requests, `health` and `doctor` report the API failure instead of pretending the connector is ready.

## Writes

Write commands execute live Salesforce mutations with the configured access token.
