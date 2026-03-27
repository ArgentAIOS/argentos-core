/**
 * Workflow Types — Basic type guard / instantiation tests.
 *
 * Verifies that the type system compiles correctly and key interfaces
 * can be instantiated with valid data.
 */

import { describe, it, expect } from "vitest";
import type {
  TriggerNode,
  AgentNode,
  ActionNode,
  GateNode,
  OutputNode,
  WorkflowNode,
  WorkflowDefinition,
  WorkflowEdge,
  ItemSet,
  PipelineContext,
  StepRecord,
  ConditionExpr,
  AgentDispatcher,
} from "./workflow-types.js";

describe("workflow-types instantiation", () => {
  it("creates a valid TriggerNode", () => {
    const node: TriggerNode = {
      kind: "trigger",
      id: "t1",
      triggerType: "manual",
      config: {},
    };
    expect(node.kind).toBe("trigger");
    expect(node.triggerType).toBe("manual");
  });

  it("creates a valid AgentNode", () => {
    const node: AgentNode = {
      kind: "agent",
      id: "a1",
      label: "Researcher",
      config: {
        agentId: "agent-research",
        rolePrompt: "You are a research agent.",
        timeoutMs: 60_000,
        evidenceRequired: false,
      },
    };
    expect(node.kind).toBe("agent");
    expect(node.config.agentId).toBe("agent-research");
  });

  it("creates a valid GateNode with condition config", () => {
    const expr: ConditionExpr = { field: "score", operator: ">", value: 0.7 };
    const node: GateNode = {
      kind: "gate",
      id: "g1",
      label: "Quality Check",
      config: { gateType: "condition", expression: expr, trueEdge: "e-pass", falseEdge: "e-fail" },
    };
    expect(node.kind).toBe("gate");
    expect(node.config.gateType).toBe("condition");
  });

  it("creates a valid OutputNode", () => {
    const node: OutputNode = {
      kind: "output",
      id: "o1",
      label: "DocPanel Output",
      config: { outputType: "docpanel", title: "Report" },
    };
    expect(node.kind).toBe("output");
    expect(node.config.outputType).toBe("docpanel");
  });

  it("creates a valid WorkflowDefinition", () => {
    const trigger: TriggerNode = { kind: "trigger", id: "t1", triggerType: "manual", config: {} };
    const output: OutputNode = {
      kind: "output",
      id: "o1",
      label: "Out",
      config: { outputType: "docpanel", title: "Test" },
    };
    const edge: WorkflowEdge = { id: "e1", source: "t1", target: "o1" };
    const def: WorkflowDefinition = {
      id: "wf-1",
      name: "Test Workflow",
      nodes: [trigger, output],
      edges: [edge],
      defaultOnError: { strategy: "fail" },
    };
    expect(def.nodes).toHaveLength(2);
    expect(def.edges).toHaveLength(1);
  });

  it("creates a valid ItemSet", () => {
    const set: ItemSet = {
      items: [{ json: { result: "ok" }, text: "All good" }, { json: { count: 5 } }],
    };
    expect(set.items).toHaveLength(2);
    expect(set.items[0].text).toBe("All good");
  });
});
