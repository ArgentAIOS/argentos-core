import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantMessage } from "../agent-core/ai.js";
import type { ArgentConfig } from "../config/config.js";
import type { EmbeddedRunAttemptResult } from "./pi-embedded-runner/run/types.js";

const runEmbeddedAttemptMock = vi.fn<Promise<EmbeddedRunAttemptResult>, [unknown]>();
const persistCommitmentMemoryMock = vi.fn<Promise<void>, [unknown]>();

vi.mock("./pi-embedded-runner/run/attempt.js", () => ({
  runEmbeddedAttempt: (params: unknown) => runEmbeddedAttemptMock(params),
}));

vi.mock("./commitment-memory.js", () => ({
  persistCommitmentMemory: (params: unknown) => persistCommitmentMemoryMock(params),
}));

let runEmbeddedPiAgent: typeof import("./pi-embedded-runner.js").runEmbeddedPiAgent;
let tempRoot: string | undefined;
let agentDir: string;
let workspaceDir: string;
let sessionCounter = 0;

const baseUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const buildAssistant = (text: string): AssistantMessage => ({
  role: "assistant",
  content: [{ type: "text", text }],
  api: "openai-responses",
  provider: "openai",
  model: "mock-1",
  usage: baseUsage,
  stopReason: "stop",
  timestamp: Date.now(),
});

const makeAttempt = (overrides: Partial<EmbeddedRunAttemptResult>): EmbeddedRunAttemptResult => ({
  aborted: false,
  timedOut: false,
  promptError: null,
  sessionIdUsed: "session:test",
  systemPromptReport: undefined,
  messagesSnapshot: [],
  assistantTexts: [],
  toolMetas: [],
  taskMutationEvidence: [],
  lastAssistant: undefined,
  didSendViaMessagingTool: false,
  messagingToolSentTexts: [],
  messagingToolSentTargets: [],
  cloudCodeAssistFormatError: false,
  ...overrides,
});

const makeConfig = (): ArgentConfig =>
  ({
    models: {
      providers: {
        openai: {
          api: "openai-responses",
          apiKey: "sk-test",
          baseUrl: "https://example.com",
          models: [
            {
              id: "mock-1",
              name: "Mock 1",
              reasoning: false,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 16_000,
              maxTokens: 2048,
            },
          ],
        },
      },
    },
  }) satisfies ArgentConfig;

const nextSessionFile = () => {
  sessionCounter += 1;
  return path.join(workspaceDir, `session-${sessionCounter}.jsonl`);
};

beforeAll(async () => {
  ({ runEmbeddedPiAgent } = await import("./pi-embedded-runner.js"));
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "argent-commitment-run-"));
  agentDir = path.join(tempRoot, "agent");
  workspaceDir = path.join(tempRoot, "workspace");
  await fs.mkdir(agentDir, { recursive: true });
  await fs.mkdir(workspaceDir, { recursive: true });
});

afterAll(async () => {
  if (!tempRoot) {
    return;
  }
  await fs.rm(tempRoot, { recursive: true, force: true });
});

beforeEach(() => {
  runEmbeddedAttemptMock.mockReset();
  persistCommitmentMemoryMock.mockReset();
});

