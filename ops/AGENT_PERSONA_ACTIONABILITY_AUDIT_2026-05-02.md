# Agent Persona Actionability Audit

Date: 2026-05-02
Lane: agent-persona
Task: task-20260502114032-j2jh1d
Worktree: `/Users/sem/code/argent-core-worktrees/agent-persona-actionability-audit`
Branch: `codex/agent-persona-actionability-audit`
Base: `origin/dev` at `7cfdc4f5`

## Summary

The actionability failure is not purely model behavior. Argent already has prompt-level rules and partial harness enforcement for one important case: task board cleanup claims. The remaining gap is that mutation receipts are task-specific, while operator cleanup requests often target docs, workflows, projects, archives, or mixed housekeeping surfaces.

The current control point should be the embedded-runner tool-claim validation path:

- `src/agents/pi-embedded-subscribe.tools.ts`
- `src/agents/pi-embedded-subscribe.handlers.tools.ts`
- `src/agents/tool-claim-validation.ts`
- `src/agents/pi-embedded-runner/run.ts`

The smallest enforceable next slice is to generalize `TaskMutationEvidence` into a typed mutation receipt model while keeping the existing task behavior intact.

## Evidence

### Prompt Contract Exists But Is Not Enough

`src/agents/system-prompt.ts:654` defines an "Execute, Don't Describe" rule. `src/agents/system-prompt.ts:655` says the agent must not say it is doing something without actually calling the tool, and `src/agents/system-prompt.ts:663` says evidence beats claims.

This is useful, but it is prompt-only. It does not create a durable receipt requirement for broader housekeeping claims like "I archived stale workflows" or "I pruned old docs."

Confidence: high.

### Harness Enforcement Exists For Task Cleanup

`src/agents/tool-claim-validation.ts:182` defines task-result cleanup claim matching. `src/agents/tool-claim-validation.ts:413` defines `TaskMutationEvidence`. `src/agents/tool-claim-validation.ts:757` extracts task-result reply evidence. `src/agents/tool-claim-validation.ts:848` checks whether same-turn task mutation evidence satisfies the reply. `src/agents/tool-claim-validation.ts:1059` exposes `validateToolClaims`.

`src/agents/pi-embedded-runner/run.ts:1283` passes `attempt.taskMutationEvidence` into `validateToolClaims`, so covered claims are enforced by the harness, not just by model obedience.

Focused verification already confirmed this path:

```sh
pnpm exec vitest run src/agents/tool-claim-validation.test.ts src/agents/pi-embedded-runner.run-commitment-enforcement.test.ts src/agents/pi-embedded-subscribe.subscribe-embedded-pi-session.subscribeembeddedpisession.test.ts
```

Result: 3 files passed, 70 tests passed.

Confidence: high.

### Mutation Evidence Collection Is Task-Specific

`src/agents/pi-embedded-subscribe.tools.ts:222` maps only task actions into mutation actions. `src/agents/pi-embedded-subscribe.tools.ts:322` exports `extractTaskMutationEvidence`. `src/agents/pi-embedded-subscribe.handlers.tools.ts:194` calls that extractor and stores the result only if it is task mutation evidence.

The extractor ignores non-`tasks` tools by design. That means mutating tools such as DocPanel updates/deletes and workflow creation/deletion can execute and return textual or JSON results without becoming normalized same-turn mutation receipts for the commitment validator.

Confidence: high.

### Non-Task Mutation Tools Exist But Are Not Receipt-Normalized

Document mutation tools:

- `src/agents/tools/doc-panel-update-tool.ts:48` registers `doc_panel_update`.
- `src/agents/tools/doc-panel-delete-tool.ts:38` registers `doc_panel_delete`.

Workflow mutation surfaces:

- `src/agents/tools/workflow-builder-tool.ts:54` registers `workflow_builder`.
- `src/agents/tools/workflow-builder-tool.ts:91` calls `workflows.create` for `save_draft`.
- `src/gateway/server-methods.ts:191` registers `workflows.create` as write scope.
- `src/gateway/server-methods.ts:193` registers `workflows.delete` as write scope.
- `src/gateway/server-methods.ts:197` registers `workflows.cancel` as write scope.
- `src/gateway/server-methods/workflows.ts:2071` implements `workflows.create`.
- `src/gateway/server-methods/workflows.ts:2520` implements `workflows.delete`.
- `src/gateway/server-methods/workflows.ts:2774` implements `workflows.cancel`.

These are real mutation paths. The failure is not that mutation tools are totally absent. The failure is that the runner's proof contract does not normalize their receipts into the same validation channel used for task cleanup claims.

Confidence: high.

## Diagnosis By Cause

Model behavior: medium confidence, secondary cause.
The model may choose pleasing narration or memory reflection, especially when the prompt is emotionally loaded. But existing tests prove harness enforcement can block unsupported cleanup claims when the claim shape is covered.

Prompt/policy behavior: medium confidence, partial cause.
The prompt has a strong action rule, but it is broad and not domain-specific enough for housekeeping. It does not require an inventory, mutation receipt, and verification receipt before reporting cleanup.

Harness/tool-routing behavior: high confidence, primary cause.
The runner validates task board cleanup claims against task mutation evidence. It does not yet validate equivalent doc/workflow/project/archive cleanup claims against generic mutation receipts.

