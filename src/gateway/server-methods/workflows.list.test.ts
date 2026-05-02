import { describe, expect, it, vi } from "vitest";
import type { GatewayRequestHandlerOptions } from "./types.js";
import {
  WORKFLOWS_LIST_NO_LIVE_DATA_SNAPSHOT,
  workflowListNoLiveDataSnapshot,
  workflowsHandlers,
} from "./workflows.js";

async function callWorkflowList(params: Record<string, unknown>) {
  const respond = vi.fn();
  await workflowsHandlers["workflows.list"]({
    params,
    respond,
  } as unknown as GatewayRequestHandlerOptions);
  return respond.mock.calls[0] as [boolean, unknown, unknown?];
}

describe("workflows.list no-live-data snapshot", () => {
  it("returns public workflow rows without requiring a live database", async () => {
    const [ok, payload, error] = await callWorkflowList({
      snapshot: WORKFLOWS_LIST_NO_LIVE_DATA_SNAPSHOT,
    });

    expect(ok).toBe(true);
    expect(error).toBeUndefined();
    expect(payload).toMatchObject({
      total: 2,
      limit: 50,
      offset: 0,
      snapshot: {
        id: WORKFLOWS_LIST_NO_LIVE_DATA_SNAPSHOT,
        source: "synthetic",
        noLiveData: true,
        workflowExecution: false,
        workflowRunsMutated: false,
      },
    });
    expect((payload as { workflows: Array<Record<string, unknown>> }).workflows[0]).toMatchObject({
      id: "wf-rust-parity-active",
      run_count: 0,
      validation: { ok: true },
      definition: {
        id: "wf-rust-parity-active",
        name: "Rust Parity Synthetic Active Workflow",
        deploymentStage: "simulate",
      },
    });
  });

  it("supports parity filtering without querying workflow_runs", () => {
    const payload = workflowListNoLiveDataSnapshot({
      activeOnly: true,
      ownerAgentId: "rust-parity-agent",
    });

    expect(payload.total).toBe(1);
    expect(payload.workflows).toHaveLength(1);
    expect(payload.workflows[0]).toMatchObject({
      id: "wf-rust-parity-active",
      is_active: true,
      owner_agent_id: "rust-parity-agent",
      run_count: 0,
    });
  });

  it("rejects unknown snapshot contracts before live DB access", async () => {
    const [ok, payload, error] = await callWorkflowList({ snapshot: "unknown" });

    expect(ok).toBe(false);
    expect(payload).toBeUndefined();
    expect(error).toMatchObject({
      code: "UNAVAILABLE",
      message: expect.stringContaining('Unsupported workflows.list snapshot "unknown"'),
    });
  });
});
