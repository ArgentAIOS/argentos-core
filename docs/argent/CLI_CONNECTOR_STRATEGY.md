# CLI Connector Strategy

## Core Rule

Do not build the worker system around vendor names.

Build it around:

- worker role
- source type
- connector
- actions/capabilities
- policy
- escalation

Vendor names belong at the connector layer, not the worker model layer.

---

## Correct Abstraction

### Worker

A worker is:

- a role
- a workload definition
- a trigger model
- an escalation policy
- a set of allowed capabilities

Examples:

- support inbox worker
- bookkeeping sync worker
- SOC alert triage worker
- spreadsheet ingestion worker

### Connector

A connector is:

- the system boundary a worker interacts with
- the auth/setup for that system
- the list of supported actions

Examples:

- Gmail connector
- Google Sheets connector
- QuickBooks connector
- Atera connector
- Huntress connector
- Hootsuite connector

### Adapter Implementation

An adapter is the implementation behind the connector.

Possible implementations:

- direct API calls
- SDK wrappers
- database queries
- filesystem logic
- CLI-backed wrappers

For ArgentOS, CLI-backed adapters are a valid primary implementation path.

---

## Repo Model

### External repo stays external

`/Users/sem/code/agent-cli-tools` should remain a separate repo.

Reason:

- it is reusable outside ArgentOS
- it can be public without exposing ArgentOS internals
- it gives you a clean generic connector/tool ecosystem
- it prevents vendor adapters from polluting the core runtime

### ArgentOS consumes it

ArgentOS should not duplicate those adapters.

ArgentOS should:

- discover installed `aos-*` tools
- read their `capabilities --json`
- expose them as selectable connector capabilities
- assign them to workers through policy and tool grants

That means:

- `agent-cli-tools` = public connector/tool ecosystem
- `argentos` = runtime/orchestration/policy/operator UX

---

## What The Existing `agent-cli-tools` Repo Already Gets Right

From:

- `/Users/sem/code/agent-cli-tools/ARCHITECTURE.md`
- `/Users/sem/code/agent-cli-tools/HARNESS-SPEC.md`
- `/Users/sem/code/agent-cli-tools/PERMISSIONS.md`

The repo already has the correct backbone:

- JSON-first command output
- deterministic CLI contract
- built-in permission tiers
- `capabilities --json`
- `health`
- `config show`

That is the right base contract for agent-facing connectors.

The missing piece is not the CLI philosophy.

The missing piece is the bridge between:

- connector capabilities
- worker setup UX
- service key onboarding
- runtime tool registration

---

## What Needs To Be Added To The Connector Contract

The current harness is good, but not yet rich enough for worker-driven setup.

`capabilities --json` should eventually describe more than commands.

Add connector metadata like:

- connector id
- connector label
- connector category
- backend type
- auth requirements
- supported resources
- supported actions
- supports polling
- supports webhook/events
- side-effect classes
- setup checklist

Example shape:

```json
{
  "tool": "aos-google",
  "version": "1.2.0",
  "manifest_schema_version": "2.0.0",
  "connector": {
    "id": "google-workspace",
    "label": "Google Workspace",
    "category": "productivity-suite",
    "resources": ["gmail", "drive", "calendar", "sheets", "docs"],
    "supports_polling": true,
    "supports_events": false
  },
  "auth": {
    "kind": "oauth_or_service_key",
    "required": true,
    "service_keys": [],
    "interactive_setup": ["Install gws", "Run gws auth login -s drive,gmail,calendar,sheets,docs"]
  },
  "commands": [
    {
      "id": "gmail.search",
      "summary": "Search messages",
      "required_mode": "readonly",
      "supports_json": true,
      "resource": "gmail",
      "action_class": "read"
    },
    {
      "id": "calendar.create",
      "summary": "Create calendar event",
      "required_mode": "write",
      "supports_json": true,
      "resource": "calendar",
      "action_class": "write"
    }
  ]
}
```

That gives Argent enough information to drive setup without hardcoding vendors.

---

## How ArgentOS Should Consume CLI Connectors

### 1. Discover installed `aos-*` tools

Argent should scan configured CLI connector locations and collect:

- binary name
- version
- `capabilities --json`
- `health --json`

### 2. Register a connector catalog

Argent should build a connector catalog with generic categories:

- inbox
- ticket queue
- table
- accounting
- alert stream
- files/docs
- social publishing
- CRM
- messaging

