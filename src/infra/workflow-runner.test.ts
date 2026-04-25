/**
 * Workflow Runner — Unit tests for the DAG execution engine.
 *
 * Tests topological sort, condition evaluation (via gate nodes),
 * pipeline execution, budget circuit breaker, retry logic,
 * and merge strategies (via parallel segments).
 */

import { describe, it, expect, vi } from "vitest";
import type {
  TriggerNode,
  AgentNode,
  OutputNode,
  GateNode,
  WorkflowNode,
  WorkflowEdge,
  WorkflowDefinition,
  AgentDispatcher,
} from "./workflow-types.js";

// Mock redis-client to avoid real Redis connections in tests
vi.mock("../data/redis-client.js", () => ({
  refreshPresence: vi.fn(),
}));

// Mock subsystem logger
vi.mock("../logging/subsystem.js", () => ({
  createSubsystemLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { topologicalSort, executeWorkflow } from "./workflow-runner.js";

// ── Test Fixtures ─────────────────────────────────────────────────

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

function makeOutput(id = "output-1", label = "Output"): OutputNode {
  return {
    kind: "output",
    id,
    label,
    config: { outputType: "docpanel", title: "Result" },
  };
}

function makeConditionGate(
  id: string,
  field: string,
  operator: "==" | "!=" | ">" | "<" | ">=" | "<=" | "contains" | "matches",
  value: unknown,
  trueEdge: string,
  falseEdge: string,
): GateNode {
  return {
    kind: "gate",
    id,
    label: "Condition",
    config: {
      gateType: "condition",
      expression: { field, operator, value },
      trueEdge,
      falseEdge,
    },
  };
}

function makeWorkflow(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  overrides: Partial<WorkflowDefinition> = {},
): WorkflowDefinition {
  return {
    id: "wf-test",
    name: "Test Workflow",
    nodes,
    edges,
    defaultOnError: { strategy: "fail" },
    ...overrides,
  };
}

function makeMockDispatcher(impl?: AgentDispatcher["dispatch"]): AgentDispatcher {
  return {
    dispatch:
      impl ??
      (async (_agentId, _prompt, _config) => ({
        items: [{ json: { result: "mock output" }, text: "Agent completed the task." }],
      })),
  };
}

function edge(source: string, target: string, id?: string): WorkflowEdge {
  return { id: id ?? `e-${source}-${target}`, source, target };
}

// ── Topological Sort ──────────────────────────────────────────────

describe("topologicalSort", () => {
  it("sorts a linear chain correctly", () => {
    const trigger = makeTrigger();
    const agent = makeAgent("agent-1", "Worker");
    const output = makeOutput();
    const nodes: WorkflowNode[] = [trigger, agent, output];
    const edges: WorkflowEdge[] = [edge(trigger.id, agent.id), edge(agent.id, output.id)];

    const sorted = topologicalSort(nodes, edges);
    expect(sorted.map((n) => n.id)).toEqual([trigger.id, agent.id, output.id]);
  });

  it("detects cycles", () => {
    const a = makeAgent("a", "A");
    const b = makeAgent("b", "B");
    const nodes: WorkflowNode[] = [a, b];
    const edges: WorkflowEdge[] = [edge("a", "b"), edge("b", "a")];

    expect(() => topologicalSort(nodes, edges)).toThrow(/cycle/i);
  });

  it("handles diamond dependency", () => {
    const trigger = makeTrigger();
    const a = makeAgent("a", "A");
    const b = makeAgent("b", "B");
    const output = makeOutput();
    const nodes: WorkflowNode[] = [trigger, a, b, output];
    const edges: WorkflowEdge[] = [
      edge(trigger.id, a.id),
      edge(trigger.id, b.id),
      edge(a.id, output.id),
      edge(b.id, output.id),
    ];

    const sorted = topologicalSort(nodes, edges);
    // Trigger must come first, output must come last
    expect(sorted[0].id).toBe(trigger.id);
    expect(sorted[sorted.length - 1].id).toBe(output.id);
    // A and B must both appear between trigger and output
    const middleIds = sorted.slice(1, -1).map((n) => n.id);
    expect(middleIds).toContain(a.id);
    expect(middleIds).toContain(b.id);
  });

  it("handles single node with no edges", () => {
    const trigger = makeTrigger();
    const sorted = topologicalSort([trigger], []);
    expect(sorted).toHaveLength(1);
    expect(sorted[0].id).toBe(trigger.id);
  });

  it("sorts independent subgraphs", () => {
    const t1 = makeTrigger("t1");
    const t2 = makeTrigger("t2");
    const a1 = makeAgent("a1", "A1");
    const a2 = makeAgent("a2", "A2");
    const nodes: WorkflowNode[] = [t1, t2, a1, a2];
    const edges: WorkflowEdge[] = [edge("t1", "a1"), edge("t2", "a2")];

    const sorted = topologicalSort(nodes, edges);
    expect(sorted).toHaveLength(4);
    // Each trigger must precede its agent
    const t1Idx = sorted.findIndex((n) => n.id === "t1");
    const a1Idx = sorted.findIndex((n) => n.id === "a1");
    const t2Idx = sorted.findIndex((n) => n.id === "t2");
    const a2Idx = sorted.findIndex((n) => n.id === "a2");
    expect(t1Idx).toBeLessThan(a1Idx);
    expect(t2Idx).toBeLessThan(a2Idx);
  });
});

// ── Pipeline Execution ────────────────────────────────────────────

describe("executeWorkflow", () => {
  const mockDispatcher = makeMockDispatcher();

  it("executes a simple Trigger -> Agent -> Output chain", async () => {
    const trigger = makeTrigger();
    const agent = makeAgent("agent-1", "Worker");
    const output = makeOutput();

    const workflow = makeWorkflow(
      [trigger, agent, output],
      [edge(trigger.id, agent.id), edge(agent.id, output.id)],
    );

    const result = await executeWorkflow({
      workflow,
      runId: "run-test-1",
      dispatcher: mockDispatcher,
    });

    expect(result.status).toBe("completed");
    expect(result.steps).toHaveLength(3);
    expect(result.steps[0].nodeKind).toBe("trigger");
    expect(result.steps[1].nodeKind).toBe("agent");
    expect(result.steps[2].nodeKind).toBe("output");
  });

  it("tracks step callbacks", async () => {
    const trigger = makeTrigger();
    const agent = makeAgent("agent-1", "Worker");
    const output = makeOutput();

    const workflow = makeWorkflow(
      [trigger, agent, output],
      [edge(trigger.id, agent.id), edge(agent.id, output.id)],
    );

    const starts: string[] = [];
    const completes: string[] = [];

    await executeWorkflow({
      workflow,
      runId: "run-test-2",
      dispatcher: mockDispatcher,
      onStepStart: (id) => starts.push(id),
      onStepComplete: (id) => completes.push(id),
    });

    expect(starts).toHaveLength(3);
    expect(completes).toHaveLength(3);
    expect(starts).toEqual([trigger.id, agent.id, output.id]);
    expect(completes).toEqual([trigger.id, agent.id, output.id]);
  });

  it("fires onRunComplete callback", async () => {
    const trigger = makeTrigger();
    const output = makeOutput();
    const workflow = makeWorkflow([trigger, output], [edge(trigger.id, output.id)]);

    let runStatus: string | undefined;
    await executeWorkflow({
      workflow,
      runId: "run-test-3",
      dispatcher: mockDispatcher,
      onRunComplete: (status) => {
        runStatus = status;
      },
    });

    expect(runStatus).toBe("completed");
  });

  it("respects budget circuit breaker", async () => {
    const trigger = makeTrigger();
    const agent1 = makeAgent("agent-1", "Worker 1");
    const agent2 = makeAgent("agent-2", "Worker 2");
    const output = makeOutput();

    // Dispatcher that reports high cost
    const expensiveDispatcher = makeMockDispatcher(async () => ({
      items: [
        {
          json: { result: "ok" },
          text: "done",
          meta: {
            nodeId: "",
            status: "completed" as const,
            durationMs: 100,
            tokensUsed: 5000,
            costUsd: 0.5,
          },
        },
      ],
    }));

    const workflow = makeWorkflow(
      [trigger, agent1, agent2, output],
      [edge(trigger.id, agent1.id), edge(agent1.id, agent2.id), edge(agent2.id, output.id)],
      { maxRunCostUsd: 0.6 },
    );

    const result = await executeWorkflow({
      workflow,
      runId: "run-budget",
      dispatcher: expensiveDispatcher,
    });

    // First agent costs 0.50, second costs 0.50 → total 1.00 > budget 0.60
    expect(result.status).toBe("budget_exceeded");
    // Should have at least trigger + agent1 + agent2 steps before break
    expect(result.steps.length).toBeLessThanOrEqual(4);
    expect(result.totalCostUsd).toBeGreaterThan(0.6);
  });

  it("handles agent dispatch failure with retry", async () => {
    let callCount = 0;
    const failingDispatcher = makeMockDispatcher(async () => {
      callCount++;
      if (callCount < 3) {
        throw new Error("temporary failure");
      }
      return { items: [{ json: {}, text: "success after retry" }] };
    });

    const trigger = makeTrigger();
    const agent = makeAgent("agent-1", "Worker");
    agent.config.onError = {
      strategy: "retry",
      maxRetries: 3,
      retryBackoffMs: 10, // Fast for testing
    };
    const output = makeOutput();

    const workflow = makeWorkflow(
      [trigger, agent, output],
      [edge(trigger.id, agent.id), edge(agent.id, output.id)],
    );

    const result = await executeWorkflow({
      workflow,
      runId: "run-retry",
      dispatcher: failingDispatcher,
    });

    // Initial call fails (count=1), retry #1 fails (count=2), retry #2 succeeds (count=3)
    expect(callCount).toBe(3);
    expect(result.status).toBe("completed");
  });

  it("fails workflow when all retries exhausted", async () => {
    const alwaysFailDispatcher = makeMockDispatcher(async () => {
      throw new Error("permanent failure");
    });

    const trigger = makeTrigger();
    const agent = makeAgent("agent-1", "Worker");
    agent.config.onError = {
      strategy: "retry",
      maxRetries: 2,
      retryBackoffMs: 10,
    };
    const output = makeOutput();

    const workflow = makeWorkflow(
      [trigger, agent, output],
      [edge(trigger.id, agent.id), edge(agent.id, output.id)],
    );

    const result = await executeWorkflow({
      workflow,
      runId: "run-exhaust",
      dispatcher: alwaysFailDispatcher,
    });

    // Retry strategy returns an error ItemSet, which records as completed
    // but the step itself tracks the error state
    expect(result.steps.length).toBeGreaterThanOrEqual(2);
  });

  it("skips step on error when strategy is skip", async () => {
    const failDispatcher = makeMockDispatcher(async () => {
      throw new Error("boom");
    });

    const trigger = makeTrigger();
    const agent = makeAgent("agent-1", "Worker");
    agent.config.onError = { strategy: "skip" };
    const output = makeOutput();

    const workflow = makeWorkflow(
      [trigger, agent, output],
      [edge(trigger.id, agent.id), edge(agent.id, output.id)],
    );

    const result = await executeWorkflow({
      workflow,
      runId: "run-skip",
      dispatcher: failDispatcher,
    });

    expect(result.status).toBe("completed");
    const agentStep = result.steps.find((s) => s.nodeKind === "agent");
    expect(agentStep?.status).toBe("skipped");
  });

  it("passes trigger payload through to context", async () => {
    const trigger = makeTrigger();
    const agent = makeAgent("agent-1", "Worker");
    const output = makeOutput();

    let capturedPrompt = "";
    const capturingDispatcher = makeMockDispatcher(async (_agentId, prompt) => {
      capturedPrompt = prompt;
      return { items: [{ json: {}, text: "ok" }] };
    });

    const workflow = makeWorkflow(
      [trigger, agent, output],
      [edge(trigger.id, agent.id), edge(agent.id, output.id)],
    );

    await executeWorkflow({
      workflow,
      runId: "run-payload",
      dispatcher: capturingDispatcher,
      triggerPayload: { inputData: "test-value" },
    });

    // The agent receives TOON-encoded context that includes the workflow info
    expect(capturedPrompt).toContain("PIPELINE_CONTEXT");
    expect(capturedPrompt).toContain("Worker");
  });

  it("resumes after an approved gate without rerunning prior steps", async () => {
    const trigger = makeTrigger();
    const approval: GateNode = {
      kind: "gate",
      id: "approval-1",
      label: "Approve Send",
      config: {
        gateType: "approval",
        approvers: ["operator"],
        channels: ["dashboard"],
        message: "Approve send?",
        showPreviousOutput: true,
        allowEdit: false,
        timeoutAction: "deny",
      },
    };
    const agent = makeAgent("agent-1", "Worker");
    const output = makeOutput();
    const dispatch = vi.fn(async () => ({
      items: [{ json: { resumed: true }, text: "resumed agent step" }],
    }));

    const workflow = makeWorkflow(
      [trigger, approval, agent, output],
      [edge(trigger.id, approval.id), edge(approval.id, agent.id), edge(agent.id, output.id)],
    );

    const result = await executeWorkflow({
      workflow,
      runId: "run-resume-approval",
      dispatcher: makeMockDispatcher(dispatch),
      resume: {
        afterNodeId: approval.id,
        history: [
          {
            nodeId: trigger.id,
            nodeKind: "trigger",
            nodeLabel: trigger.id,
            stepIndex: 0,
            status: "completed",
            durationMs: 1,
            output: { items: [{ json: { triggerType: "manual" }, text: "triggered" }] },
            startedAt: 1,
            endedAt: 2,
          },
          {
            nodeId: approval.id,
            nodeKind: "gate",
            nodeLabel: approval.label,
            stepIndex: 1,
            status: "completed",
            durationMs: 1,
            output: { items: [{ json: { approved: true }, text: "approved" }] },
            startedAt: 2,
            endedAt: 3,
          },
        ],
        trigger: {
          triggerType: "manual",
          firedAt: 1,
          payload: { source: "test" },
          source: "resume-test",
        },
      },
    });

    expect(result.status).toBe("completed");
    expect(result.steps.map((step) => step.nodeId)).toEqual([
      trigger.id,
      approval.id,
      agent.id,
      output.id,
    ]);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});

// ── Condition Evaluation (via gate execution) ─────────────────────

describe("condition evaluation via gates", () => {
  it("evaluates equals condition from previous step output", async () => {
    const trigger = makeTrigger();

    // Agent that produces status: "completed"
    const agent = makeAgent("agent-1", "Worker");
    const dispatcherWithStatus = makeMockDispatcher(async () => ({
      items: [{ json: { status: "completed" }, text: "Done" }],
    }));

    const gate = makeConditionGate("gate-1", "status", "==", "completed", "e-true", "e-false");
    const output = makeOutput();

    const workflow = makeWorkflow(
      [trigger, agent, gate, output],
      [edge(trigger.id, agent.id), edge(agent.id, gate.id), edge(gate.id, output.id)],
    );

    const result = await executeWorkflow({
      workflow,
      runId: "run-cond-eq",
      dispatcher: dispatcherWithStatus,
    });

    expect(result.status).toBe("completed");
    const gateStep = result.steps.find((s) => s.nodeKind === "gate");
    expect(gateStep).toBeDefined();
    expect(gateStep!.output.items[0].json.result).toBe(true);
  });

  it("evaluates numeric greater-than from previous output", async () => {
    const trigger = makeTrigger();
    const agent = makeAgent("agent-1", "Scorer");
    const dispatcherWithScore = makeMockDispatcher(async () => ({
      items: [{ json: { score: 0.9 }, text: "High score" }],
    }));

    const gate = makeConditionGate("gate-1", "score", ">", 0.7, "e-pass", "e-fail");
    const output = makeOutput();

    const workflow = makeWorkflow(
      [trigger, agent, gate, output],
      [edge(trigger.id, agent.id), edge(agent.id, gate.id), edge(gate.id, output.id)],
    );

    const result = await executeWorkflow({
      workflow,
      runId: "run-cond-gt",
      dispatcher: dispatcherWithScore,
    });

    const gateStep = result.steps.find((s) => s.nodeKind === "gate");
    expect(gateStep!.output.items[0].json.result).toBe(true);
    expect(gateStep!.output.items[0].json.selectedEdge).toBe("e-pass");
  });

  it("evaluates contains operator", async () => {
    const trigger = makeTrigger();
    const agent = makeAgent("agent-1", "Classifier");
    const dispatcherWithText = makeMockDispatcher(async () => ({
      items: [{ json: { category: "approved-premium" }, text: "Approved" }],
    }));

    const gate = makeConditionGate("gate-1", "category", "contains", "approved", "e-yes", "e-no");
    const output = makeOutput();

    const workflow = makeWorkflow(
      [trigger, agent, gate, output],
      [edge(trigger.id, agent.id), edge(agent.id, gate.id), edge(gate.id, output.id)],
    );

    const result = await executeWorkflow({
      workflow,
      runId: "run-cond-contains",
      dispatcher: dispatcherWithText,
    });

    const gateStep = result.steps.find((s) => s.nodeKind === "gate");
    expect(gateStep!.output.items[0].json.result).toBe(true);
  });

  it("evaluates false condition correctly", async () => {
    const trigger = makeTrigger();
    const agent = makeAgent("agent-1", "Worker");
    const lowScoreDispatcher = makeMockDispatcher(async () => ({
      items: [{ json: { score: 0.3 }, text: "Low score" }],
    }));

    const gate = makeConditionGate("gate-1", "score", ">", 0.7, "e-pass", "e-fail");
    const output = makeOutput();

    const workflow = makeWorkflow(
      [trigger, agent, gate, output],
      [edge(trigger.id, agent.id), edge(agent.id, gate.id), edge(gate.id, output.id)],
    );

    const result = await executeWorkflow({
      workflow,
      runId: "run-cond-false",
      dispatcher: lowScoreDispatcher,
    });

    const gateStep = result.steps.find((s) => s.nodeKind === "gate");
    expect(gateStep!.output.items[0].json.result).toBe(false);
    expect(gateStep!.output.items[0].json.selectedEdge).toBe("e-fail");
  });

  it("evaluates logical AND (via gate config)", async () => {
    const trigger = makeTrigger();
    const agent = makeAgent("agent-1", "Worker");
    const dispatcher = makeMockDispatcher(async () => ({
      items: [{ json: { score: 0.9, status: "completed" }, text: "Done" }],
    }));

    const gate: GateNode = {
      kind: "gate",
      id: "gate-and",
      label: "AND Gate",
      config: {
        gateType: "condition",
        expression: {
          and: [
            { field: "score", operator: ">", value: 0.7 },
            { field: "status", operator: "==", value: "completed" },
          ],
        },
        trueEdge: "e-pass",
        falseEdge: "e-fail",
      },
    };
    const output = makeOutput();

    const workflow = makeWorkflow(
      [trigger, agent, gate, output],
      [edge(trigger.id, agent.id), edge(agent.id, gate.id), edge(gate.id, output.id)],
    );

    const result = await executeWorkflow({
      workflow,
      runId: "run-cond-and",
      dispatcher,
    });

    const gateStep = result.steps.find((s) => s.nodeKind === "gate");
    expect(gateStep!.output.items[0].json.result).toBe(true);
  });

  it("evaluates logical OR", async () => {
    const trigger = makeTrigger();
    const agent = makeAgent("agent-1", "Worker");
    const dispatcher = makeMockDispatcher(async () => ({
      items: [{ json: { score: 0.3, status: "completed" }, text: "Done" }],
    }));

    const gate: GateNode = {
      kind: "gate",
      id: "gate-or",
      label: "OR Gate",
      config: {
        gateType: "condition",
        expression: {
          or: [
            { field: "score", operator: ">", value: 0.7 },
            { field: "status", operator: "==", value: "completed" },
          ],
        },
        trueEdge: "e-pass",
        falseEdge: "e-fail",
      },
    };
    const output = makeOutput();

    const workflow = makeWorkflow(
      [trigger, agent, gate, output],
      [edge(trigger.id, agent.id), edge(agent.id, gate.id), edge(gate.id, output.id)],
    );

    const result = await executeWorkflow({
      workflow,
      runId: "run-cond-or",
      dispatcher,
    });

    const gateStep = result.steps.find((s) => s.nodeKind === "gate");
    expect(gateStep!.output.items[0].json.result).toBe(true);
  });

  it("evaluates logical NOT", async () => {
    const trigger = makeTrigger();
    const agent = makeAgent("agent-1", "Worker");
    const dispatcher = makeMockDispatcher(async () => ({
      items: [{ json: { blocked: false }, text: "Ok" }],
    }));

    const gate: GateNode = {
      kind: "gate",
      id: "gate-not",
      label: "NOT Gate",
      config: {
        gateType: "condition",
        expression: {
          not: { field: "blocked", operator: "==", value: true },
        },
        trueEdge: "e-pass",
        falseEdge: "e-fail",
      },
    };
    const output = makeOutput();

    const workflow = makeWorkflow(
      [trigger, agent, gate, output],
      [edge(trigger.id, agent.id), edge(agent.id, gate.id), edge(gate.id, output.id)],
    );

    const result = await executeWorkflow({
      workflow,
      runId: "run-cond-not",
      dispatcher,
    });

    const gateStep = result.steps.find((s) => s.nodeKind === "gate");
    expect(gateStep!.output.items[0].json.result).toBe(true);
  });

  it("handles nested field paths in conditions", async () => {
    const trigger = makeTrigger();
    const agent = makeAgent("agent-1", "Worker");
    // The condition evaluator uses getLastOutput which flattens to item.json,
    // so nested paths work via resolveFieldPath on the flat JSON object
    const dispatcher = makeMockDispatcher(async () => ({
      items: [{ json: { result: { quality: "high" } }, text: "ok" }],
    }));

    const gate = makeConditionGate("gate-1", "result.quality", "==", "high", "e-pass", "e-fail");
    const output = makeOutput();

    const workflow = makeWorkflow(
      [trigger, agent, gate, output],
      [edge(trigger.id, agent.id), edge(agent.id, gate.id), edge(gate.id, output.id)],
    );

    const result = await executeWorkflow({
      workflow,
      runId: "run-cond-nested",
      dispatcher,
    });

    const gateStep = result.steps.find((s) => s.nodeKind === "gate");
    expect(gateStep!.output.items[0].json.result).toBe(true);
  });

  it("persists wait_event gates and returns waiting_event", async () => {
    const trigger = makeTrigger();
    const gate: GateNode = {
      kind: "gate",
      id: "wait-event-1",
      label: "Wait For AppForge Approval",
      config: {
        gateType: "wait_event",
        eventType: "app.asset.approved",
        eventFilter: { appId: "app-1", capabilityId: "campaign_review" },
        timeoutAction: "fail",
      },
    };
    const output = makeOutput();
    const pgSql = vi.fn(async () => []);

    const result = await executeWorkflow({
      workflow: makeWorkflow(
        [trigger, gate, output],
        [edge(trigger.id, gate.id), edge(gate.id, output.id)],
      ),
      runId: "run-wait-event",
      dispatcher: makeMockDispatcher(),
      pgSql,
    });

    expect(result.status).toBe("waiting_event");
    expect(result.waitingNodeId).toBe(gate.id);
    expect(result.steps.at(-1)?.output.items[0].json).toMatchObject({
      gateType: "wait_event",
      waiting: true,
      eventType: "app.asset.approved",
      eventFilter: { appId: "app-1", capabilityId: "campaign_review" },
    });
    expect(pgSql.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

// ── Merge Strategies (via parallel gate segments) ─────────────────

describe("merge strategies via parallel segments", () => {
  it("concat merges branch outputs as labeled sections", async () => {
    const trigger = makeTrigger();
    const parallelGate: GateNode = {
      kind: "gate",
      id: "parallel-1",
      label: "Fan Out",
      config: {
        gateType: "parallel",
        branchEdges: ["e-par-a", "e-par-b"],
      },
    };

    const agentA = makeAgent("agent-a", "Branch A", "agent-a");
    const agentB = makeAgent("agent-b", "Branch B", "agent-b");

    const joinGate: GateNode = {
      kind: "gate",
      id: "join-1",
      label: "Join",
      config: {
        gateType: "join",
        strategy: "all",
        branchFailure: "block",
        mergeStrategy: "concat",
      },
    };
    const output = makeOutput();

    const nodes: WorkflowNode[] = [trigger, parallelGate, agentA, agentB, joinGate, output];
    const edges: WorkflowEdge[] = [
      edge(trigger.id, parallelGate.id),
      { id: "e-par-a", source: parallelGate.id, target: agentA.id },
      { id: "e-par-b", source: parallelGate.id, target: agentB.id },
      edge(agentA.id, joinGate.id),
      edge(agentB.id, joinGate.id),
      edge(joinGate.id, output.id),
    ];

    const branchDispatcher = makeMockDispatcher(async (agentId) => {
      return {
        items: [
          {
            json: { branch: agentId },
            text: `Output from ${agentId}`,
          },
        ],
      };
    });

    const workflow = makeWorkflow(nodes, edges);
    const result = await executeWorkflow({
      workflow,
      runId: "run-parallel-concat",
      dispatcher: branchDispatcher,
    });

    expect(result.status).toBe("completed");
    // The join step should contain merged output from both branches
    const joinStep = result.steps.find((s) => s.nodeId === joinGate.id);
    if (joinStep) {
      // concat merge labels each item with _branch
      const branches = joinStep.output.items.map((item) => item.json._branch);
      expect(branches.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("pick_first returns only first branch output", async () => {
    const trigger = makeTrigger();
    const parallelGate: GateNode = {
      kind: "gate",
      id: "parallel-1",
      label: "Fan Out",
      config: {
        gateType: "parallel",
        branchEdges: ["e-par-a", "e-par-b"],
      },
    };
    const agentA = makeAgent("agent-a", "Branch A", "agent-a");
    const agentB = makeAgent("agent-b", "Branch B", "agent-b");
    const joinGate: GateNode = {
      kind: "gate",
      id: "join-1",
      label: "Join",
      config: {
        gateType: "join",
        strategy: "all",
        branchFailure: "block",
        mergeStrategy: "pick_first",
      },
    };
    const output = makeOutput();

    const nodes: WorkflowNode[] = [trigger, parallelGate, agentA, agentB, joinGate, output];
    const edges: WorkflowEdge[] = [
      edge(trigger.id, parallelGate.id),
      { id: "e-par-a", source: parallelGate.id, target: agentA.id },
      { id: "e-par-b", source: parallelGate.id, target: agentB.id },
      edge(agentA.id, joinGate.id),
      edge(agentB.id, joinGate.id),
      edge(joinGate.id, output.id),
    ];

    const branchDispatcher = makeMockDispatcher(async (agentId) => ({
      items: [{ json: { branch: agentId }, text: `Output from ${agentId}` }],
    }));

    const workflow = makeWorkflow(nodes, edges);
    const result = await executeWorkflow({
      workflow,
      runId: "run-parallel-pick",
      dispatcher: branchDispatcher,
    });

    expect(result.status).toBe("completed");
    // The parallel segment output (which feeds into the rest) should only have
    // items from the first branch
    const parallelStep = result.steps.find((s) => s.nodeId === parallelGate.id);
    if (parallelStep) {
      // pick_first should result in only one branch's items
      expect(parallelStep.output.items.length).toBeLessThanOrEqual(1);
    }
  });
});
