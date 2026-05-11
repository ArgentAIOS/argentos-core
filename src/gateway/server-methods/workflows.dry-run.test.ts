import { describe, expect, it, vi } from "vitest";
import type { GatewayRequestHandlerOptions } from "./types.js";
import {
  buildWorkflowAgentSessionKey,
  validateWorkflowAgentSessionIdentity,
} from "../../infra/workflow-runner.js";
import { listGatewayMethods } from "../server-methods-list.js";
import {
  buildMorningBriefDryRunRecipe,
  buildMorningBriefDryRunRecipeParams,
} from "./workflows.dry-run-recipes.js";
import { workflowsHandlers } from "./workflows.js";

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

async function callDryRun(params: Record<string, unknown>) {
  const respond = vi.fn();
  await workflowsHandlers["workflows.dryRun"]({
    params,
    respond,
  } as unknown as GatewayRequestHandlerOptions);
  return respond.mock.calls[0] as [boolean, unknown, unknown?];
}

describe("workflow dry run", () => {
  it("is available through gateway method discovery for local operator proof", () => {
    expect(listGatewayMethods()).toContain("workflows.dryRun");
  });

  it("preflights agent dispatch identity without live execution", async () => {
    const [ok, payload, error] = await callDryRun({
      name: "AI Morning Brief Podcast Workflow",
      canvasData: {
        nodes: [
          {
            id: "trigger",
            type: "trigger",
            position: { x: 0, y: 0 },
            data: { label: "Schedule", triggerType: "schedule", cronExpression: "30 6 * * *" },
          },
          {
            id: "agent-draft",
            type: "agent",
            position: { x: 220, y: 0 },
            data: {
              label: "Agent Step",
              agentId: "argent",
              rolePrompt: "Build the cited morning brief.",
              timeout: 120,
              evidenceRequired: true,
            },
          },
        ],
        edges: [{ id: "trigger-agent-draft", source: "trigger", target: "agent-draft" }],
      },
    });

    expect(ok).toBe(true);
    expect(error).toBeUndefined();
    expect(payload).toMatchObject({ ok: true });
    expect(
      (payload as { steps: Array<{ nodeId: string; status: string; message: string }> }).steps,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: "agent-draft",
          status: "passed",
          message: expect.stringContaining("can dispatch"),
        }),
      ]),
    );
  });

  it("provides a Morning Brief recipe that passes workflows.dryRun without PostgreSQL", async () => {
    const recipe = buildMorningBriefDryRunRecipe();
    const params = buildMorningBriefDryRunRecipeParams();

    expect(recipe).toMatchObject({
      slug: "ai-morning-brief-podcast",
      safety: {
        requiresPostgres: false,
        noLiveConnectorExecution: true,
        noCustomerData: true,
        noChannelDelivery: true,
      },
    });
    expect(recipe.command).toContain("workflows.dryRun");
    expect(params.deploymentStage).toBe("simulate");
    expect(params.definition.nodes).toHaveLength(12);

    const [ok, payload, error] = await callDryRun(params as unknown as Record<string, unknown>);
    expect(ok).toBe(true);
    expect(error).toBeUndefined();
    expect(payload).toMatchObject({ ok: true });
    expect(
      (payload as { steps: Array<{ nodeId: string; status: string; message: string }> }).steps,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: "__graph__",
          status: "passed",
          message: "Graph sorts into 12 executable nodes.",
        }),
        expect.objectContaining({ nodeId: "github-scout", status: "passed" }),
        expect.objectContaining({ nodeId: "synthesize-brief", status: "passed" }),
        expect.objectContaining({ nodeId: "brief-doc", status: "passed" }),
        expect.objectContaining({ nodeId: "podcast-plan", status: "passed" }),
        expect.objectContaining({ nodeId: "approve-podcast-render", status: "passed" }),
        expect.objectContaining({ nodeId: "podcast-generate", status: "passed" }),
        expect.objectContaining({ nodeId: "delivery-status", status: "passed" }),
        expect.objectContaining({ nodeId: "run-ledger", status: "passed" }),
      ]),
    );
  });

  it("flags the old workflow session key shape that resolved to main", () => {
    const oldSessionKey = "workflow:argent:1777376841233";
    expect(validateWorkflowAgentSessionIdentity("argent", oldSessionKey)).toMatchObject({
      ok: false,
      sessionAgentId: "main",
      message: 'Agent id "argent" does not match session key agent "main".',
    });

    const nextSessionKey = buildWorkflowAgentSessionKey("argent", 1777376841233);
    expect(validateWorkflowAgentSessionIdentity("argent", nextSessionKey)).toMatchObject({
      ok: true,
      sessionAgentId: "argent",
    });
  });
});
