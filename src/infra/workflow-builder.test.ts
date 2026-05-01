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

  it("expands explicit scout lanes into visible workflow agent nodes", () => {
    const draft = draftWorkflowFromIntent({
      name: "AI Morning Brief — Three-Scout Research Pipeline",
      intent:
        "Run daily at 9 AM Central. Create three separate scout research agent lanes: GitHub/open-source projects, frontier AI movers, and thought-leader/infrastructure signals. Then synthesize the findings, generate a podcast audio artifact, deliver the status, and save the cited brief to DocPanel.",
      triggerType: "schedule",
      scheduleCron: "0 9 * * *",
      timezone: "America/Chicago",
      ownerAgentId: "argent",
      preferredTools: ["web_search", "web_fetch", "doc_panel", "podcast_generate", "send_payload"],
    });

    const agentNodes = draft.nodes.filter((node) => node.type === "agentStep");
    expect(agentNodes.map((node) => node.data?.label)).toEqual([
      "GitHub / Open Source Scout",
      "Frontier AI Scout",
      "Thought Leader / Infrastructure Scout",
      "Synthesis Agent",
      "Podcast Script Agent",
    ]);
    expect(draft.nodes.map((node) => node.id)).toEqual([
      "trigger",
      "scout-github-open-source",
      "scout-frontier-ai",
      "scout-thought-leader-infrastructure",
      "research-join",
      "synthesis-agent",
      "brief-output",
      "podcast-script-agent",
      "podcast-plan",
      "podcast-generate",
      "delivery-status",
      "run-ledger",
    ]);
    expect(draft.workflow.nodes.map((node) => node.kind)).toEqual([
      "trigger",
      "agent",
      "agent",
      "agent",
      "gate",
      "agent",
      "output",
      "agent",
      "action",
      "action",
      "action",
      "output",
    ]);
    expect(draft.workflow.nodes.filter((node) => node.kind === "trigger")).toHaveLength(1);
    expect(draft.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "trigger", target: "scout-github-open-source" }),
        expect.objectContaining({ source: "trigger", target: "scout-frontier-ai" }),
        expect.objectContaining({
          source: "trigger",
          target: "scout-thought-leader-infrastructure",
        }),
        expect.objectContaining({ source: "research-join", target: "synthesis-agent" }),
        expect.objectContaining({ source: "synthesis-agent", target: "brief-output" }),
        expect.objectContaining({ source: "brief-output", target: "podcast-script-agent" }),
        expect.objectContaining({ source: "podcast-script-agent", target: "podcast-plan" }),
        expect.objectContaining({ source: "podcast-plan", target: "podcast-generate" }),
        expect.objectContaining({ source: "podcast-generate", target: "delivery-status" }),
        expect.objectContaining({ source: "delivery-status", target: "run-ledger" }),
      ]),
    );
    const delivery = draft.workflow.nodes.find((node) => node.id === "delivery-status");
    expect(delivery?.kind).toBe("action");
    if (delivery?.kind === "action") {
      expect(delivery.config.actionType).toMatchObject({
        type: "send_message",
        mediaTemplate: "{{previous.json.path}}",
      });
    }
    expect(draft.assumptions).toContain(
      "Explicit scout/lane language expanded into visible workflow agent nodes.",
    );
    expect(draft.reviewNotes.every((note) => !note.startsWith("Fix before running"))).toBe(true);
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
