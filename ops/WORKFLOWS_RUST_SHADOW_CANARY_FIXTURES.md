# Workflows Rust Shadow Canary Fixture Contract

Status: synthetic / isolated / no live external side effects.

Owner: Workflows.

Rust authority label: shadow read-only.

Node authority label: live for workflow scheduler, workflow runs, wait/approval resumes, cron
mutation, and rollback decisions.

## Artifact Paths

- Fixture/proof module:
  `src/infra/workflow-rust-canary-fixtures.ts`
- Fixture/proof tests:
  `src/infra/workflow-rust-canary-fixtures.test.ts`

Rust should import or mirror the exported JSON-compatible contracts from
`buildWorkflowRustShadowFixturePack()` and `buildWorkflowTemplateCanaryProof()`.

## Fixture Pack

`buildWorkflowRustShadowFixturePack()` returns:

- `schemaVersion: 1`
- `id: workflows-rust-shadow-canary-fixtures`
- `generatedFrom: synthetic-workflows-owned-contract`
- `cases[]`

Each case has:

- `workflow`: a synthetic `WorkflowDefinition`
- `cronJobs`: optional synthetic isolated cron jobs
- `runs`: synthetic workflow run rows/shape
- `steps`: synthetic workflow step row/shape
- `expected`: comparison contract

Every case declares:

- `rustAuthority: shadow_read_only`
- `nodeAuthority: live`
- `allowedRustAction: compare_only`
- `mustNotMutate`: includes `workflow_runs`, `workflow_step_runs`, `cron jobs`, and
  `approvals`

## Covered Cases

1. `cron_workflow_run`
   - Isolated cron payload shape for `workflowRun`.
   - Compares `workflowId`, `triggerSource`, `dedupeKey`, and status.

2. `waiting_duration`
   - Durable pause shape for `waiting_duration`.
   - One running gate step with `inputContext.waitResumeAt`.

3. `waiting_event`
   - Durable pause shape for `waiting_event`.
   - One running gate step with event filter context.

4. `waiting_approval`
   - Durable approval pause shape.
   - One running gate step with `approvalStatus: pending`.

5. `duplicate_workflow_run_prevention`
   - Duplicate cron attempts with one Node-owned run claim.
   - Rust compares the dedupe key and expected single run.

6. `stale_cron_cleanup`
   - Current and stale cron job shapes.
   - Rust may detect mismatch; Node owns cleanup mutation.

7. `rollback_inventory_expectations`
   - Read-only inventory of waiting and running workflow runs.
   - Rollback remains design/read-only until durable authority exists.

## Template Canary Proof

`buildWorkflowTemplateCanaryProof()` returns:

- `schemaVersion: 1`
- `id: workflows-template-canary-proof`
- `noLiveExternalSideEffects: true`
- `families[]` for templates with connector/channel/AppForge dependencies

Each family includes:

- `dryRunReady`
- `liveReadiness`
- `dependencyIds`
- `appForgeTables`
- `dryRunToLivePath`

The stage path is:

1. `import`
2. `dry_run`
3. `canary_required`
4. `live_ready`

Without live bindings and canary proof, templates must remain import/dry-run or canary-required.
With connector credentials, AppForge write-ready resources, channels, and passed family canary,
the proof may show `live_ready`.

## Verification

Focused proof:

```sh
pnpm exec vitest run src/infra/workflow-rust-canary-fixtures.test.ts
```

Current result:

- 1 test file passed
- 5 tests passed

## Rust Use

Rust may:

- Compare scheduler/run/wait/approval/dedupe shapes against these fixtures.
- Generate read-only parity reports from fixture input.
- Treat discrepancies as shadow findings.

Rust must not:

- Mutate `workflow_runs`, `workflow_step_runs`, cron jobs, approvals, channels, or external
  connectors.
- Promote itself to workflow/scheduler/run authority from this fixture proof.
- Execute live connector-backed or channel-backed side effects from these fixtures.
