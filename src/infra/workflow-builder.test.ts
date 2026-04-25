import { describe, expect, it } from "vitest";
import { draftWorkflowFromIntent } from "./workflow-builder.js";

describe("draftWorkflowFromIntent", () => {
  it("builds an approval-gated marketing workflow from operator intent", () => {
    const draft = draftWorkflowFromIntent({
      intent: "Every morning draft a VIP email alert and send it to me after approval.",
      ownerAgentId: "argent",
      preferredTools: ["email-send"],
      capabilities: [
        {
          name: "email-send",
          label: "Email Send",
          source: "promoted-cli",
        },
      ],
    });

    expect(draft.name).toContain("Every Morning Draft");
    expect(draft.nodes.map((node) => node.type)).toEqual([
      "trigger",
      "agentStep",
      "toolGrant",
      "gate",
      "action",
      "output",
    ]);
    expect(draft.workflow.nodes.map((node) => node.kind)).toEqual([
      "trigger",
      "agent",
      "gate",
      "gate",
      "action",
      "output",
    ]);
    const approval = draft.nodes.find((node) => node.id === "approval");
    expect(approval?.data?.gateType).toBe("approval");
    const agent = draft.workflow.nodes.find((node) => node.kind === "agent");
    expect(agent?.config.toolGrantNodeIds).toEqual(["tool-email-send"]);
    expect(draft.reviewNotes.every((note) => !note.startsWith("Fix before running"))).toBe(true);
  });

  it("keeps read-only research drafts simple and manual by default", () => {
    const draft = draftWorkflowFromIntent({
      intent: "Research competitors and save a concise summary.",
    });

    expect(draft.nodes.map((node) => node.type)).toEqual(["trigger", "agentStep", "output"]);
    expect(draft.workflow.nodes.map((node) => node.kind)).toEqual(["trigger", "agent", "output"]);
    expect(draft.assumptions).toContain("Trigger inferred as manual.");
  });

  it("drafts AppForge review surfaces as workflow capability grants", () => {
    const draft = draftWorkflowFromIntent({
      intent:
        "Draft social posts for the campaign, review them in an AppForge art table, then publish after approval.",
      preferredTools: ["appforge:app-1:campaign-review"],
      capabilities: [
        {
          name: "appforge:app-1:campaign-review",
          label: "Campaign Review Table",
          source: "appforge",
          appId: "app-1",
          appName: "Campaign Review",
          capabilityId: "campaign-review",
          capabilityType: "human_review",
          sideEffect: "operator_interaction",
        },
      ],
    });

    expect(draft.nodes.map((node) => node.id)).toEqual([
      "trigger",
      "agent-draft",
      "tool-appforge-app-1-campaign-review",
      "appforge-review",
      "approval",
      "action-deliver",
      "output",
    ]);
    const grant = draft.nodes.find((node) => node.id === "tool-appforge-app-1-campaign-review");
    expect(grant?.data?.config).toMatchObject({
      grantType: "appforge_app",
      appId: "app-1",
      appCapabilityId: "campaign-review",
      source: "appforge",
    });
    const appReview = draft.nodes.find((node) => node.id === "appforge-review");
    expect(appReview?.data).toMatchObject({
      gateType: "approval",
      reviewSurface: "appforge",
      appId: "app-1",
      appCapabilityName: "appforge:app-1:campaign-review",
    });
    expect(draft.assumptions).toContain(
      "AppForge is used as an operator review surface before delivery.",
    );
  });

  it("drafts AppForge event-triggered workflows from capability metadata", () => {
    const draft = draftWorkflowFromIntent({
      intent: "When the AppForge campaign review app emits an approved review event, summarize it.",
      preferredTools: ["appforge:app-1:campaign-review"],
      capabilities: [
        {
          name: "appforge:app-1:campaign-review",
          label: "Campaign Review",
          source: "appforge",
          appId: "app-1",
          appName: "Campaign Review",
          capabilityId: "campaign-review",
          capabilityType: "trigger",
          eventTypes: ["forge.review.completed"],
        },
      ],
    });

    const trigger = draft.nodes.find((node) => node.id === "trigger");
    expect(trigger?.data).toMatchObject({
      triggerType: "appforge_event",
      appId: "app-1",
      capabilityId: "campaign-review",
      eventType: "forge.review.completed",
    });
    expect(draft.assumptions).toContain(
      "AppForge events start this workflow through the local workflow event bridge.",
    );
  });
});
