import { describe, expect, it } from "vitest";
import type { WorkflowDefinition } from "./workflow-types.js";
import { normalizeWorkflow, validateWorkflow } from "./workflow-normalize.js";

describe("workflow action capabilities", () => {
  it("preserves canonical action objects instead of remapping them to api_call", () => {
    const normalized = normalizeWorkflow({
      id: "wf-action-object",
      name: "Action Object",
      deploymentStage: "simulate",
      nodes: [
        {
          id: "trigger",
          type: "trigger",
          data: { triggerType: "manual" },
        },
        {
          id: "podcast-plan",
          type: "action",
          data: {
            label: "Podcast Plan",
            config: {
              actionType: {
                type: "podcast_plan",
                title: "AI Morning Brief",
                script: "ARGENT: [warm] Good morning.",
                personas: [{ id: "argent", voice_id: "voice-1" }],
              },
            },
          },
        },
      ],
      edges: [{ id: "e1", source: "trigger", target: "podcast-plan" }],
    });

    const action = normalized.workflow.nodes.find((node) => node.id === "podcast-plan");
    expect(action?.kind).toBe("action");
    if (action?.kind !== "action") {
      return;
    }
    expect(action.config.actionType.type).toBe("podcast_plan");
    expect(normalized.issues).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "action_type_mapped_to_api_call" })]),
    );
  });

  it("adds operator-action metadata to live approval blockers", () => {
    const workflow: WorkflowDefinition = {
      id: "wf-approval-metadata",
      name: "Approval Metadata",
      defaultOnError: { strategy: "fail" },
      nodes: [
        { kind: "trigger", id: "trigger", triggerType: "manual", config: {} },
        {
          kind: "action",
          id: "podcast-generate",
          label: "Podcast Generate",
          config: {
            actionType: {
              type: "podcast_generate",
              title: "AI Morning Brief",
              payload: { dialogue: [{ text: "hello", voice_id: "voice-1" }] },
            },
          },
        },
      ],
      edges: [{ id: "e1", source: "trigger", target: "podcast-generate" }],
    };

    expect(validateWorkflow(workflow, "live")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unsafe_side_effect_without_approval",
          nodeId: "podcast-generate",
          category: "approval",
          requiresOperatorApproval: true,
          capabilityId: "podcast_generate",
        }),
      ]),
    );
  });

  it("accepts explicit operator sign-off for a live side-effect action", () => {
    const workflow: WorkflowDefinition = {
      id: "wf-operator-signed",
      name: "Operator Signed",
      defaultOnError: { strategy: "fail" },
      nodes: [
        { kind: "trigger", id: "trigger", triggerType: "manual", config: {} },
        {
          kind: "action",
          id: "podcast-generate",
          label: "Podcast Generate",
          config: {
            operatorApprovedLive: true,
            operatorApprovedAt: "2026-04-28T12:00:00.000Z",
            actionType: {
              type: "podcast_generate",
              title: "AI Morning Brief",
              payload: { dialogue: [{ text: "hello", voice_id: "voice-1" }] },
            },
          },
        },
      ],
      edges: [{ id: "e1", source: "trigger", target: "podcast-generate" }],
    };

    expect(validateWorkflow(workflow, "live")).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unsafe_side_effect_without_approval",
          nodeId: "podcast-generate",
        }),
      ]),
    );
  });
});
