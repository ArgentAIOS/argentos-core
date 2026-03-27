/**
 * Workflow Context Builder — Tests for TOON context building and helpers.
 */

import { describe, it, expect, vi } from "vitest";

// Mock the toon-encoding module to avoid external dependency issues
vi.mock("../utils/toon-encoding.js", () => ({
  encodePipelineContext: (data: unknown) => {
    const json = JSON.stringify(data, null, 2);
    return `[PIPELINE_CONTEXT]\n${json}\n[/PIPELINE_CONTEXT]`;
  },
}));

import type {
  AgentConfig,
  PipelineContext,
  ItemSet,
  StepRecord,
  TriggerOutput,
} from "./workflow-types.js";
import {
  buildAgentStepPrompt,
  buildRetryPrompt,
  formatDuration,
  summarizeOutput,
  truncate,
} from "./workflow-context.js";

// ── Fixtures ──────────────────────────────────────────────────────

function makeAgentConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    agentId: "agent-test",
    rolePrompt: "You are a test research agent. Summarize findings.",
    timeoutMs: 60_000,
    evidenceRequired: false,
    ...overrides,
  };
}

function makeTriggerOutput(): TriggerOutput {
  return {
    triggerType: "manual",
    firedAt: 1700000000000,
    payload: { source: "test" },
  };
}

function makeStepRecord(overrides: Partial<StepRecord> = {}): StepRecord {
  return {
    nodeId: "step-1",
    nodeKind: "agent",
    nodeLabel: "Researcher",
    agentId: "agent-research",
    stepIndex: 0,
    status: "completed",
    durationMs: 5000,
    output: { items: [{ json: { result: "analysis" }, text: "Found 3 key insights." }] },
    startedAt: 1700000000000,
    endedAt: 1700000005000,
    ...overrides,
  };
}

function makePipelineContext(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    workflowId: "wf-test",
    workflowName: "Test Workflow",
    runId: "run-1",
    currentNodeId: "agent-2",
    currentStepIndex: 1,
    totalSteps: 3,
    trigger: makeTriggerOutput(),
    history: [makeStepRecord()],
    variables: {},
    totalTokensUsed: 1500,
    totalCostUsd: 0.02,
    ...overrides,
  };
}

// ── buildAgentStepPrompt ──────────────────────────────────────────

describe("buildAgentStepPrompt", () => {
  it("produces TOON-encoded pipeline context", () => {
    const config = makeAgentConfig();
    const context = makePipelineContext();
    const prompt = buildAgentStepPrompt(config, context);

    expect(prompt).toContain("[PIPELINE_CONTEXT]");
    expect(prompt).toContain("[/PIPELINE_CONTEXT]");
    expect(prompt).toContain("workflow");
    expect(prompt).toContain(config.rolePrompt);
  });

  it("includes step history", () => {
    const config = makeAgentConfig();
    const context = makePipelineContext({
      history: [
        makeStepRecord({ nodeLabel: "Researcher", stepIndex: 0, agentId: "agent-research" }),
        makeStepRecord({ nodeLabel: "Analyzer", stepIndex: 1, agentId: "agent-analyze" }),
      ],
    });

    const prompt = buildAgentStepPrompt(config, context);
    // The step summary uses agentId (or nodeKind as fallback) for the agent field
    expect(prompt).toContain("agent-research");
    expect(prompt).toContain("agent-analyze");
  });

  it("includes variables when present", () => {
    const config = makeAgentConfig();
    const context = makePipelineContext({
      variables: { topic: "AI safety", deadline: "2026-04-01" },
    });

    const prompt = buildAgentStepPrompt(config, context);
    expect(prompt).toContain("topic");
    expect(prompt).toContain("AI safety");
  });

  it("omits variables when empty", () => {
    const config = makeAgentConfig();
    const context = makePipelineContext({ variables: {} });
    const prompt = buildAgentStepPrompt(config, context);
    // When variables is empty, it should not appear in the encoded output
    // (the function passes undefined for empty variables)
    expect(prompt).not.toMatch(/"variables"\s*:\s*\{\s*\}/);
  });

  it("includes artifact references from step history", () => {
    const config = makeAgentConfig();
    const context = makePipelineContext({
      history: [
        makeStepRecord({
          output: {
            items: [
              {
                json: {},
                text: "Created report",
                artifacts: [{ type: "docpanel", id: "doc-123", title: "Summary Report" }],
              },
            ],
          },
        }),
      ],
    });

    const prompt = buildAgentStepPrompt(config, context);
    expect(prompt).toContain("docpanel");
    expect(prompt).toContain("Summary Report");
  });
});

