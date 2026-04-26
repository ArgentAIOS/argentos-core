---
summary: "Owner-operator workflow scenarios, import/export contract, and current product gaps"
title: "Owner-Operator Scenarios"
---

# Owner-Operator Workflow Scenarios

ArgentOS Workflows should feel like a lighter, AI-native n8n: the operator can import a workflow
package, inspect the graph, bind credentials/resources, test with pinned data, then move it live with
approval gates around outbound delivery and external mutations.

## Current Gaps

- **Workflow identity**: name, description, status, tags, version, last-run summary, and owner intent must
  be first-class, not implied by loose canvas nodes.
- **Node contracts**: every primitive needs declared inputs, outputs, credentials, side-effect level,
  test behavior, error behavior, and preview behavior.
- **Output configuration**: output nodes must specify source data, formatting, destination, approval
  posture, and delivery/store semantics. A title alone is not meaningful.
- **Resource pickers**: users should pick agents, knowledge bases, AppForge bases/tables, channels, and
  credentials by name. They should not type IDs.
- **Connector truth**: output/action choices must come from configured channel and connector manifests.
  Read-only connectors should not appear as write destinations.
- **Run tooling**: manual run, test run, test to this node, pinned data, retry from failed node, cancel,
  and per-node input/output inspection need to be productized.
- **Approvals**: outbound email, social posting, connector writes, scripts, and external mutations need
  durable approval records, notifications, timeout policy, and audit history.
- **Import/export**: import should accept canonical JSON/YAML packages, validate them, show missing
  dependencies, and render the canvas. Raw React Flow state is not the workflow format.

## Canonical Package Shape

Workflow packages use executable workflow JSON/YAML first, with canvas layout as a view concern:

```yaml
kind: argent.workflow.package
schemaVersion: 1
name: Daily Marketing Brief
workflow:
  id: wf-daily-marketing-brief
  nodes: []
  edges: []
canvasLayout:
  nodes: []
  edges: []
credentials:
  required:
    - id: resend.primary
      provider: resend
      purpose: Email draft creation
dependencies:
  - kind: appforge_base
    id: marketing-ops
testFixtures:
  triggerPayload: {}
  pinnedOutputs:
    summarize:
      items:
        - text: Fixture summary
          json: {}
```

Pinned data is for manual/test execution only. Live runs ignore fixtures and require real credentials,
channels, AppForge bases, connector actions, and approval policy.

## Scenario Library

The initial library includes 20 owner-operator workflows:

| Workflow                 | Pattern               | Business Use                                         |
| ------------------------ | --------------------- | ---------------------------------------------------- |
| Daily Marketing Brief    | Schedule              | Summarize campaigns and today's priorities           |
| Social Post Generator    | AppForge event        | Draft social posts from a campaign row               |
| Newsletter Builder       | Schedule              | Draft weekly newsletter and create email draft       |
| Lead Magnet Follow-Up    | Webhook               | Capture lead and send approved welcome email         |
| VIP Email Alert          | Message/email event   | Classify urgent inbound messages and notify operator |
| Content Repurposing      | AppForge event        | Turn an approved article into social/email snippets  |
| CRM Lead Scoring         | AppForge event        | Score new leads and update CRM/table                 |
| Sales Follow-Up Reminder | Schedule              | Draft stale-lead follow-up                           |
| Invoice Follow-Up        | Schedule              | Draft overdue invoice reminder                       |
| Client Onboarding        | Webhook               | Create project, checklist, and welcome packet        |
| Candidate Intake         | Webhook               | Summarize/rank applicants                            |
| Interview Prep           | AppForge event        | Generate interview kit                               |
| Employee Onboarding      | AppForge event        | Create new-hire tasks and first-day message          |
| Support Triage           | Email event           | Classify support and create ticket                   |
| Review Request           | AppForge event + wait | Wait after completion, then request review           |
| Monthly Owner Report     | Schedule              | Compile owner operating report                       |
| Operations Cleanup       | Schedule + approval   | Propose stale record cleanup                         |
| Abandoned Cart Recovery  | Webhook               | Draft cart recovery follow-up                        |
| Job Offer Draft          | AppForge event        | Draft offer packet                                   |
| Webinar Follow-Up        | Webhook               | Segment attendees and draft follow-up                |

Highlighted variations for testing different owner-operator shapes:

- **Abandoned Cart Recovery**: ecommerce sales recovery.
- **Job Offer Draft**: HR decision and outbound offer approval.
- **Webinar Follow-Up**: marketing event segmentation.
- **Operations Cleanup**: internal mutation batch with approval.
- **Monthly Owner Report**: read-heavy multi-table reporting.

## First Browser Test Targets

1. Import `Daily Marketing Brief`, name it, save it, and run pinned test mode.
2. Import `Newsletter Builder`, confirm Resend is listed as a missing live credential, and verify the
   approval gate appears before email draft creation.
3. Import `Social Post Generator`, confirm AppForge event trigger and Buffer output are understandable.
4. Import `Client Onboarding`, confirm AppForge base/table selectors are human-readable.
5. Import `Operations Cleanup`, confirm it cannot mutate records live without approval.
