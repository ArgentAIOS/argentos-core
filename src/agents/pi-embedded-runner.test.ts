import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import "./test-helpers/fast-coding-tools.js";
import type { ArgentConfig } from "../config/config.js";
import { ensureArgentModelsJson } from "./models-config.js";

vi.mock("../agent-core/ai.js", async () => {
  const actual = await vi.importActual<typeof import("../agent-core/ai.js")>("../agent-core/ai.js");

  const buildAssistantMessage = (model: { api: string; provider: string; id: string }) => ({
    role: "assistant" as const,
    content: [{ type: "text" as const, text: "ok" }],
    stopReason: "stop" as const,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    timestamp: Date.now(),
  });

  const buildAssistantErrorMessage = (model: { api: string; provider: string; id: string }) => ({
    role: "assistant" as const,
    content: [] as const,
    stopReason: "error" as const,
    errorMessage: "boom",
    api: model.api,
    provider: model.provider,
    model: model.id,
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
    timestamp: Date.now(),
  });

  return {
    ...actual,
    complete: async (model: { api: string; provider: string; id: string }) => {
      if (model.id === "mock-error") {
        return buildAssistantErrorMessage(model);
      }
      return buildAssistantMessage(model);
    },
    completeSimple: async (model: { api: string; provider: string; id: string }) => {
      if (model.id === "mock-error") {
        return buildAssistantErrorMessage(model);
      }
      return buildAssistantMessage(model);
    },
    streamSimple: (model: { api: string; provider: string; id: string }) => {
      const stream = new actual.AssistantMessageEventStream();
      queueMicrotask(() => {
        stream.push({
          type: "done",
          reason: "stop",
          message:
            model.id === "mock-error"
              ? buildAssistantErrorMessage(model)
              : buildAssistantMessage(model),
        });
        stream.end();
      });
      return stream;
    },
  };
});

let runEmbeddedPiAgent: typeof import("./pi-embedded-runner.js").runEmbeddedPiAgent;
let tempRoot: string | undefined;
let agentDir: string;
let workspaceDir: string;
let sessionCounter = 0;

beforeAll(async () => {
  vi.useRealTimers();
  ({ runEmbeddedPiAgent } = await import("./pi-embedded-runner.js"));
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "argent-embedded-agent-"));
  agentDir = path.join(tempRoot, "agent");
  workspaceDir = path.join(tempRoot, "workspace");
  await fs.mkdir(agentDir, { recursive: true });
  await fs.mkdir(workspaceDir, { recursive: true });
}, 20_000);

afterAll(async () => {
  if (!tempRoot) {
    return;
  }
  await fs.rm(tempRoot, { recursive: true, force: true });
  tempRoot = undefined;
});

const makeOpenAiConfig = (modelIds: string[]) =>
  ({
    models: {
      providers: {
        openai: {
          api: "openai-responses",
          apiKey: "sk-test",
          baseUrl: "https://example.com",
          models: modelIds.map((id) => ({
            id,
            name: `Mock ${id}`,
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 16_000,
            maxTokens: 2048,
          })),
        },
      },
    },
  }) satisfies ArgentConfig;

const ensureModels = (cfg: ArgentConfig) => ensureArgentModelsJson(cfg, agentDir) as unknown;

const nextSessionFile = () => {
  sessionCounter += 1;
  return path.join(workspaceDir, `session-${sessionCounter}.jsonl`);
};

const testSessionKey = "agent:test:embedded";
const kernelSessionKey = "agent:main:webchat";
const immediateEnqueue = async <T>(task: () => Promise<T>) => task();

const textFromContent = (content: unknown) => {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content) && content[0]?.type === "text") {
    return (content[0] as { text?: string }).text;
  }
  return undefined;
};

const readSessionMessages = async (sessionFile: string) => {
  const raw = await fs.readFile(sessionFile, "utf-8");
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map(
      (line) =>
        JSON.parse(line) as {
          type?: string;
          message?: { role?: string; content?: unknown };
        },
    )
    .filter((entry) => entry.type === "message")
    .map((entry) => entry.message as { role?: string; content?: unknown });
};