// ── buildRetryPrompt ──────────────────────────────────────────────

describe("buildRetryPrompt", () => {
  it("includes retry context block", () => {
    const config = makeAgentConfig();
    const context = makePipelineContext();
    const prompt = buildRetryPrompt(config, context, 2, "timeout exceeded");

    expect(prompt).toContain("[RETRY_CONTEXT]");
    expect(prompt).toContain("[/RETRY_CONTEXT]");
    expect(prompt).toContain("attempt: 2");
    expect(prompt).toContain("timeout exceeded");
  });

  it("works without previous error", () => {
    const config = makeAgentConfig();
    const context = makePipelineContext();
    const prompt = buildRetryPrompt(config, context, 1);

    expect(prompt).toContain("[RETRY_CONTEXT]");
    expect(prompt).toContain("attempt: 1");
    expect(prompt).not.toContain("previousError");
  });
});

// ── Helper functions ──────────────────────────────────────────────

describe("formatDuration", () => {
  it("formats milliseconds", () => {
    expect(formatDuration(500)).toBe("500ms");
  });

  it("formats seconds", () => {
    expect(formatDuration(5000)).toBe("5s");
    expect(formatDuration(45000)).toBe("45s");
  });

  it("formats minutes", () => {
    expect(formatDuration(120_000)).toBe("2m");
    expect(formatDuration(150_000)).toBe("2m30s");
  });

  it("formats hours", () => {
    expect(formatDuration(3_600_000)).toBe("1h");
    expect(formatDuration(5_400_000)).toBe("1h30m");
  });
});

describe("truncate", () => {
  it("returns short strings unchanged", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("truncates long strings with ellipsis", () => {
    const long = "a".repeat(100);
    const result = truncate(long, 20);
    expect(result).toHaveLength(20);
    expect(result).toMatch(/\.\.\.$/);
  });

  it("handles exact length boundary", () => {
    expect(truncate("12345", 5)).toBe("12345");
    expect(truncate("123456", 5)).toBe("12...");
  });
});

describe("summarizeOutput", () => {
  it("returns '(no output)' for empty ItemSet", () => {
    expect(summarizeOutput({ items: [] })).toBe("(no output)");
  });

  it("summarizes text items", () => {
    const output: ItemSet = {
      items: [{ json: {}, text: "Analysis complete with 3 findings." }],
    };
    expect(summarizeOutput(output)).toContain("Analysis complete");
  });

  it("summarizes JSON items when text is absent", () => {
    const output: ItemSet = {
      items: [{ json: { score: 0.95, category: "excellent", tags: ["a", "b"] } }],
    };
    const result = summarizeOutput(output);
    expect(result).toContain("score");
    expect(result).toContain("category");
  });

  it("truncates long output summaries", () => {
    const longText = "x".repeat(1000);
    const output: ItemSet = {
      items: [{ json: {}, text: longText }],
    };
    const result = summarizeOutput(output);
    expect(result.length).toBeLessThanOrEqual(500);
  });

  it("joins multiple items with separator", () => {
    const output: ItemSet = {
      items: [
        { json: {}, text: "First item" },
        { json: {}, text: "Second item" },
      ],
    };
    const result = summarizeOutput(output);
    expect(result).toContain("First item");
    expect(result).toContain("Second item");
    expect(result).toContain(" | ");
  });
});
