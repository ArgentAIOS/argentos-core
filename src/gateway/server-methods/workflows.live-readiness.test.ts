import { describe, expect, it, vi } from "vitest";
import type { WorkflowRow } from "../../infra/workflow-execution-service.js";
import { evaluateWorkflowLiveRunGate, workflowRowWithCanvasOverride } from "./workflows.js";

vi.mock("../../data/redis-client.js", () => ({ refreshPresence: vi.fn() }));
vi.mock("../../logging/subsystem.js", () => ({
  createSubsystemLogger: () => {
    const logger = {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      child: vi.fn(),
    };
    logger.child.mockReturnValue(logger);
    return logger;
  },
}));

const blockedImportReport = {
  packageName: "Daily Marketing Brief",
  packageSlug: "daily-marketing-brief",
  liveReadiness: {
    okForLive: false,
    status: "canary_required",
    reasons: [
      {
        code: "canary_required",
        id: "daily-marketing-brief",
        message: "A gated live canary is required before this template can be marked live-ready.",
      },
    ],
  },
  requirements: [
    {
      key: "credential:slack.primary",
      id: "slack.primary",
      label: "Slack bot token",
      requiredForLive: true,
    },
  ],
  bindings: {},
};

describe("workflow live-readiness run gating", () => {
  it("blocks live imported workflow runs until bindings and canary readiness are proven", () => {
    const gate = evaluateWorkflowLiveRunGate({
      deploymentStage: "live",
      importReport: blockedImportReport,
    });

    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.codes).toEqual(
        expect.arrayContaining(["missing_live_bindings", "canary_required"]),
      );
      expect(gate.message).toContain("Live workflow run blocked");
    }
  });

  it("does not block fixture-mode runs for imported templates", () => {
    expect(
      evaluateWorkflowLiveRunGate({
        deploymentStage: "simulate",
        importReport: blockedImportReport,
      }),
    ).toEqual({ ok: true });
  });

  it("allows live runs only when readiness and required bindings are complete", () => {
    expect(
      evaluateWorkflowLiveRunGate({
        deploymentStage: "live",
        importReport: {
          ...blockedImportReport,
          liveReadiness: { okForLive: true, status: "live_ready", reasons: [] },
          bindings: { "credential:slack.primary": { value: "secret://slack" } },
        },
      }),
    ).toEqual({ ok: true });
  });

  it("preserves imported readiness metadata when run requests send a canvas override", () => {
    const row = {
      id: "wf-imported",
      name: "Imported template",
      version: 1,
      deployment_stage: "live",
      nodes: [
        {
          id: "trigger",
          type: "trigger",
          position: { x: 0, y: 0 },
          data: { triggerType: "manual" },
        },
      ],
      edges: [],
      canvas_layout: {
        nodes: [
          {
            id: "trigger",
            type: "trigger",
            position: { x: 0, y: 0 },
            data: { triggerType: "manual" },
          },
        ],
        edges: [],
        importReport: blockedImportReport,
      },
    } satisfies WorkflowRow;

    const next = workflowRowWithCanvasOverride(row, {
      deploymentStage: "live",
      canvasData: { nodes: row.nodes, edges: row.edges },
    });

    expect(
      (next.canvas_layout as { importReport?: { packageSlug?: string } }).importReport,
    ).toEqual(expect.objectContaining({ packageSlug: "daily-marketing-brief" }));
  });
});
