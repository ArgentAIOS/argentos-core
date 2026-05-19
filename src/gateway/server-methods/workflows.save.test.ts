import { describe, expect, it } from "vitest";
import {
  evaluatePromoteToLiveSafety,
  normalizeWorkflow,
  type WorkflowNormalizationInput,
} from "../../infra/workflow-normalize.js";

/**
 * Coverage for the promote-to-live safety re-validation surfaced by the
 * 2026-05-13 workflows audit (argent-core #350). The save handler
 * (`workflows.update`) calls `evaluatePromoteToLiveSafety` whenever a request
 * transitions a workflow's `deploymentStage` from a non-live value to "live".
 *
 * These tests cover the four behaviours documented in the issue:
 *   1. draft → live with an unsafe side-effect node and no approval gate
 *      is rejected with `unsafe_side_effect_without_approval`.
 *   2. draft → live with an approval gate upstream of the side-effect succeeds.
 *   3. live → live re-saves do not re-run promote-to-live validation
 *      (existing behaviour preserved).
 *   4. non-live → non-live saves do not re-run promote-to-live validation
 *      (existing behaviour preserved).
 */

const TRIGGER_NODE = {
  id: "trigger",
  type: "trigger",
  data: { triggerType: "manual" as const },
};

const SEND_MESSAGE_NODE = {
  id: "send-alert",
  type: "action",
  data: {
    actionType: "send_message",
    config: { channelType: "telegram", channelId: "operator", template: "Hi" },
  },
};

const APPROVAL_GATE_NODE = {
  id: "approval",
  type: "gate",
  data: {
    label: "Approve send",
    config: { gateType: "approval", message: "Send Telegram alert?" },
  },
};

function buildWorkflow(input: WorkflowNormalizationInput) {
  // We always normalize with the stored stage so that `normalizeWorkflow`
  // itself does not eagerly reject the draft. The promote-to-live check is
  // what we want to exercise — not the static normalize-time validation.
  const result = normalizeWorkflow(input);
  return result.workflow;
}

describe("workflows.update — promote-to-live safety re-validation (#350)", () => {
  it("rejects draft → live promote when an unsafe side-effect lacks an approval gate", () => {
    const workflow = buildWorkflow({
      id: "wf-unsafe-promote",
      name: "Unsafe alert",
      deploymentStage: "simulate",
      nodes: [TRIGGER_NODE, SEND_MESSAGE_NODE],
      edges: [{ id: "e1", source: "trigger", target: "send-alert" }],
    });

    const safety = evaluatePromoteToLiveSafety(workflow, {
      previousStage: "simulate",
      nextStage: "live",
    });

    expect(safety.promoting).toBe(true);
    expect(safety.ok).toBe(false);
    expect(safety.blockingIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          code: "unsafe_side_effect_without_approval",
          nodeId: "send-alert",
        }),
      ]),
    );
    // The result must include the issues array so the dashboard can render
    // them inline on the save-failed surface.
    expect(safety.liveIssues.length).toBeGreaterThanOrEqual(safety.blockingIssues.length);
  });

  it("accepts draft → live promote when the unsafe side-effect sits behind an approval gate", () => {
    const workflow = buildWorkflow({
      id: "wf-safe-promote",
      name: "Approved alert",
      deploymentStage: "simulate",
      nodes: [TRIGGER_NODE, APPROVAL_GATE_NODE, SEND_MESSAGE_NODE],
      edges: [
        { id: "e1", source: "trigger", target: "approval" },
        { id: "e2", source: "approval", target: "send-alert" },
      ],
    });

    const safety = evaluatePromoteToLiveSafety(workflow, {
      previousStage: "simulate",
      nextStage: "live",
    });

    expect(safety.promoting).toBe(true);
    expect(safety.ok).toBe(true);
    expect(safety.blockingIssues).toEqual([]);
  });

  it("preserves existing behaviour when re-saving an already-live workflow (live → live)", () => {
    // An already-live workflow can in principle still carry old validation
    // issues, but the promote-to-live re-validation must NOT trigger on a
    // non-transition save. The legacy `normalizeWorkflow` flow still runs
    // for the actual persistence — only the new gate is bypassed here.
    const workflow = buildWorkflow({
      id: "wf-live-resave",
      name: "Live re-save",
      deploymentStage: "live",
      nodes: [TRIGGER_NODE, SEND_MESSAGE_NODE],
      edges: [{ id: "e1", source: "trigger", target: "send-alert" }],
    });

    const safety = evaluatePromoteToLiveSafety(workflow, {
      previousStage: "live",
      nextStage: "live",
    });

    expect(safety.promoting).toBe(false);
    expect(safety.ok).toBe(true);
    expect(safety.blockingIssues).toEqual([]);
    expect(safety.liveIssues).toEqual([]);
  });

  it("preserves existing behaviour when a draft is saved as draft (no stage change)", () => {
    const workflow = buildWorkflow({
      id: "wf-draft-resave",
      name: "Draft re-save",
      deploymentStage: "simulate",
      nodes: [TRIGGER_NODE, SEND_MESSAGE_NODE],
      edges: [{ id: "e1", source: "trigger", target: "send-alert" }],
    });

    const safety = evaluatePromoteToLiveSafety(workflow, {
      previousStage: "simulate",
      nextStage: "simulate",
    });

    expect(safety.promoting).toBe(false);
    expect(safety.ok).toBe(true);
    expect(safety.blockingIssues).toEqual([]);
    expect(safety.liveIssues).toEqual([]);
  });

  it("defaults `nextStage` from the workflow's own deploymentStage when unspecified", () => {
    const workflow = buildWorkflow({
      id: "wf-default-next",
      name: "Default next",
      deploymentStage: "live",
      nodes: [TRIGGER_NODE, SEND_MESSAGE_NODE],
      edges: [{ id: "e1", source: "trigger", target: "send-alert" }],
    });

    // Caller passes `previousStage` only — `nextStage` falls back to
    // workflow.deploymentStage === "live", so the gate must fire and reject.
    const safety = evaluatePromoteToLiveSafety(workflow, { previousStage: "simulate" });

    expect(safety.promoting).toBe(true);
    expect(safety.ok).toBe(false);
    expect(
      safety.blockingIssues.some((i) => i.code === "unsafe_side_effect_without_approval"),
    ).toBe(true);
  });
});