describe("runEmbeddedPiAgent commitment enforcement", () => {
  it("passes task-result claims when mutating task evidence reaches run.ts", async () => {
    const responseText =
      "Done. I cleaned the blocked tasks off your board. Affected task IDs: TASK-101, TASK-102.";

    runEmbeddedAttemptMock.mockResolvedValue(
      makeAttempt({
        assistantTexts: [responseText],
        toolMetas: [{ toolName: "tasks", meta: "update" }],
        taskMutationEvidence: [
          {
            toolName: "tasks",
            action: "update",
            entityIds: ["TASK-101", "TASK-102"],
            summary: "Updated task:",
          },
        ],
        lastAssistant: buildAssistant(responseText),
      }),
    );

    const result = await runEmbeddedPiAgent({
      sessionId: "session:test",
      sessionKey: "agent:test:task-result-pass",
      sessionFile: nextSessionFile(),
      workspaceDir,
      agentDir,
      config: makeConfig(),
      prompt: "Clean the blocked tasks off my board and tell me what changed.",
      provider: "openai",
      model: "mock-1",
      timeoutMs: 5_000,
      runId: "run:task-result-pass",
    });

    expect(runEmbeddedAttemptMock).toHaveBeenCalledTimes(1);
    expect(result.meta.toolValidation?.valid).toBe(true);
    expect(result.meta.toolValidation?.commitmentDisposition).toBe("pass");
    expect(result.meta.toolValidation?.missingCommitments).toEqual([]);
    expect(persistCommitmentMemoryMock).not.toHaveBeenCalled();
  });

  it("passes board-cleanup count claims when matching before/after evidence reaches run.ts", async () => {
    const responseText =
      "Done. I cleaned the blocked tasks off your board. There were 7 blocked tasks before. There are now zero blocked tasks.";

    runEmbeddedAttemptMock.mockResolvedValue(
      makeAttempt({
        assistantTexts: [responseText],
        toolMetas: [{ toolName: "tasks", meta: "update" }],
        taskMutationEvidence: [
          {
            toolName: "tasks",
            action: "update",
            entityIds: ["TASK-101", "TASK-102"],
            beforeCount: 7,
            afterCount: 0,
            summary: "Updated task:",
          },
        ],
        lastAssistant: buildAssistant(responseText),
      }),
    );

    const result = await runEmbeddedPiAgent({
      sessionId: "session:test",
      sessionKey: "agent:test:task-result-count-pass",
      sessionFile: nextSessionFile(),
      workspaceDir,
      agentDir,
      config: makeConfig(),
      prompt: "Clean the blocked tasks off my board and verify the result.",
      provider: "openai",
      model: "mock-1",
      timeoutMs: 5_000,
      runId: "run:task-result-count-pass",
    });

    expect(runEmbeddedAttemptMock).toHaveBeenCalledTimes(1);
    expect(result.meta.toolValidation?.valid).toBe(true);
    expect(result.meta.toolValidation?.commitmentDisposition).toBe("pass");
    expect(result.meta.toolValidation?.missingCommitments).toEqual([]);
  });

  it("blocks task-result claims when only unrelated task mutation evidence reaches run.ts", async () => {
    const responseText =
      "Done. I cleaned the blocked tasks off your board. There were 7 blocked tasks before. There are now zero blocked tasks.";

    runEmbeddedAttemptMock.mockResolvedValue(
      makeAttempt({
        assistantTexts: [responseText],
        toolMetas: [{ toolName: "tasks", meta: "complete" }],
        taskMutationEvidence: [
          {
            toolName: "tasks",
            action: "complete",
            entityIds: ["TASK-1"],
          },
        ],
        lastAssistant: buildAssistant(responseText),
      }),
    );

    const result = await runEmbeddedPiAgent({
      sessionId: "session:test",
      sessionKey: "agent:test:task-result-fail",
      sessionFile: nextSessionFile(),
      workspaceDir,
      agentDir,
      config: makeConfig(),
      prompt: "Clean the blocked tasks off my board and verify the result.",
      provider: "openai",
      model: "mock-1",
      timeoutMs: 5_000,
      runId: "run:task-result-fail",
    });

    expect(runEmbeddedAttemptMock.mock.calls.length).toBeGreaterThan(1);
    expect(result.meta.toolValidation?.valid).toBe(false);
    expect(result.meta.toolValidation?.commitmentDisposition).toBe("blocked");
    expect(
      result.meta.toolValidation?.missingCommitments.filter(
        (entry) => entry.kind === "task_result",
      ),
    ).toHaveLength(1);
    expect(result.meta.toolValidation?.missingCommitments.map((entry) => entry.kind)).toContain(
      "task_result",
    );
    expect(result.payloads?.[0]?.text).toContain("I wasn't able to complete the requested action");
    expect(persistCommitmentMemoryMock).toHaveBeenCalledTimes(1);
  });

  it("blocks short status claims that promise work without any same-turn execution", async () => {
    const responseText = "I'm on it. Pulling the text now.";

    runEmbeddedAttemptMock.mockResolvedValue(
      makeAttempt({
        assistantTexts: [responseText],
        toolMetas: [],
        lastAssistant: buildAssistant(responseText),
      }),
    );

    const result = await runEmbeddedPiAgent({
      sessionId: "session:test",
      sessionKey: "agent:test:short-status-fail",
      sessionFile: nextSessionFile(),
      workspaceDir,
      agentDir,
      config: makeConfig(),
      prompt: "Fetch the page text and show it to me.",
      provider: "openai",
      model: "mock-1",
      timeoutMs: 5_000,
      runId: "run:short-status-fail",
    });

    expect(runEmbeddedAttemptMock.mock.calls.length).toBeGreaterThan(1);
    expect(result.meta.toolValidation?.valid).toBe(false);
    expect(result.meta.toolValidation?.commitmentDisposition).toBe("blocked");
    expect(result.meta.toolValidation?.missingClaimLabels).toEqual(
      expect.arrayContaining(["active work claim", "research action"]),
    );
    expect(result.payloads?.[0]?.text).toContain("I wasn't able to complete the requested action");
    expect(persistCommitmentMemoryMock).toHaveBeenCalledTimes(1);
  });

  it("retries memory/rules answers until a memory recall tool runs", async () => {
    const failedText = "Our rules are to check evidence and be careful.";
    const repairedText = "I checked memory. Our rules include evidence before claims.";

    runEmbeddedAttemptMock
      .mockResolvedValueOnce(
        makeAttempt({
          assistantTexts: [failedText],
          toolMetas: [{ toolName: "read" }],
          lastAssistant: buildAssistant(failedText),
        }),
      )
      .mockResolvedValueOnce(
        makeAttempt({
          assistantTexts: [repairedText],
          toolMetas: [{ toolName: "memory_recall" }],
          lastAssistant: buildAssistant(repairedText),
        }),
      );

    const result = await runEmbeddedPiAgent({
      sessionId: "session:test",
      sessionKey: "agent:test:memory-recall-repair",
      sessionFile: nextSessionFile(),
      workspaceDir,
      agentDir,
      config: makeConfig(),
      prompt: "What are our rules?",
      provider: "openai",
      model: "mock-1",
      timeoutMs: 5_000,
      runId: "run:memory-recall-repair",
    });

    expect(runEmbeddedAttemptMock).toHaveBeenCalledTimes(2);
    expect(
      String((runEmbeddedAttemptMock.mock.calls[1]?.[0] as { prompt?: string }).prompt),
    ).toContain("MEMORY_RECALL_GUARDRAIL");
    expect(result.meta.toolValidation?.valid).toBe(true);
    expect(result.meta.toolValidation?.commitmentDisposition).toBe("repaired");
    expect(result.meta.toolValidation?.evidenceTools).toContain("memory_recall");
    expect(result.payloads?.[0]?.text).toContain("I checked memory");
  });

  it("blocks memory/rules answers when recall is still skipped after retry", async () => {
    const responseText = "Our rules are to check evidence and be careful.";

    runEmbeddedAttemptMock.mockResolvedValue(
      makeAttempt({
        assistantTexts: [responseText],
        toolMetas: [{ toolName: "read" }],
        lastAssistant: buildAssistant(responseText),
      }),
    );

    const result = await runEmbeddedPiAgent({
      sessionId: "session:test",
      sessionKey: "agent:test:memory-recall-block",
      sessionFile: nextSessionFile(),
      workspaceDir,
      agentDir,
      config: makeConfig(),
      prompt: "Daily Memory Files. Can you give me the path to those files?",
      provider: "openai",
      model: "mock-1",
      timeoutMs: 5_000,
      runId: "run:memory-recall-block",
    });

    expect(runEmbeddedAttemptMock).toHaveBeenCalledTimes(2);
    expect(result.meta.toolValidation?.valid).toBe(false);
    expect(result.meta.toolValidation?.commitmentDisposition).toBe("blocked");
    expect(result.meta.toolValidation?.commitmentBlockedReason).toBe("memory recall");
    expect(result.meta.toolValidation?.missingClaimLabels).toContain("memory recall");
    expect(result.payloads?.[0]?.text).toContain("without first running memory recall");
  });
});
