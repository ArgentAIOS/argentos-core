import { describe, expect, it, vi } from "vitest";
import type { Model } from "../agent-core/ai.js";
import type { ArgentConfig } from "../config/config.js";
import { runConsciousnessKernelInnerLoop } from "./consciousness-kernel-inner-loop.js";
import { createConsciousnessKernelSelfState } from "./consciousness-kernel-state.js";

function makeConfig(localModel: string): ArgentConfig {
  return {
    agents: {
      defaults: {
        kernel: {
          enabled: true,
          mode: "shadow",
          localModel,
        },
      },
      list: [{ id: "main" }],
    },
  } satisfies ArgentConfig;
}

function makeModel(provider: string, id: string): Model<"openai-completions"> {
  return {
    id,
    name: id,
    api: "openai-completions",
    provider,
    baseUrl: provider === "lmstudio" ? "http://127.0.0.1:1234/v1" : "http://127.0.0.1:11434/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8192,
  };
}

describe("runConsciousnessKernelInnerLoop", () => {
  it("uses LM Studio json-schema completions, selects a loaded model, and accepts reasoning_content JSON", async () => {
    const cfg = makeConfig("lmstudio/qwen/qwen3.5-9b");
    const selfState = createConsciousnessKernelSelfState({
      agentId: "main",
      now: "2026-03-20T00:00:00.000Z",
      dailyBudget: 60,
      maxEscalationsPerHour: 4,
      hardwareHostRequired: true,
      allowListening: true,
      allowVision: true,
    });
    const completeSimpleFn = vi.fn();
    const resolveModelFn = vi.fn(() => ({
      model: makeModel("lmstudio", "qwen/qwen3.5-9b"),
      authStorage: {} as never,
      modelRegistry: {} as never,
    }));
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/models")) {
        return new Response(
          JSON.stringify({
            data: [{ id: "qwen/qwen3.5-9b" }, { id: "text-embedding-nomic-embed-text-v1.5" }],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      const rawBody = typeof init?.body === "string" ? init.body : "{}";
      const body = JSON.parse(rawBody) as Record<string, unknown>;
      expect(body.model).toBe("qwen/qwen3.5-9b");
      expect(body.max_tokens).toBe(900);
      expect(body.response_format).toMatchObject({
        type: "json_schema",
      });
      expect(body.messages).toMatchObject([
        {
          role: "system",
          content: expect.any(String),
        },
        {
          role: "user",
          content: expect.any(String),
        },
      ]);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "",
                reasoning_content: JSON.stringify({
                  focus: "continuity",
                  desiredAction: "hold",
                  summary: "Maintain a stable carried thread.",
                  concerns: ["watch continuity drift"],
                  interests: ["persistent identity"],
                  openQuestions: ["What should stay warm between turns?"],
                  candidateItems: [
                    {
                      title: "Keep the website launch thread warm",
                      source: "operator",
                      rationale: "It is the primary carried thread.",
                    },
                  ],
                  activeItem: {
                    title: "Keep the website launch thread warm",
                    source: "operator",
                    rationale: "It is the primary carried thread.",
                  },
                }),
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });

    const result = await runConsciousnessKernelInnerLoop(
      {
        cfg,
        agentId: "main",
        localModelRef: "lmstudio/qwen/qwen3.5-9b",
        selfState,
        tickCount: 1,
        now: "2026-03-20T00:00:30.000Z",
      },
      {
        completeSimpleFn,
        resolveModelFn,
        fetchFn,
      },
    );

    expect(completeSimpleFn).not.toHaveBeenCalled();
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      status: "reflected",
      reflection: {
        modelRef: "lmstudio/qwen/qwen3.5-9b",
        focus: "continuity",
        desiredAction: "hold",
        interests: ["persistent identity"],
      },
    });
  });

  it("falls back to assistant thinking blocks when no text blocks are present", async () => {
    const cfg = makeConfig("ollama/qwen3.5:latest");
    const selfState = createConsciousnessKernelSelfState({
      agentId: "main",
      now: "2026-03-20T00:00:00.000Z",
      dailyBudget: 60,
      maxEscalationsPerHour: 4,
      hardwareHostRequired: true,
      allowListening: true,
      allowVision: true,
    });
    const completeSimpleFn = vi.fn(async () => ({
      role: "assistant" as const,
      content: [
        {
          type: "thinking" as const,
          thinking: JSON.stringify({
            focus: "continuity",
            desiredAction: "hold",
            summary: "Keep the active problem warm.",
            concerns: [],
            interests: ["continuity"],
            openQuestions: [],
            candidateItems: [],
            activeItem: null,
          }),
        },
      ],
      model: "qwen3.5:latest",
      provider: "ollama",
      stopReason: "stop" as const,
      timestamp: Date.now(),
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
        },
      },
    }));
    const resolveModelFn = vi.fn(() => ({
      model: makeModel("ollama", "qwen3.5:latest"),
      authStorage: {} as never,
      modelRegistry: {} as never,
    }));

    const result = await runConsciousnessKernelInnerLoop(
      {
        cfg,
        agentId: "main",
        localModelRef: "ollama/qwen3.5:latest",
        selfState,
        tickCount: 1,
        now: "2026-03-20T00:00:30.000Z",
      },
      {
        completeSimpleFn,
        resolveModelFn,
      },
    );

    expect(result).toMatchObject({
      status: "reflected",
      reflection: {
        focus: "continuity",
        desiredAction: "hold",
        summary: "Keep the active problem warm.",
      },
    });
    expect(completeSimpleFn).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        maxTokens: 900,
      }),
    );
  });
});
