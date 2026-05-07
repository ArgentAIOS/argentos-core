/**
 * Workflow Runner — Cost / Token Aggregation Regression Test.
 *
 * Locks in the contract that per-step `tokensUsed` and `costUsd` from each
 * agent dispatch bubble up into the run-level totals exposed to
 * `onRunComplete` (which is what `finishWorkflowRun` writes into the
 * `workflow_runs.total_tokens_used` / `total_cost_usd` columns).
 *
 * Background: In production we observed 48 Morning Brief runs all reporting
 * 0 tokens / $0 cost. Schema accepted the values; the runner just wasn't
 * carrying step-level usage through to the run row. This test guards the
 * happy path by exercising the dispatcher → step record → context totals →
 * onRunComplete pipeline with non-zero step usage and asserting the run
 * total matches the sum of step usage.
 */

import { describe, it, expect, vi } from "vitest";
import type {
  TriggerNode,
  AgentNode,
  OutputNode,
  WorkflowNode,
  WorkflowEdge,
  WorkflowDefinition,
  AgentDispatcher,
  StepRecord,
} from "./workflow-types.js";

// ── Module-level mocks (must run before importing workflow-runner) ────────

vi.mock("../data/redis-client.js", () => ({
  refreshPresence: vi.fn(),
}));

vi.mock("../data/storage-factory.js", () => ({
  getStorageAdapter: vi.fn(async () => ({
    memory: {
      createItem: vi.fn(async (item: { summary?: string }) => ({
        id: "mem-test",
        ...item,
      })),
    },
    tasks: { update: vi.fn() },
  })),
}));

vi.mock("../logging/subsystem.js", () => ({
  createSubsystemLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { executeWorkflow } from "./workflow-runner.js";

// ── Fixtures ──────────────────────────────────────────────────────────────

function makeTrigger(id = "trigger-1"): TriggerNode {
  return { kind: "trigger", id, triggerType: "manual", config: {} };
}

function makeAgent(id: string, label: string, agentId = "main"): AgentNode {
  return {
    kind: "agent",
    id,
    label,
    config: {
      agentId,
      rolePrompt: `You are the ${label} agent.`,
      timeoutMs: 60_000,
      evidenceRequired: false,
    },
  };
}

function makeOutput(id = "output-1"): OutputNode {
  return {
    kind: "output",
    id,
    label: "Output",
    config: { outputType: "docpanel", title: "Result" },
  };
}

function makeWorkflow(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  overrides: Partial<WorkflowDefinition> = {},
): WorkflowDefinition {
  return {
    id: "wf-cost-aggregation",
    name: "Cost Aggregation Test",
    nodes,
    edges,
    defaultOnError: { strategy: "fail" },
    ...overrides,
  };
}

function edge(source: string, target: string): WorkflowEdge {
  return { id: `e-${source}-${target}`, source, target };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("workflow runner cost aggregation", () => {
  it("aggregates per-step tokensUsed and costUsd into run totals", async () => {
    // Each agent step reports non-zero usage. The two agent steps together
    // should produce totalTokens = 1500 and totalCostUsd = 0.075.
    const stepUsage = [
      { tokensUsed: 600, costUsd: 0.025 },
      { tokensUsed: 900, costUsd: 0.05 },
    ];
    let stepIdx = 0;
    const dispatcher: AgentDispatcher = {
      dispatch: vi.fn(async () => {
        const usage = stepUsage[stepIdx++] ?? { tokensUsed: 0, costUsd: 0 };
        return {
          items: [
            {
              json: { result: "ok" },
              text: "step done",
              meta: {
                nodeId: "",
                status: "completed" as const,
                durationMs: 100,
                tokensUsed: usage.tokensUsed,
                costUsd: usage.costUsd,
              },
            },
          ],
        };
      }),
    };

    const trigger = makeTrigger();
    const agentA = makeAgent("agent-a", "A");
    const agentB = makeAgent("agent-b", "B");
    const output = makeOutput();
    const workflow = makeWorkflow(
      [trigger, agentA, agentB, output],
      [edge(trigger.id, agentA.id), edge(agentA.id, agentB.id), edge(agentB.id, output.id)],
    );

    let onCompleteSteps: StepRecord[] | undefined;
    let onCompleteStatus: string | undefined;
    const result = await executeWorkflow({
      workflow,
      runId: "run-cost-aggregation",
      dispatcher,
      onRunComplete: (status, steps) => {
        onCompleteStatus = status;
        onCompleteSteps = steps;
      },
    });

    // Run-level totals must match the sum of per-step usage.
    expect(result.status).toBe("completed");
    expect(result.totalTokens).toBe(1500);
    expect(result.totalCostUsd).toBeCloseTo(0.075, 6);

    // onRunComplete (the hook finishWorkflowRun listens on) must receive
    // the populated step records, since that's what the persistence layer
    // sums into workflow_runs.total_tokens_used / total_cost_usd.
    expect(onCompleteStatus).toBe("completed");
    expect(onCompleteSteps).toBeDefined();
    const steps = onCompleteSteps ?? [];
    const stepTokens = steps.reduce((sum, s) => sum + (s.tokensUsed ?? 0), 0);
    const stepCost = steps.reduce((sum, s) => sum + (s.costUsd ?? 0), 0);
    expect(stepTokens).toBe(1500);
    expect(stepCost).toBeCloseTo(0.075, 6);

    // Each agent step record must carry its individual usage so the SQL
    // fallback aggregation (over workflow_step_runs) lines up too.
    const agentSteps = steps.filter((s) => s.nodeKind === "agent");
    expect(agentSteps).toHaveLength(2);
    expect(agentSteps[0].tokensUsed).toBe(600);
    expect(agentSteps[0].costUsd).toBeCloseTo(0.025, 6);
    expect(agentSteps[1].tokensUsed).toBe(900);
    expect(agentSteps[1].costUsd).toBeCloseTo(0.05, 6);
  });

  it("does not zero-out usage when individual items omit cost metadata", async () => {
    // Some dispatchers only set tokensUsed (no costUsd). The run total for
    // tokens should still aggregate even though cost stays zero.
    const dispatcher: AgentDispatcher = {
      dispatch: vi.fn(async () => ({
        items: [
          {
            json: { ok: true },
            text: "tokens-only",
            meta: {
              nodeId: "",
              status: "completed" as const,
              durationMs: 50,
              tokensUsed: 250,
              // no costUsd
            },
          },
        ],
      })),
    };

    const trigger = makeTrigger();
    const agent = makeAgent("agent-only-tokens", "TokensOnly");
    const output = makeOutput();
    const workflow = makeWorkflow(
      [trigger, agent, output],
      [edge(trigger.id, agent.id), edge(agent.id, output.id)],
    );

    const result = await executeWorkflow({
      workflow,
      runId: "run-tokens-only",
      dispatcher,
    });

    expect(result.status).toBe("completed");
    expect(result.totalTokens).toBe(250);
    expect(result.totalCostUsd).toBe(0);
  });
});
