import { describe, expect, it } from "vitest";
import {
  collectAppForgeWorkflowCapabilities,
  extractAppForgeWorkflowCapabilities,
} from "./appforge-workflow-capabilities.js";

describe("AppForge workflow capabilities", () => {
  it("extracts workflow capabilities from AppForge app metadata", () => {
    const capabilities = extractAppForgeWorkflowCapabilities({
      id: "app-1",
      name: "Campaign Review Table",
      description: "Review generated campaign assets.",
      version: 2,
      metadata: {
        workflowCapabilities: [
          {
            id: "review",
            label: "Review Campaign Assets",
            type: "human_review",
            sideEffect: "operator_interaction",
            inputs: ["drafts", "assets"],
            outputs: ["approvedItems", "edits", "decision"],
            eventTypes: ["app.asset.approved", "app.asset.denied"],
            openMode: "window",
          },
          {
            id: "publish",
            label: "Publish Selected Assets",
            type: "action",
            sideEffect: "outbound_delivery",
            inputs: ["approvedItems"],
            outputs: ["publishedUrls"],
          },
        ],
      },
    });

    expect(capabilities).toHaveLength(2);
    expect(capabilities[0]).toMatchObject({
      name: "appforge:app-1:review",
      label: "Review Campaign Assets",
      source: "appforge",
      appId: "app-1",
      appName: "Campaign Review Table",
      appVersion: 2,
      capabilityType: "human_review",
      sideEffect: "operator_interaction",
      inputs: ["drafts", "assets"],
      outputs: ["approvedItems", "edits", "decision"],
      eventTypes: ["app.asset.approved", "app.asset.denied"],
      openMode: "window",
      governance: {
        mode: "allow",
        approvalBacked: false,
      },
    });
    expect(capabilities[1]).toMatchObject({
      name: "appforge:app-1:publish",
      sideEffect: "outbound_delivery",
      governance: {
        mode: "ask",
        approvalBacked: true,
      },
    });
  });

  it("merges all supported metadata paths and sorts by app then capability label", () => {
    const capabilities = collectAppForgeWorkflowCapabilities([
      {
        id: "z-app",
        name: "Zeta",
        metadata: {
          workflowCapabilities: [{ id: "root", label: "Root" }],
          workflow: {
            capabilities: [{ id: "view", label: "View" }],
          },
          appForge: {
            workflowCapabilities: [{ id: "nested", label: "Nested" }],
          },
        },
      },
      {
        id: "a-app",
        name: "Alpha",
        metadata: {
          appForge: {
            workflowCapabilities: [{ id: "approve", label: "Approve" }],
          },
        },
      },
      {
        id: "none",
        name: "No Capabilities",
        metadata: {},
      },
    ]);

    expect(capabilities.map((capability) => capability.name)).toEqual([
      "appforge:a-app:approve",
      "appforge:z-app:nested",
      "appforge:z-app:root",
      "appforge:z-app:view",
    ]);
  });
});
