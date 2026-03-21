import { beforeEach, describe, expect, it } from "vitest";
import {
  getSpecforgeGuideStateForTests,
  maybeKickoffSpecforgeFromMessage,
  resetSpecforgeGuideStateForTests,
} from "./specforge-conductor.js";

describe("specforge conductor strict guide mode", () => {
  const base = {
    sessionKey: "agent:argent:main:test",
    agentId: "argent",
  };

  beforeEach(() => {
    resetSpecforgeGuideStateForTests();
  });

  it("starts in project-type gate on kickoff phrases", async () => {
    const result = await maybeKickoffSpecforgeFromMessage({
      ...base,
      message: "I need to build a new coding project",
    });

    expect(result.triggered).toBe(true);
    expect(result.started).toBe(true);
    expect(result.reason).toBe("guide_mode_started_strict");
    expect(result.guidance).toContain("GREENFIELD");
    expect(result.guidance).toContain("BROWNFIELD");
    expect(getSpecforgeGuideStateForTests(base.sessionKey)?.stage).toBe("project_type_gate");
  });

  it("keeps prompting for project type until explicit classification", async () => {
    await maybeKickoffSpecforgeFromMessage({
      ...base,
      message: "We need to build a new application",
    });

    const followUp = await maybeKickoffSpecforgeFromMessage({
      ...base,
      message: "Let's move quickly on this.",
    });

    expect(followUp.triggered).toBe(true);
    expect(followUp.reason).toBe("guide_mode_waiting_for_project_type");
    expect(getSpecforgeGuideStateForTests(base.sessionKey)?.stage).toBe("project_type_gate");
  });

  it("captures brownfield and enforces intake before draft", async () => {
    await maybeKickoffSpecforgeFromMessage({
      ...base,
      message: "I have a coding project for you",
    });

    const classified = await maybeKickoffSpecforgeFromMessage({
      ...base,
      message: "This is brownfield on an existing codebase and we need to add feature support.",
    });
    expect(classified.reason).toBe("guide_mode_project_type_captured");
    expect(classified.guidance).toContain("Because this is brownfield");

    const blockedDraft = await maybeKickoffSpecforgeFromMessage({
      ...base,
      message: "Create the PRD now",
    });
    expect(blockedDraft.reason).toBe("guide_mode_intake_incomplete_for_draft");
    expect(getSpecforgeGuideStateForTests(base.sessionKey)?.stage).toBe("intake_interview");
  });

  it("requires explicit approval before execution stage", async () => {
    await maybeKickoffSpecforgeFromMessage({
      ...base,
      message: "We need to build a new app",
    });
    await maybeKickoffSpecforgeFromMessage({
      ...base,
      message:
        "This is greenfield. Problem: onboarding is slow. Users are operators. Scope includes dashboard + api. Success is reduced setup time. Constraints include two weeks and compliance. Non-scope: mobile apps. Stack is TypeScript + Postgres.",
    });

    const draft = await maybeKickoffSpecforgeFromMessage({
      ...base,
      message: "Please draft PRD",
    });
    expect(draft.reason).toBe("guide_mode_move_to_draft");
    expect(getSpecforgeGuideStateForTests(base.sessionKey)?.stage).toBe("draft_review");

    const awaiting = await maybeKickoffSpecforgeFromMessage({
      ...base,
      message: "Looks good so far",
    });
    expect(awaiting.reason).toBe("guide_mode_waiting_approval");
    expect(getSpecforgeGuideStateForTests(base.sessionKey)?.stage).toBe("awaiting_approval");

    const approved = await maybeKickoffSpecforgeFromMessage({
      ...base,
      message: "Approved, proceed.",
    });
    expect(approved.reason).toBe("guide_mode_approved");
    expect(approved.guidance).toContain("Approval received.");
    expect(getSpecforgeGuideStateForTests(base.sessionKey)?.stage).toBe("approved_execution");
  });

  it("routes request-changes back to intake", async () => {
    await maybeKickoffSpecforgeFromMessage({
      ...base,
      message: "We need to build a new coding project",
    });
    await maybeKickoffSpecforgeFromMessage({
      ...base,
      message:
        "greenfield. problem users scope success constraints non-scope stack are all covered for this effort.",
    });
    await maybeKickoffSpecforgeFromMessage({
      ...base,
      message: "draft prd",
    });
    await maybeKickoffSpecforgeFromMessage({
      ...base,
      message: "continue",
    });

    const changed = await maybeKickoffSpecforgeFromMessage({
      ...base,
      message: "Needs changes before approval.",
    });
    expect(changed.reason).toBe("guide_mode_changes_requested");
    expect(getSpecforgeGuideStateForTests(base.sessionKey)?.stage).toBe("intake_interview");
  });
});