Then each installed connector maps into one or more categories.

Examples:

- Gmail -> inbox
- Google Sheets -> table
- QuickBooks -> accounting
- Atera -> ticket queue
- Huntress -> alert stream
- Hootsuite -> social publishing

### 3. Expose connector actions as worker-selectable capabilities

The worker flow should say:

- source type
- connector
- account/resource
- actions allowed

Not:

- raw tool id
- vendor-specific backend details

### 4. Bridge to actual runtime tools

At execution time, Argent can expose connector-backed tools in one of two ways:

#### Option A: one bridge tool per connector command

Examples:

- `quickbooks_customer_lookup`
- `quickbooks_invoice_create`
- `google_sheets_read_rows`

Good:

- explicit
- easy to govern
- easy to assign selectively

#### Option B: one generic bridge tool per connector

Example:

- `aos_connector`
  - connector=`quickbooks`
  - command=`invoice.create`

Good:

- easier bridge implementation

Bad:

- worse ergonomics
- harder governance and auditing
- poorer tool selection in worker UI

Recommendation:

- use explicit per-command bridged tools for operator-facing assignment
- keep a generic internal bridge available behind the scenes if useful

---

## Worker Flow Model

The worker flow should be generic.

It should ask:

### 1. What kind of work is this?

- inbox
- ticket queue
- alert stream
- table/spreadsheet
- accounting sync
- webhook/event ingestion

### 2. Which connector provides that work?

- Gmail
- Google Sheets
- QuickBooks
- Atera
- Huntress
- Hootsuite

### 3. What resource/account should it use?

- mailbox address
- queue id
- sheet id
- QuickBooks company/account
- alert stream/source

### 4. What can it do?

- read
- search
- create
- update
- close
- acknowledge
- escalate

### 5. What are the rules?

- what can be done automatically
- what requires escalation
- what must never be done

### 6. How should it run?

- poll every N minutes
- event-driven only
- hybrid
- drain until clear

This works for any customer.

---

## Operator-Driven Tool Creation

This is the part you actually want.

### Desired flow

1. Operator says:
   - “I need Hootsuite access”
   - “I need QuickBooks invoice sync”
   - “I need a connector for this system”

2. Argent checks connector catalog:
   - installed?
   - healthy?
   - authenticated?
   - actions supported?

3. If missing, Argent starts connector creation flow:
   - identify vendor/system
   - identify required actions
   - identify auth model
   - identify polling vs event model
   - scaffold a new `aos-*` tool in `agent-cli-tools`

4. Argent asks for prerequisites:
   - API key
   - OAuth app
   - account id
   - tenant id
   - base URL

5. Operator adds secrets to Argent service keys

6. Argent validates:
   - `health`
   - `doctor`
   - `capabilities --json`

7. Argent activates connector

8. Worker flow can now assign that connector to workers

This is the correct long-term behavior.

---

## What Argent Should Build Next

### A. Connector registry in ArgentOS

Argent needs a first-class connector registry that tracks:

- installed CLI connectors
- version
- health
- auth/setup readiness
- exposed actions
- category mappings

### B. CLI connector bridge

Argent needs a runtime bridge that can:

- call `aos-*` binaries safely
- pass structured params
- enforce mode mapping
- parse JSON envelopes
- expose connector actions as Argent tools

### C. Connector builder flow

Argent needs a guided builder for missing connectors:

- scaffold from `agent-cli-tools/templates/python-click-tool`
- ask the operator the right questions
- create command/action manifest
- point operator at service key requirements

### D. Worker flow integration

The worker UI should consume the connector registry, not hardcoded tool names.

---

## Generic vs Specific

### Generic product nouns

- inbox
- queue
- table
- accounting system
- alert stream
- CRM
- social publisher
- docs/files

### Specific connector implementations

- Gmail
- Google Sheets
- QuickBooks
- Atera
- Huntress
- Hootsuite

That is the separation you want.

---

## Recommendation

Keep the strategy as:

1. `agent-cli-tools` stays external and public
2. ArgentOS gains a connector registry + CLI bridge
3. workers stay generic
4. connectors stay vendor-specific
5. missing connectors are scaffolded through an operator-guided creation flow

That gives you:

- generic product UX
- specific customer integrations
- public connector ecosystem
- clean runtime governance inside ArgentOS

## One Sentence Version

Do not build workers around vendors; build workers around workload types, then plug vendor-specific CLI connectors into that model through a registry and bridge.
