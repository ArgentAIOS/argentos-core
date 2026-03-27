import { describe, expect, it } from "vitest";
import { AgentDefaultsSchema } from "./zod-schema.agent-defaults.js";

describe("agent interval guards", () => {
  it("rejects contemplation intervals under 30m", () => {
    const result = AgentDefaultsSchema.safeParse({
      memorySearch: {},
      heartbeat: {},
      executionWorker: {},
      contemplation: { every: "2m" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects heartbeat intervals under 30m", () => {
    const result = AgentDefaultsSchema.safeParse({
      memorySearch: {},
      heartbeat: { every: "5m" },
      executionWorker: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects sis intervals under 30m", () => {
    const result = AgentDefaultsSchema.safeParse({
      memorySearch: {},
      heartbeat: {},
      executionWorker: {},
      sis: { every: "10m" },
    });
    expect(result.success).toBe(false);
  });

  it("accepts tool loop detection tuning", () => {
    const result = AgentDefaultsSchema.safeParse({
      memorySearch: {},
      heartbeat: {},
      executionWorker: {},
      toolLoopDetection: {
        threshold: 4,
        abortThreshold: 8,
        excludeTools: ["read", "doc_panel"],
        singleAttemptTools: ["music_generate"],
        perToolBudget: {
          exec: 8,
          web_search: 5,
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects kernel tick cadence under 1000ms", () => {
    const result = AgentDefaultsSchema.safeParse({
      memorySearch: {},
      heartbeat: {},
      executionWorker: {},
      kernel: { enabled: true, mode: "shadow", tickMs: 500 },
    });
    expect(result.success).toBe(false);
  });
});
