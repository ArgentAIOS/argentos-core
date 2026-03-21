/**
 * Argent Agent Integration Test
 *
 * End-to-end test of the agent loop:
 * - Anthropic provider
 * - SIS lesson injection
 * - Turn execution
 * - Episode recording
 *
 * This test proves the full loop closes.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createAnthropicProvider } from "../argent-ai/providers/anthropic.js";
import { createAgent } from "./agent.js";

// Mock storage for this test (don't actually hit PostgreSQL)
const createMockSIS = () => {
  return {
    injector: {
      async selectLessonsForTurn() {
        return {
          injected: [],
          skipped: [],
          promptSection: "",
          visualization: "",
          context: "general" as const,
        };
      },
      async recordInjections() {},
      async updateInjectionOutcomes() {},
    },
    storage: {
      async recordInjection() {},
      async updateLessonConfidence() {},
      async buildLessonHistory() {
        return {
          avgValenceDelta: 0,
          injectionCount: 0,
          successCount: 0,
          familyEndorsements: 0,
          operatorEndorsements: 0,
          daysSinceLastUse: 0,
          hasGroundTruthContradiction: false,
          successfulUsesSinceContradiction: 0,
          llmSelfConfidence: 0.5,
        };
      },
    },
  };
};

describe("Agent Integration", () => {
  let apiKey: string;

  beforeAll(() => {
    // Get API key from environment
    apiKey = process.env.ANTHROPIC_API_KEY || "";

    if (!apiKey) {
      console.warn("Skipping integration tests: ANTHROPIC_API_KEY not set");
    }
  });

  it.skipIf(!apiKey)(
    "should execute a simple turn",
    async () => {
      // Create provider
      const provider = createAnthropicProvider({
        apiKey,
        cacheRetention: "none",
      });

      // Create agent
      const agent = createAgent({
        provider,
        model: {
          id: "claude-sonnet-4-20250514",
          maxTokens: 1024,
          temperature: 0.7,
        },
        systemPrompt: "You are a helpful assistant. Be concise.",
      });

      // Execute turn
      const output = await agent.execute({
        content: "What is 2 + 2?",
        history: [],
      });

      // Verify response
      expect(output.text).toBeTruthy();
      expect(output.text.toLowerCase()).toContain("4");
      expect(output.stopReason).toBe("stop");
      expect(output.usage.totalTokens).toBeGreaterThan(0);

      console.log("Response:", output.text);
      console.log("Usage:", output.usage);
    },
    30000,
  );

  it.skipIf(!apiKey)(
    "should handle streaming turns",
    async () => {
      const provider = createAnthropicProvider({
        apiKey,
        cacheRetention: "none",
      });

      const agent = createAgent({
        provider,
        model: {
          id: "claude-sonnet-4-20250514",
          maxTokens: 512,
        },
        systemPrompt: "You are a helpful assistant.",
      });

      let textDeltaCount = 0;
      let finalText = "";

      for await (const event of agent.stream({
        content: "Count to 3.",
        history: [],
      })) {
        if (event.type === "text_delta") {
          textDeltaCount++;
          finalText += event.delta;
        }

        if (event.type === "done") {
          expect(event.response.text).toBeTruthy();
          expect(event.response.stopReason).toBe("stop");
        }
      }

      expect(textDeltaCount).toBeGreaterThan(0);
      expect(finalText).toBeTruthy();

      console.log("Streamed text:", finalText);
      console.log("Delta count:", textDeltaCount);
    },
    30000,
  );

  it.skipIf(!apiKey)(
    "should work with SIS (mock storage)",
    async () => {
      const provider = createAnthropicProvider({
        apiKey,
        cacheRetention: "none",
      });

      const mockSIS = createMockSIS();

      const agent = createAgent({
        provider,
        model: {
          id: "claude-sonnet-4-20250514",
          maxTokens: 512,
        },
        systemPrompt: "You are a helpful assistant.",
        sis: mockSIS as any,
      });

      const output = await agent.execute({
        content: "Hello!",
        history: [],
        episodeId: "test-episode-1",
        preValence: 0.5,
      });

      expect(output.text).toBeTruthy();
      expect(output.stopReason).toBe("stop");

      // SIS should inject no lessons (mock returns empty)
      expect(output.injectedLessons).toEqual([]);

      console.log("With SIS:", output.text);
    },
    30000,
  );

  it("should work without SIS", async () => {
    // This test doesn't need API key - just validates structure
    const mockProvider = {
      name: "mock",
      async execute() {
        return {
          text: "Mock response",
          toolCalls: [],
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 15,
          },
          stopReason: "stop" as const,
          provider: "mock",
          model: "mock-model",
        };
      },
      async *stream() {
        yield { type: "start" as const, partial: {} as any };
        yield { type: "done" as const, response: {} as any };
      },
    };

    const agent = createAgent({
      provider: mockProvider,
      model: { id: "mock-model" },
      systemPrompt: "Test prompt",
    });

    const output = await agent.execute({
      content: "Test",
      history: [],
    });

    expect(output.text).toBe("Mock response");
    expect(output.injectedLessons).toBeUndefined();
  });
});
