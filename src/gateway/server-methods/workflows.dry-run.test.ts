import { describe, expect, it, vi } from "vitest";
import type { GatewayRequestHandlerOptions } from "./types.js";
import {
  buildWorkflowAgentSessionKey,
  validateWorkflowAgentSessionIdentity,
} from "../../infra/workflow-runner.js";
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
