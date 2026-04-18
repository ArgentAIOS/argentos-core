import { describe, expect, it } from "vitest";
import type { Task } from "../data/types.js";
import {
  buildPersonalSkillCandidateInputFromTaskOutcome,
  isAutonomousAgentServiceableTask,
} from "./execution-worker-runner.js";

function createTask(overrides: Partial<Task> & Pick<Task, "id" | "title" | "status">): Task {
  return {
    id: overrides.id,
    title: overrides.title,
    status: overrides.status,
    priority: overrides.priority ?? "normal",
    source: overrides.source ?? "user",
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    assignee: overrides.assignee,
    agentId: overrides.agentId,
    dependsOn: overrides.dependsOn,
    metadata: overrides.metadata,
    type: overrides.type,
  };
}

describe("isAutonomousAgentServiceableTask", () => {
  it("rejects unassigned tasks", () => {
    expect(
      isAutonomousAgentServiceableTask(
        createTask({
          id: "task-1",
          title: "Unassigned task",
          status: "pending",
          assignee: undefined,
        }),
        "argent",
      ),
    ).toBe(false);
  });

  it("rejects project parents even when assigned", () => {
    expect(
      isAutonomousAgentServiceableTask(
        createTask({
          id: "task-2",
          title: "Assigned project parent",
          status: "pending",
          assignee: "argent",
          type: "project",
        }),
        "argent",
      ),
    ).toBe(false);
  });

  it("accepts explicitly assigned non-project tasks", () => {
    expect(
      isAutonomousAgentServiceableTask(
        createTask({
          id: "task-3",
          title: "Assigned child task",
          status: "pending",
          assignee: "argent",
          type: "one-time",
        }),
        "argent",
      ),
    ).toBe(true);
  });

  it("builds a personal skill candidate only for completed non-project tasks with tool evidence", () => {
    const input = buildPersonalSkillCandidateInputFromTaskOutcome({
      task: createTask({
        id: "task-4",
        title: "Create competitive comparison page",
        description: "Build the comparison page and publish the supporting artifact.",
        status: "completed",
        assignee: "argent",
        metadata: {
          completionNotes: "Created the implementation-ready comparison page runbook.",
        },
      }),
      toolValidation: {
        claimedTools: ["doc_panel"],
        executedTools: ["doc_panel", "web_search"],
        missingClaims: [],
        externalToolsExecuted: ["doc_panel"],
        hasExternalArtifact: true,
        valid: true,
      },
    });

    expect(input).not.toBeNull();
    expect(input?.title).toContain("doc_panel procedure");
    expect(input?.sourceTaskIds).toEqual(["task-4"]);
    expect(input?.relatedTools).toEqual(["doc_panel", "web_search"]);
  });

  it("does not build a personal skill candidate for incomplete or tool-free outcomes", () => {
    expect(
      buildPersonalSkillCandidateInputFromTaskOutcome({
        task: createTask({
          id: "task-5",
          title: "Pending work",
          status: "pending",
          assignee: "argent",
        }),
        toolValidation: {
          claimedTools: [],
          executedTools: ["doc_panel"],
          missingClaims: [],
          externalToolsExecuted: [],
          hasExternalArtifact: false,
          valid: true,
        },
      }),
    ).toBeNull();

    expect(
      buildPersonalSkillCandidateInputFromTaskOutcome({
        task: createTask({
          id: "task-6",
          title: "Completed but no evidence",
          status: "completed",
          assignee: "argent",
        }),
        toolValidation: {
          claimedTools: [],
          executedTools: [],
          missingClaims: [],
          externalToolsExecuted: [],
          hasExternalArtifact: false,
          valid: true,
        },
      }),
    ).toBeNull();
  });
});