Tool affordance behavior: high confidence, primary cause.
There are mutating tools and gateway methods, but their results are heterogeneous: text for DocPanel tools, JSON for gateway-backed workflow calls, and task-specific text/count patterns for tasks. The harness needs a shared receipt abstraction.

Task/workflow/doc API ambiguity: medium-high confidence, contributing cause.
Tasks have a clean agent tool with explicit mutation actions. Workflows and docs expose several mutation methods, but there is no single housekeeping state machine that tells the agent how to inventory, classify, mutate, verify, and report only receipts.

## Failure Mode

Representative failure mode:

1. Operator asks: "Clean this up. Prune stale docs/workflows. Do not come back with a plan."
2. Agent uses `memory_store`, search/list/read tools, or plain narration.
3. Agent replies: "Done. I cleaned it up / pruned it / archived the stale items."
4. No same-turn mutation receipt exists for the named docs/workflows/projects.
5. Current validation may block this for task-board cleanup, but not for non-task housekeeping claims.

## Required State Machine

Housekeeping requests should be forced through this state machine:

1. Inventory: list candidate entities with ids, titles, state, owner/scope, and reason they are candidates.
2. Classify: mark each candidate as mutate, keep, needs approval, out of scope, or blocked.
3. Mutate: call the correct mutating tool or gateway method for each approved candidate.
4. Verify: re-read/list the affected entities or durable store and capture after-state.
5. Report receipts: answer only with mutation receipts and verification receipts. If no mutation happened, say no mutation happened.

The final report should include:

- entity type
- entity id
- action
- before state when available
- after state when available
- tool or method that mutated it
- verification method
- blocked items with owner and next unblock action

## Failing Regression Target

Add a failing test in `src/agents/tool-claim-validation.test.ts`:

```ts
it("blocks doc/workflow cleanup claims without mutation receipts", () => {
  const result = validateToolClaims({
    responseText: "Done. I archived the stale workflow and deleted the old cleanup doc.",
    executedToolNames: ["memory_store", "read"],
  });

  expect(result.valid).toBe(false);
  expect(result.missingClaimLabels).toContain("mutation receipt");
});
```

This captures the operator pain directly: memory/read activity must not satisfy cleanup/prune/archive/delete claims.

## Passing Target

After the implementation slice, the equivalent claim should pass only when same-turn mutation receipts are supplied:

```ts
const result = validateToolClaims({
  responseText: "Done. I archived workflow WF-123 and deleted document DOC-456.",
  executedToolNames: ["workflow_builder", "doc_panel_delete"],
  mutationEvidence: [
    {
      toolName: "workflows.delete",
      entityType: "workflow",
      action: "delete",
      entityIds: ["WF-123"],
      afterStatus: "deleted",
    },
    {
      toolName: "doc_panel_delete",
      entityType: "document",
      action: "delete",
      entityIds: ["DOC-456"],
      afterStatus: "deleted",
    },
  ],
});

expect(result.valid).toBe(true);
```

## Smallest Implementation Slice

Implement a generic mutation receipt layer without changing live tool behavior.

1. Rename or wrap `TaskMutationEvidence` as `MutationEvidence`.
   Keep the current task fields and tests compatible.

2. Extend `src/agents/pi-embedded-subscribe.tools.ts`.
   Add extractors for:
   - `doc_panel_update`
   - `doc_panel_delete`
   - `workflow_builder` when it returns a saved workflow
   - gateway tool names or result shapes for `workflows.create`, `workflows.update`, `workflows.delete`, `workflows.cancel`, and `workflows.resume` if those can appear as agent tool executions.

3. Extend `src/agents/tool-claim-validation.ts`.
   Add claim detection for cleanup verbs over non-task entities:
   - document/doc/docpanel
   - workflow
   - project
   - archive/stale/old cleanup sets

4. Require matching mutation evidence.
   A read/list/search/memory tool can support inventory, but it cannot satisfy mutate/cleanup/prune/archive claims.

5. Keep prompt changes secondary.
   Add a short system prompt sentence only after harness tests exist: cleanup/prune/archive reports must list mutation receipts or say no mutation occurred.

## Verification Commands For Implementation Slice

Run:

```sh
pnpm exec vitest run src/agents/tool-claim-validation.test.ts src/agents/pi-embedded-subscribe.subscribe-embedded-pi-session.subscribeembeddedpisession.test.ts src/agents/pi-embedded-runner.run-commitment-enforcement.test.ts
pnpm exec oxfmt --check src/agents/tool-claim-validation.ts src/agents/tool-claim-validation.test.ts src/agents/pi-embedded-subscribe.tools.ts src/agents/pi-embedded-subscribe.subscribe-embedded-pi-session.subscribeembeddedpisession.test.ts
pnpm exec oxlint --type-aware src/agents/tool-claim-validation.ts src/agents/tool-claim-validation.test.ts src/agents/pi-embedded-subscribe.tools.ts src/agents/pi-embedded-subscribe.subscribe-embedded-pi-session.subscribeembeddedpisession.test.ts
git diff --check
pnpm check:repo-lane
```

## Explicit Non-Claims

This audit did not mutate tasks, workflows, docs, projects, archives, customer data, connector state, or live authority.

No live external side effects were performed.

No implementation slice is claimed ready here. This packet is a diagnosis and enforceable recommendation artifact.
