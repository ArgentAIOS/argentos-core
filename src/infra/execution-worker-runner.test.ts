import { describe, expect, it } from "vitest";
import type { Task } from "../data/types.js";
import {
  buildExecutionWorkerStatusHint,
  buildWorkerTaskSnapshot,
  looksLikeTextualToolCall,
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
  };
}

describe("execution worker status hints", () => {
  it("reports dependency blockers when visible tasks cannot run yet", () => {
    const snapshot = buildWorkerTaskSnapshot(
      [
        createTask({
          id: "task-1",
          title: "Blocked child",
          status: "pending",
          assignee: "relay",
          dependsOn: ["task-2"],
        }),
        createTask({
          id: "task-2",
          title: "Parent work",
          status: "pending",
          assignee: "other-agent",
        }),
      ],
      "relay",
      "assigned",
    );

    const hint = buildExecutionWorkerStatusHint({
      agentId: "relay",
      globalPaused: false,
      agentPaused: false,
      running: false,
      rerunRequested: false,
      nextDueAt: null,
      snapshot,
    });

    expect(hint.kind).toBe("blocked");
    expect(hint.summary).toContain("waiting on dependencies");
    expect(hint.taskSnapshot?.dependencyBlockedCount).toBe(1);
  });

  it("reports when no open tasks are in the worker scope", () => {
    const snapshot = buildWorkerTaskSnapshot(
      [
        createTask({
          id: "task-1",
          title: "Other queue item",
          status: "pending",
          assignee: "someone-else",
        }),
      ],
      "relay",
      "assigned",
    );

    const hint = buildExecutionWorkerStatusHint({
      agentId: "relay",
      globalPaused: false,
      agentPaused: false,
      running: false,
      rerunRequested: false,
      nextDueAt: null,
      snapshot,
    });

    expect(hint.kind).toBe("idle");
    expect(hint.summary).toContain("No open tasks are in this worker's scope");
    expect(hint.detail).toContain("other open task");
  });

  it("reports when runnable work is waiting for the next cadence", () => {
    const snapshot = buildWorkerTaskSnapshot(
      [
        createTask({
          id: "task-1",
          title: "Runnable work",
          status: "pending",
          assignee: "relay",
        }),
      ],
      "relay",
      "assigned",
    );

    const hint = buildExecutionWorkerStatusHint({
      agentId: "relay",
      globalPaused: false,
      agentPaused: false,
      running: false,
      rerunRequested: false,
      nextDueAt: Date.now() + 60_000,
      snapshot,
    });

    expect(hint.kind).toBe("waiting");
    expect(hint.summary).toContain("runnable task");
    expect(hint.detail).toContain("next pass");
  });

  it("prioritizes agent-busy over stale task counts", () => {
    const snapshot = buildWorkerTaskSnapshot(
      [
        createTask({
          id: "task-1",
          title: "Runnable work",
          status: "pending",
          assignee: "relay",
        }),
      ],
      "relay",
      "assigned",
    );

    const hint = buildExecutionWorkerStatusHint({
      agentId: "relay",
      globalPaused: false,
      agentPaused: false,
      running: false,
      rerunRequested: false,
      nextDueAt: Date.now() + 10_000,
      lastReason: "agent-busy",
      snapshot,
    });

    expect(hint.kind).toBe("waiting");
    expect(hint.summary).toContain("main agent lane");
  });
});

describe("looksLikeTextualToolCall (#442)", () => {
  it("detects the observed local-model pseudo-call dialects", () => {
    expect(looksLikeTextualToolCall("<|tool_call>call:tasks.search{query}")).toBe(true);
    expect(looksLikeTextualToolCall('<tool_call>{"name":"tasks"}')).toBe(true);
    expect(looksLikeTextualToolCall("[ tasks: list, status: open ]")).toBe(true);
    expect(looksLikeTextualToolCall("[Tool Call: tasks (ID: abc)]")).toBe(true);
    expect(looksLikeTextualToolCall("I will run call:tasks.list() now")).toBe(true);
  });

  it("ignores normal prose and summaries", () => {
    expect(looksLikeTextualToolCall("Triage complete: 6 tickets categorized and routed.")).toBe(
      false,
    );
    expect(looksLikeTextualToolCall("The tasks tool returned 6 open tickets.")).toBe(false);
    expect(looksLikeTextualToolCall("")).toBe(false);
  });
});