describe("runEmbeddedPiAgent", () => {
  const itIfNotWin32 = process.platform === "win32" ? it.skip : it;
  it("writes models.json into the provided agentDir", async () => {
    const sessionFile = nextSessionFile();

    const cfg = {
      models: {
        providers: {
          minimax: {
            baseUrl: "https://api.minimax.io/anthropic",
            api: "anthropic-messages",
            apiKey: "sk-minimax-test",
            models: [
              {
                id: "MiniMax-M2.1",
                name: "MiniMax M2.1",
                reasoning: false,
                input: ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 200000,
                maxTokens: 8192,
              },
            ],
          },
        },
      },
    } satisfies ArgentConfig;

    await expect(
      runEmbeddedPiAgent({
        sessionId: "session:test",
        sessionKey: testSessionKey,
        sessionFile,
        workspaceDir,
        config: cfg,
        prompt: "hi",
        provider: "definitely-not-a-provider",
        model: "definitely-not-a-model",
        timeoutMs: 1,
        agentDir,
        enqueue: immediateEnqueue,
      }),
    ).rejects.toThrow(/Unknown model:/);

    await expect(fs.stat(path.join(agentDir, "models.json"))).resolves.toBeTruthy();
  });

  itIfNotWin32(
    "persists the first user message before assistant output",
    { timeout: 120_000 },
    async () => {
      const sessionFile = nextSessionFile();
      const cfg = makeOpenAiConfig(["mock-1"]);
      await ensureModels(cfg);

      await runEmbeddedPiAgent({
        sessionId: "session:test",
        sessionKey: testSessionKey,
        sessionFile,
        workspaceDir,
        config: cfg,
        prompt: "hello",
        provider: "openai",
        model: "mock-1",
        timeoutMs: 5_000,
        agentDir,
        enqueue: immediateEnqueue,
      });

      const messages = await readSessionMessages(sessionFile);
      const firstUserIndex = messages.findIndex(
        (message) => message?.role === "user" && textFromContent(message.content) === "hello",
      );
      const firstAssistantIndex = messages.findIndex((message) => message?.role === "assistant");
      expect(firstUserIndex).toBeGreaterThanOrEqual(0);
      if (firstAssistantIndex !== -1) {
        expect(firstUserIndex).toBeLessThan(firstAssistantIndex);
      }
    },
  );

  it("writes completed chat turns back into kernel continuity state", async () => {
    const sessionFile = nextSessionFile();
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "argent-kernel-turn-"));
    vi.stubEnv("ARGENT_STATE_DIR", stateDir);
    const cfg = {
      ...makeOpenAiConfig(["mock-1"]),
      agents: {
        defaults: {
          kernel: {
            enabled: true,
            mode: "shadow",
          },
        },
        list: [{ id: "main", default: true }],
      },
    } satisfies ArgentConfig;
    await ensureModels(cfg);

    await runEmbeddedPiAgent({
      sessionId: "session:test",
      sessionKey: kernelSessionKey,
      sessionFile,
      workspaceDir,
      config: cfg,
      prompt: "What were you holding in mind before I came back?",
      provider: "openai",
      model: "mock-1",
      timeoutMs: 5_000,
      agentDir,
      enqueue: immediateEnqueue,
    });

    const kernelStatePath = path.join(
      stateDir,
      "agents",
      "main",
      "agent",
      "kernel",
      "self-state.json",
    );
    const persisted = JSON.parse(await fs.readFile(kernelStatePath, "utf-8")) as {
      conversation: {
        activeSessionKey: string | null;
        activeChannel: string | null;
        lastUserMessageText: string | null;
        lastAssistantReplyText: string | null;
        lastAssistantConclusion: string | null;
      };
      recentDecision: { kind: string; summary: string } | null;
      wakefulness: { state: string };
    };

    expect(persisted.wakefulness.state).toBe("engaged");
    expect(persisted.conversation.activeSessionKey).toBe(kernelSessionKey);
    expect(persisted.conversation.activeChannel).toBe("webchat");
    expect(persisted.conversation.lastUserMessageText).toBe(
      "What were you holding in mind before I came back?",
    );
    expect(persisted.conversation.lastAssistantReplyText).toBe("ok");
    expect(persisted.conversation.lastAssistantConclusion).toBe("ok");
    expect(persisted.recentDecision?.kind).toBe("conversation-sync");
  });

  it("persists the user message when prompt fails before assistant output", async () => {
    const sessionFile = nextSessionFile();
    const cfg = makeOpenAiConfig(["mock-error"]);
    await ensureModels(cfg);

    const result = await runEmbeddedPiAgent({
      sessionId: "session:test",
      sessionKey: testSessionKey,
      sessionFile,
      workspaceDir,
      config: cfg,
      prompt: "boom",
      provider: "openai",
      model: "mock-error",
      timeoutMs: 5_000,
      agentDir,
      enqueue: immediateEnqueue,
    });
    expect(result.payloads[0]?.isError).toBe(true);
    expect(result.meta.systemPromptReport?.source).toBe("run");

    const messages = await readSessionMessages(sessionFile);
    const userIndex = messages.findIndex(
      (message) => message?.role === "user" && textFromContent(message.content) === "boom",
    );
    expect(userIndex).toBeGreaterThanOrEqual(0);
  });

  it(
    "appends new user + assistant after existing transcript entries",
    { timeout: 90_000 },
    async () => {
      const { SessionManager } = await import("../agent-core/coding.js");
      const sessionFile = nextSessionFile();

      const sessionManager = SessionManager.open(sessionFile);
      sessionManager.appendMessage({
        role: "user",
        content: [{ type: "text", text: "seed user" }],
      });
      sessionManager.appendMessage({
        role: "assistant",
        content: [{ type: "text", text: "seed assistant" }],
        stopReason: "stop",
        api: "openai-responses",
        provider: "openai",
        model: "mock-1",
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0,
          },
        },
        timestamp: Date.now(),
      });

      const cfg = makeOpenAiConfig(["mock-1"]);
      await ensureModels(cfg);

      const result = await runEmbeddedPiAgent({
        sessionId: "session:test",
        sessionKey: testSessionKey,
        sessionFile,
        workspaceDir,
        config: cfg,
        prompt: "hello",
        provider: "openai",
        model: "mock-1",
        timeoutMs: 5_000,
        agentDir,
        enqueue: immediateEnqueue,
      });

      expect(result.meta.systemPromptReport?.source).toBe("run");

      const messages = await readSessionMessages(sessionFile);
      const seedUserIndex = messages.findIndex(
        (message) => message?.role === "user" && textFromContent(message.content) === "seed user",
      );
      const seedAssistantIndex = messages.findIndex(
        (message) =>
          message?.role === "assistant" && textFromContent(message.content) === "seed assistant",
      );
      const newUserIndex = messages.findIndex(
        (message) => message?.role === "user" && textFromContent(message.content) === "hello",
      );
      const newAssistantIndex = messages.findIndex(
        (message, index) => index > newUserIndex && message?.role === "assistant",
      );
      expect(seedUserIndex).toBeGreaterThanOrEqual(0);
      expect(seedAssistantIndex).toBeGreaterThan(seedUserIndex);
      expect(newUserIndex).toBeGreaterThan(seedAssistantIndex);
      expect(newAssistantIndex).toBeGreaterThan(newUserIndex);
    },
  );

  it("persists multi-turn user/assistant ordering across runs", async () => {
    const sessionFile = nextSessionFile();
    const cfg = makeOpenAiConfig(["mock-1"]);
    await ensureModels(cfg);

    await runEmbeddedPiAgent({
      sessionId: "session:test",
      sessionKey: testSessionKey,
      sessionFile,
      workspaceDir,
      config: cfg,
      prompt: "first",
      provider: "openai",
      model: "mock-1",
      timeoutMs: 5_000,
      agentDir,
      enqueue: immediateEnqueue,
    });

    await runEmbeddedPiAgent({
      sessionId: "session:test",
      sessionKey: testSessionKey,
      sessionFile,
      workspaceDir,
      config: cfg,
      prompt: "second",
      provider: "openai",
      model: "mock-1",
      timeoutMs: 5_000,
      agentDir,
      enqueue: immediateEnqueue,
    });

    const messages = await readSessionMessages(sessionFile);
    const firstUserIndex = messages.findIndex(
      (message) => message?.role === "user" && textFromContent(message.content) === "first",
    );
    const firstAssistantIndex = messages.findIndex(
      (message, index) => index > firstUserIndex && message?.role === "assistant",
    );
    const secondUserIndex = messages.findIndex(
      (message, index) =>
        index > firstAssistantIndex &&
        message?.role === "user" &&
        textFromContent(message.content) === "second",
    );
    const secondAssistantIndex = messages.findIndex(
      (message, index) => index > secondUserIndex && message?.role === "assistant",
    );

    expect(firstUserIndex).toBeGreaterThanOrEqual(0);
    expect(firstAssistantIndex).toBeGreaterThan(firstUserIndex);
    expect(secondUserIndex).toBeGreaterThan(firstAssistantIndex);
    expect(secondAssistantIndex).toBeGreaterThan(secondUserIndex);
  });

  it("repairs orphaned user messages and continues", async () => {
    const { SessionManager } = await import("../agent-core/coding.js");
    const sessionFile = nextSessionFile();

    const sessionManager = SessionManager.open(sessionFile);
    sessionManager.appendMessage({
      role: "user",
      content: [{ type: "text", text: "orphaned user" }],
    });

    const cfg = makeOpenAiConfig(["mock-1"]);
    await ensureModels(cfg);

    const result = await runEmbeddedPiAgent({
      sessionId: "session:test",
      sessionKey: testSessionKey,
      sessionFile,
      workspaceDir,
      config: cfg,
      prompt: "hello",
      provider: "openai",
      model: "mock-1",
      timeoutMs: 5_000,
      agentDir,
      enqueue: immediateEnqueue,
    });

    expect(result.meta.error).toBeUndefined();
    expect(result.payloads?.length ?? 0).toBeGreaterThan(0);
  });

  it("repairs orphaned single-user sessions and continues", async () => {
    const { SessionManager } = await import("../agent-core/coding.js");
    const sessionFile = nextSessionFile();

    const sessionManager = SessionManager.open(sessionFile);
    sessionManager.appendMessage({
      role: "user",
      content: [{ type: "text", text: "solo user" }],
    });

    const cfg = makeOpenAiConfig(["mock-1"]);
    await ensureModels(cfg);

    const result = await runEmbeddedPiAgent({
      sessionId: "session:test",
      sessionKey: testSessionKey,
      sessionFile,
      workspaceDir,
      config: cfg,
      prompt: "hello",
      provider: "openai",
      model: "mock-1",
      timeoutMs: 5_000,
      agentDir,
      enqueue: immediateEnqueue,
    });

    expect(result.meta.error).toBeUndefined();
    expect(result.payloads?.length ?? 0).toBeGreaterThan(0);
  });

  it("logs preselected upstream models distinctly from user overrides", async () => {
    const sessionFile = nextSessionFile();
    const cfg = {
      ...makeOpenAiConfig(["mock-1"]),
      agents: {
        defaults: {
          model: {
            primary: "openai/mock-1",
          },
          modelRouter: {
            enabled: true,
            activeProfile: "default",
          },
        },
      },
    } satisfies ArgentConfig;
    await ensureModels(cfg);

    const { log } = await import("./pi-embedded-runner/logger.js");
    const infoSpy = vi.spyOn(log, "info").mockImplementation(() => {});

    let modelRouterCall: string | undefined;
    try {
      await runEmbeddedPiAgent({
        sessionId: "session:test",
        sessionKey: testSessionKey,
        sessionFile,
        workspaceDir,
        config: cfg,
        prompt: "hello",
        provider: "openai",
        model: "mock-1",
        preselectedModel: true,
        timeoutMs: 5_000,
        agentDir,
        enqueue: immediateEnqueue,
      });
      modelRouterCall = infoSpy.mock.calls
        .map(([message]) => String(message))
        .find((message) => message.includes("[model-router]"));
    } finally {
      infoSpy.mockRestore();
    }

    expect(modelRouterCall).toContain('reason="preselected model"');
    expect(modelRouterCall).not.toContain('reason="user override"');
  });

  it("routes deep think to the powerful tier even with a preselected model", async () => {
    const sessionFile = nextSessionFile();
    const cfg = {
      ...makeOpenAiConfig(["mock-1", "powerful-model"]),
      agents: {
        defaults: {
          model: {
            primary: "openai/mock-1",
          },
          modelRouter: {
            enabled: true,
            activeProfile: "test-profile",
            profiles: {
              "test-profile": {
                tiers: {
                  local: { provider: "openai", model: "mock-1" },
                  fast: { provider: "openai", model: "mock-1" },
                  balanced: { provider: "openai", model: "mock-1" },
                  powerful: { provider: "openai", model: "powerful-model" },
                },
              },
            },
          },
        },
      },
    } satisfies ArgentConfig;
    await ensureModels(cfg);

    const { log } = await import("./pi-embedded-runner/logger.js");
    const infoSpy = vi.spyOn(log, "info").mockImplementation(() => {});

    let modelRouterCall: string | undefined;
    try {
      await runEmbeddedPiAgent({
        sessionId: "session:test",
        sessionKey: testSessionKey,
        sessionFile,
        workspaceDir,
        config: cfg,
        prompt: "[DEEP_THINK] hello",
        provider: "openai",
        model: "mock-1",
        preselectedModel: true,
        timeoutMs: 5_000,
        agentDir,
        enqueue: immediateEnqueue,
      });
      modelRouterCall = infoSpy.mock.calls
        .map(([message]) => String(message))
        .find((message) => message.includes("[model-router]"));
    } finally {
      infoSpy.mockRestore();
    }

    expect(modelRouterCall).toContain('reason="forceMaxTier (deep think)"');
    expect(modelRouterCall).toContain("openai/powerful-model");
  });
});
