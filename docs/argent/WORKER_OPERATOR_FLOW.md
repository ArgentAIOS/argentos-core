# Worker Operator Flow

## Problem

The current workforce system is technically capable but operationally fragmented.

Today the operator has to reason across:

- templates
- assignments
- event triggers
- task queue behavior
- execution worker cadence
- runtime status
- run reviews
- event logs

That is too many disconnected surfaces for one job: "create a worker, give it tools, tell it what to watch, and understand what it did."

## Product Rule

The worker UX should be organized around one operator question:

> What work should this worker watch for, what is it allowed to do, and what happens when it gets blocked?

Everything else is implementation detail.

## Desired Flow

### 1. Setup Worker

Operator fills in:

- worker name
- agent target
- department / lane
- purpose
- escalation owner

Output:

- agent identity
- role contract
- assignment title

### 2. Attach Inputs

Operator chooses what creates work:

- schedule only
- internal event
- inbox / channel poll
- webhook

For each input, operator sets:

- cadence
- event trigger(s)
- queue-drain policy

Default rule:

- when triggered, drain all available work in the source until empty
- do not stop after one item unless explicitly configured

### 3. Attach Capabilities

Operator grants concrete tools and systems:

- read inbox
- send email
- read software XYZ
- reset password in XYZ
- create ticket
- escalate to human

This must be described in operator language, not generic tool IDs.

The UI should answer:

- what can this worker read?
- what can this worker write?
- what external systems can this worker touch?

## 4. Define Decision Policy

Operator defines:

- what counts as resolvable automatically
- what requires clarification
- what requires escalation
- what must never be done

Example:

- if question is answerable from software docs, reply directly
- if password reset is supported, perform it and confirm
- if blocked, send user a holding response and escalate to tier 2

## 5. Deploy

Operator chooses:

- simulate
- shadow
- live

And sees:

- cadence
- triggers
- granted systems
- escalation path
- queue-drain behavior

## 6. Observe

Each worker needs one clear operational screen with:

- status: idle / running / rerun queued / paused
- next run
- last run
- last dispatch reason
- open assignments
- recent runs
- recent escalations
- recent failures / skips
- why it is idle

## 7. Coach

Operator must be able to mark runs as:

- correct
- incorrect
- escalated too early
- failed to escalate
- used wrong tool
- incomplete response

This feedback should attach to the run, assignment, and eventually SIS/lesson systems.

## Runtime Contract

The worker runtime should behave like this:

1. An event or due schedule creates work.
2. The orchestrator immediately wakes the execution worker.
3. The worker drains all runnable tasks up to configured runtime/task caps.
4. If new work lands while the worker is already running, queue an immediate rerun.
5. If blocked, record the blocker and expose it in the operator timeline.

## What Exists Now

Already implemented:

- job templates
- assignments
- event queue
- due-task creation
- execution worker queue draining
- run history
- event history
- manual `runNow`
- worker pause/resume/reset

Implemented in this pass:

- accepted orchestrator events now trigger an immediate cycle instead of waiting for the next poll
- new tasks now dispatch the execution worker immediately
- running workers can queue an immediate follow-up pass
- operator runtime control now uses `Play / Pause / Stop` semantics instead of `run now`
- dashboard primary entry now opens an operator-first worker flow modal
- worker flow now includes starter presets for `VIP Email Watcher` and `Slack Mention Watcher`
- the modal saves worker identity, workload template, assignment, tool grants, and launch state in one flow
- the old workforce board remains available as the advanced inspection surface

## What Is Still Missing

Still missing or incomplete after this pass:

- deeper source-specific setup for inboxes, ticket queues, Huntress, log pipelines, and other system adapters
- a single `why idle / why blocked` inspector tied directly to runtime state
- structured coaching UI for correcting worker behavior after a run
- first-class tool request backlog and tool-creation flow when an operator records missing capabilities
- audit trace inside the new operator flow beyond the current recent-runs and recent-events preview

## Next UI Cut

Build a dedicated worker workflow with these screens:

1. `What is this worker for?`
2. `What creates work for it?`
3. `What systems can it use?`
4. `What should it do when blocked?`
5. `Review and deploy`
6. `Runs and coaching`

Do not start with intent hierarchy or simulation internals.
Those are advanced controls, not the primary operator flow.
