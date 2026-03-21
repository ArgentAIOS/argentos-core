import { describe, expect, it } from "vitest";
import { validateToolClaims } from "./tool-claim-validation.js";

describe("validateToolClaims", () => {
  it("passes when episode tools_used matches executed tools", () => {
    const responseText = `
[EPISODE_JSON]
{
  "tools_used": [
    { "tool": "web_search" },
    { "tool": "doc_panel" }
  ]
}
[/EPISODE_JSON]
`;
    const result = validateToolClaims({
      responseText,
      executedToolNames: ["web_search", "doc_panel"],
    });
    expect(result.valid).toBe(true);
    expect(result.missingClaims).toEqual([]);
    expect(result.hasExternalArtifact).toBe(true);
  });

  it("flags mismatch when response claims tool use but no tool executed", () => {
    const result = validateToolClaims({
      responseText: "I used web_search and web_fetch, then posted to doc_panel.",
      executedToolNames: [],
    });
    expect(result.valid).toBe(false);
    expect(result.missingClaims).toEqual(["web_search", "web_fetch", "doc_panel"]);
  });

  it("treats successful messaging sends as executed message tool", () => {
    const result = validateToolClaims({
      responseText: "I sent that update with message.",
      executedToolNames: [],
      didSendViaMessagingTool: true,
    });
    expect(result.valid).toBe(true);
    expect(result.executedTools).toContain("message");
    expect(result.hasExternalArtifact).toBe(true);
  });

  it("does not flag plain narrative text without explicit tool claim", () => {
    const result = validateToolClaims({
      responseText: "I can look that up if you want.",
      executedToolNames: [],
    });
    expect(result.valid).toBe(true);
    expect(result.claimedTools).toEqual([]);
  });

  // ── False-positive resistance ────────────────────────────────────────

  it("does not flag narrative mentions of past tool use from earlier turns", () => {
    // The model is describing what happened previously, not claiming current execution.
    const result = validateToolClaims({
      responseText:
        "Earlier in our conversation, you mentioned wanting a web search. " +
        "The doc panel can display results nicely. " +
        "Let me know if you'd like me to help.",
      executedToolNames: [],
    });
    expect(result.valid).toBe(true);
    expect(result.claimedTools).toEqual([]);
  });

  it("does not flag conditional/future-tense offers to use tools", () => {
    const result = validateToolClaims({
      responseText:
        "If you'd like, I could search the web for that. " +
        "I can also update the doc panel with the results.",
      executedToolNames: [],
    });
    expect(result.valid).toBe(true);
    expect(result.claimedTools).toEqual([]);
  });

  it("does not flag rhetorical 'open' phrasing as a research commitment", () => {
    const result = validateToolClaims({
      responseText: "I'll open with the short version.",
      executedToolNames: [],
    });
    expect(result.valid).toBe(true);
    expect(result.missingCommitments).toEqual([]);
  });

  it("does not flag rhetorical 'read this as' phrasing as research", () => {
    const result = validateToolClaims({
      responseText: "I'll read this as a warning, not a rejection.",
      executedToolNames: [],
    });
    expect(result.valid).toBe(true);
    expect(result.missingCommitments).toEqual([]);
  });

  it("does not flag generic 'writing this out clearly' prose as planning", () => {
    const result = validateToolClaims({
      responseText: "I'm writing this out clearly so the point lands.",
      executedToolNames: [],
    });
    expect(result.valid).toBe(true);
    expect(result.missingCommitments).toEqual([]);
  });

  it("flags inspect/map/produce-spec claims without execution evidence", () => {
    const result = validateToolClaims({
      responseText:
        "I’m going to inspect the family communication path over Redis, map the exact files and message schemas we’d need to touch, and produce a concrete migration spec for introducing TOON into ArgentOS.",
      executedToolNames: [],
    });
    expect(result.valid).toBe(false);
    expect(result.missingCommitments.map((entry) => entry.kind)).toEqual(
      expect.arrayContaining(["research", "planning"]),
    );
  });

  it("flags in-progress migration-doc claims without same-turn evidence", () => {
    const result = validateToolClaims({
      responseText:
        "I’m in progress on it now and I’ll post the completed migration doc as soon as it’s written.",
      executedToolNames: [],
    });
    expect(result.valid).toBe(false);
    expect(result.missingCommitments.map((entry) => entry.kind)).toContain("progress");
    expect(result.missingClaimLabels).toContain("active work claim");
  });

  it("flags in-progress migration-doc claims when only a message tool ran", () => {
    const result = validateToolClaims({
      responseText:
        "I’m in progress on it now and I’ll post the completed migration doc as soon as it’s written.",
      executedToolNames: ["message"],
    });
    expect(result.valid).toBe(false);
    expect(result.missingCommitments.map((entry) => entry.kind)).toContain("progress");
  });

  it("flags in-progress migration-doc claims when only memory_store ran", () => {
    const result = validateToolClaims({
      responseText:
        "I’m in progress on it now and I’ll post the completed migration doc as soon as it’s written.",
      executedToolNames: ["memory_store"],
    });
    expect(result.valid).toBe(false);
    expect(result.missingCommitments.map((entry) => entry.kind)).toContain("progress");
  });

  it("passes in-progress migration-doc claims when read and doc_panel_update both execute", () => {
    const result = validateToolClaims({
      responseText:
        "I’m in progress on it now and I’ll post the completed migration doc as soon as it’s written.",
      executedToolNames: ["read", "doc_panel_update"],
    });
    expect(result.valid).toBe(true);
    expect(result.missingCommitments).toEqual([]);
    expect(result.evidenceKinds).toEqual(expect.arrayContaining(["research", "planning"]));
    expect(result.evidenceTools).not.toContain("message");
  });

  it("flags memory commitments without a matching memory tool", () => {
    const result = validateToolClaims({
      responseText: "I'm saving this to memory now.",
      executedToolNames: [],
    });
    expect(result.valid).toBe(false);
    expect(result.missingCommitments).toHaveLength(1);
    expect(result.missingCommitments[0]?.kind).toBe("memory");
    expect(result.missingClaimLabels).toContain("memory action");
  });

  it("passes memory commitments when a memory tool executes", () => {
    const result = validateToolClaims({
      responseText: "I'm saving this to memory now.",
      executedToolNames: ["memory_store"],
    });
    expect(result.valid).toBe(true);
    expect(result.missingCommitments).toEqual([]);
    expect(result.evidenceKinds).toContain("memory");
  });

  it("flags research commitments without matching evidence", () => {
    const result = validateToolClaims({
      responseText: "I'm going to do some research for this and check the docs.",
      executedToolNames: [],
    });
    expect(result.valid).toBe(false);
    expect(result.missingCommitments[0]?.kind).toBe("research");
    expect(result.missingClaimLabels).toContain("research action");
  });

  it("flags shorthand research action claims without matching evidence", () => {
    const result = validateToolClaims({
      responseText: "Pulling the text now.",
      executedToolNames: [],
    });
    expect(result.valid).toBe(false);
    expect(result.missingCommitments.map((entry) => entry.kind)).toContain("research");
    expect(result.missingClaimLabels).toContain("research action");
  });

  it("passes shorthand research action claims when a research tool executes", () => {
    const result = validateToolClaims({
      responseText: "Pulling the text now.",
      executedToolNames: ["web_fetch"],
    });
    expect(result.valid).toBe(true);
    expect(result.missingCommitments).toEqual([]);
    expect(result.evidenceKinds).toContain("research");
  });

  it("flags short active-work claims without same-turn evidence", () => {
    const result = validateToolClaims({
      responseText: "I'm on it.",
      executedToolNames: [],
    });
    expect(result.valid).toBe(false);
    expect(result.missingCommitments.map((entry) => entry.kind)).toContain("progress");
    expect(result.missingClaimLabels).toContain("active work claim");
  });

  it("passes short active-work claims when same-turn tool evidence exists", () => {
    const result = validateToolClaims({
      responseText: "I'm on it.",
      executedToolNames: ["web_fetch"],
    });
    expect(result.valid).toBe(true);
    expect(result.missingCommitments).toEqual([]);
    expect(result.evidenceKinds).toContain("research");
  });

  it("accepts repo or docs inspection as research evidence", () => {
    const result = validateToolClaims({
      responseText: "I'm going to do some research for this and check the docs.",
      executedToolNames: ["read"],
    });
    expect(result.valid).toBe(true);
    expect(result.missingCommitments).toEqual([]);
    expect(result.evidenceKinds).toContain("research");
    expect(result.evidenceTools).toContain("read");
  });

  it("does not treat exec by itself as research evidence", () => {
    const result = validateToolClaims({
      responseText: "I'm going to do some research for this and check the docs.",
      executedToolNames: ["exec"],
    });
    expect(result.valid).toBe(false);
    expect(result.missingCommitments[0]?.kind).toBe("research");
  });

  it("does not treat process by itself as research evidence", () => {
    const result = validateToolClaims({
      responseText: "I'm going to do some research for this and check the docs.",
      executedToolNames: ["process"],
    });
    expect(result.valid).toBe(false);
    expect(result.missingCommitments[0]?.kind).toBe("research");
  });

  it("flags planning commitments that do not create a doc artifact", () => {
    const result = validateToolClaims({
      responseText:
        "Next thing I’m doing is turning this into one merged execution track with explicit critical-path cuts.",
      executedToolNames: [],
    });
    expect(result.valid).toBe(false);
    expect(result.missingCommitments[0]?.kind).toBe("planning");
    expect(result.missingClaimLabels).toContain("planning artifact");
  });

  it("passes planning commitments when doc_panel_update executes", () => {
    const result = validateToolClaims({
      responseText: "I'm writing this out as the execution plan now.",
      executedToolNames: ["doc_panel_update"],
    });
    expect(result.valid).toBe(true);
    expect(result.missingCommitments).toEqual([]);
    expect(result.evidenceKinds).toContain("planning");
  });

  it("passes inspect/map/produce-spec claims when read and doc_panel_update both execute", () => {
    const result = validateToolClaims({
      responseText:
        "I’m going to inspect the family communication path over Redis, map the exact files and message schemas we’d need to touch, and produce a concrete migration spec for introducing TOON into ArgentOS.",
      executedToolNames: ["read", "doc_panel_update"],
    });
    expect(result.valid).toBe(true);
    expect(result.missingCommitments).toEqual([]);
    expect(result.evidenceKinds).toEqual(expect.arrayContaining(["research", "planning"]));
  });

  it("passes clarification commitments when concrete questions are asked", () => {
    const result = validateToolClaims({
      responseText:
        "I need 3 answers before I can act.\n1. What is the target outcome?\n2. Which repo should I use?\n3. When do you need it shipped?",
      executedToolNames: [],
    });
    expect(result.valid).toBe(true);
    expect(result.missingCommitments).toEqual([]);
    expect(result.questionsAsked).toHaveLength(3);
    expect(result.evidenceKinds).toContain("questions");
  });

  it("flags clarification commitments that do not ask the questions", () => {
    const result = validateToolClaims({
      responseText: "I need 3 answers before I can act.",
      executedToolNames: [],
    });
    expect(result.valid).toBe(false);
    expect(result.missingCommitments[0]?.kind).toBe("clarification");
    expect(result.missingClaimLabels).toContain("clarification questions");
  });

  it("flags blocked-task cleanup result claims when tasks ran without outcome evidence", () => {
    const result = validateToolClaims({
      responseText:
        "Done. I cleaned the blocked tasks off your board. I removed them and verified the result.",
      executedToolNames: ["tasks"],
    });
    expect(result.valid).toBe(false);
    expect(result.missingCommitments.map((entry) => entry.kind)).toContain("task_result");
    expect(result.missingClaimLabels).toContain("task/board result evidence");
    expect(result.primaryClaimText).toContain("I cleaned the blocked tasks off your board");
  });

  it("flags blocked-task cleanup result claims when reply includes counts but no mutation evidence", () => {
    const result = validateToolClaims({
      responseText:
        "Done. I cleaned the blocked tasks off your board. There were 7 blocked tasks before. There are now zero blocked tasks.",
      executedToolNames: ["tasks"],
    });
    expect(result.valid).toBe(false);
    expect(result.missingCommitments.map((entry) => entry.kind)).toContain("task_result");
    expect(result.primaryClaimText).toContain("I cleaned the blocked tasks off your board");
  });

  it("fails board-cleanup zero-blocked claims when only unrelated task mutation evidence exists", () => {
    const result = validateToolClaims({
      responseText:
        "Done. I cleaned the blocked tasks off your board. There were 7 blocked tasks before. There are now zero blocked tasks.",
      executedToolNames: ["tasks"],
      taskMutationEvidence: [
        {
          toolName: "tasks",
          action: "complete",
          entityIds: ["TASK-1"],
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.missingCommitments.filter((entry) => entry.kind === "task_result")).toHaveLength(
      1,
    );
    expect(
      result.missingClaimLabels.filter((label) => label === "task/board result evidence"),
    ).toHaveLength(1);
  });

  it("passes blocked-task cleanup result claims when mutation evidence is supplied", () => {
    const result = validateToolClaims({
      responseText:
        "Done. I cleaned the blocked tasks off your board. There were 7 blocked tasks before. There are now zero blocked tasks.",
      executedToolNames: ["tasks"],
      taskMutationEvidence: [
        {
          toolName: "tasks",
          action: "delete",
          entityIds: ["TASK-101", "TASK-102"],
          beforeCount: 7,
          afterCount: 0,
        },
      ],
    });
    expect(result.valid).toBe(true);
    expect(result.missingCommitments).toEqual([]);
    expect(result.evidenceKinds).toContain("task");
  });

  it("passes task-result claims when affected task IDs overlap mutation evidence", () => {
    const result = validateToolClaims({
      responseText:
        "Done. I cleaned the blocked tasks off your board. Affected task IDs: TASK-101, TASK-102.",
      executedToolNames: ["tasks"],
      taskMutationEvidence: [
        {
          toolName: "tasks",
          action: "update",
          entityIds: ["TASK-102", "TASK-999"],
        },
      ],
    });
    expect(result.valid).toBe(true);
    expect(result.missingCommitments).toEqual([]);
  });

  it("collapses a board-cleanup reply into one task-result commitment", () => {
    const result = validateToolClaims({
      responseText:
        "Done. I cleaned the blocked tasks off your board. There were 7 blocked tasks before. There are now zero blocked tasks.",
      executedToolNames: ["tasks"],
    });
    expect(result.commitments.filter((entry) => entry.kind === "task_result")).toHaveLength(1);
    expect(result.missingCommitments.filter((entry) => entry.kind === "task_result")).toHaveLength(
      1,
    );
  });

  // ── Edge cases ───────────────────────────────────────────────────────

  it("recognizes doc_panel_update as a doc_panel variant", () => {
    const result = validateToolClaims({
      responseText: "",
      executedToolNames: ["doc_panel_update"],
    });
    expect(result.executedTools).toContain("doc_panel");
    expect(result.hasExternalArtifact).toBe(true);
  });

  it("handles malformed EPISODE_JSON gracefully", () => {
    const result = validateToolClaims({
      responseText: "[EPISODE_JSON]\n{broken json\n[/EPISODE_JSON]",
      executedToolNames: ["web_search"],
    });
    // Should not throw; should have no claimed tools from the malformed block
    expect(result.claimedTools).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("handles empty/missing tools_used in EPISODE_JSON", () => {
    const result = validateToolClaims({
      responseText: '[EPISODE_JSON]\n{"tools_used": []}\n[/EPISODE_JSON]',
      executedToolNames: [],
    });
    expect(result.valid).toBe(true);
    expect(result.claimedTools).toEqual([]);
  });

  // ── Mixed claims ─────────────────────────────────────────────────────

  it("flags only the unexecuted tools in a mixed claim", () => {
    const result = validateToolClaims({
      responseText: "I used web_search to find the data, then ran web_fetch to download it.",
      executedToolNames: ["web_search"],
    });
    expect(result.valid).toBe(false);
    expect(result.missingClaims).toEqual(["web_fetch"]);
    expect(result.executedTools).toContain("web_search");
  });

  it("passes when all mixed claims have matching executions", () => {
    const result = validateToolClaims({
      responseText: "I called web_search and executed doc_panel_update for you.",
      executedToolNames: ["web_search", "doc_panel_update"],
    });
    expect(result.valid).toBe(true);
    expect(result.missingClaims).toEqual([]);
    expect(result.hasExternalArtifact).toBe(true);
  });

  it("flags raw browser action JSON as a high-confidence missing claim", () => {
    const result = validateToolClaims({
      responseText:
        '{"action":"act","targetId":"D890","request":{"kind":"type","ref":"e109","text":"02"}}',
      executedToolNames: [],
    });
    expect(result.valid).toBe(false);
    expect(result.missingClaims).toContain("browser");
    expect(result.structuredClaims).toContain("browser");
    expect(result.highConfidenceMissingClaims).toContain("browser");
  });

  it("passes browser structured claims when browser tool was actually executed", () => {
    const result = validateToolClaims({
      responseText: '{"action":"act","targetId":"D890","request":{"kind":"click","ref":"e128"}}',
      executedToolNames: ["browser"],
    });
    expect(result.valid).toBe(true);
    expect(result.missingClaims).toEqual([]);
    expect(result.highConfidenceMissingClaims).toEqual([]);
  });

  it("flags standalone action JSON as a high-confidence missing tool claim", () => {
    const result = validateToolClaims({
      responseText: '{"action":"list_avatars"}',
      executedToolNames: [],
    });
    expect(result.valid).toBe(false);
    expect(result.missingClaims).toContain("tool_json");
    expect(result.structuredClaims).toContain("tool_json");
    expect(result.highConfidenceMissingClaims).toContain("tool_json");
  });

  it("does not misclassify unrelated JSON payloads as browser tool claims", () => {
    const result = validateToolClaims({
      responseText: '{"action":"handle","message":"continue"}',
      executedToolNames: [],
    });
    expect(result.valid).toBe(true);
    expect(result.claimedTools).toEqual([]);
    expect(result.structuredClaims).toEqual([]);
  });
});
