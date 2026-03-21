import type {
  ProxyAssistantMessageEvent as PiProxyEvent,
  ProxyStreamOptions as PiProxyOpts,
} from "@mariozechner/pi-agent-core";
import { streamProxy as piStreamProxy } from "@mariozechner/pi-agent-core";
// Direct Pi implementations for comparison
import { estimateTokens as piEstimateTokens } from "@mariozechner/pi-coding-agent";
/**
 * Seam Swap Parity Tests
 *
 * Validates that agent-core exports backed by argent-* produce the same
 * shapes, types, and behavior as the original pi-* implementations.
 *
 * These tests run BOTH implementations side-by-side and compare output.
 */
import { describe, expect, it } from "vitest";
// Direct Argent implementations
import { estimateTokens as argentEstimateTokens } from "../argent-agent/compaction-utils.js";
import {
  streamProxy as argentStreamProxy,
  type ProxyAssistantMessageEvent,
  type ProxyStreamOptions,
} from "../argent-agent/proxy-stream.js";
import * as ai from "./ai.js";
import * as coding from "./coding.js";
// Argent-native implementations (through agent-core seam)
import * as core from "./core.js";

// ============================================================================
// 1) Export Surface Parity
// ============================================================================

describe("seam swap: export surface parity", () => {
  it("core.ts exports streamProxy as a function", () => {
    expect(typeof core.streamProxy).toBe("function");
  });

  it("coding.ts exports estimateTokens as a function", () => {
    expect(typeof coding.estimateTokens).toBe("function");
  });

  it("coding.ts exports generateSummary as a function", () => {
    expect(typeof coding.generateSummary).toBe("function");
  });

  it("coding.ts exports createAgentSession as Pi-compat alias", () => {
    expect(typeof coding.createAgentSession).toBe("function");
    expect(coding.createAgentSession).toBe(coding.createArgentAgentSession);
  });

  it("ai.ts exports complete as a function", () => {
    expect(typeof ai.complete).toBe("function");
  });

  it("ai.ts exports getModel as a function", () => {
    expect(typeof ai.getModel).toBe("function");
  });

  it("ai.ts exports registerApiProvider as a function", () => {
    expect(typeof ai.registerApiProvider).toBe("function");
  });
});

// ============================================================================
// 2) estimateTokens Parity — chars/4 heuristic
// ============================================================================

describe("seam swap: estimateTokens parity", () => {
  // Build test messages that match Pi's AgentMessage shapes

  const userStringMessage = {
    role: "user" as const,
    content: "Hello, this is a test message with some content.",
    timestamp: Date.now(),
  };

  const userArrayMessage = {
    role: "user" as const,
    content: [
      { type: "text" as const, text: "First block of text." },
      { type: "text" as const, text: "Second block of text." },
    ],
    timestamp: Date.now(),
  };

  const assistantMessage = {
    role: "assistant" as const,
    content: [
      { type: "text" as const, text: "Here is my response to your query." },
      { type: "thinking" as const, thinking: "Let me think about this carefully." },
      {
        type: "toolCall" as const,
        id: "call_1",
        name: "web_search",
        arguments: { query: "test search" },
      },
    ],
    api: "anthropic" as const,
    provider: "anthropic",
    model: "claude-3",
    usage: {
      input: 10,
      output: 20,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 30,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop" as const,
    timestamp: Date.now(),
  };

  const toolResultMessage = {
    role: "toolResult" as const,
    toolCallId: "call_1",
    toolName: "web_search",
    content: [{ type: "text" as const, text: "Search results: found 10 items." }],
    isError: false,
    timestamp: Date.now(),
  };

  const bashMessage = {
    role: "bashExecution" as const,
    command: "ls -la /tmp",
    output: "total 128\ndrwxrwxrwt 12 root root 4096 Mar 5 21:00 .",
    exitCode: 0,
    timestamp: Date.now(),
  };

  const summaryMessage = {
    role: "compactionSummary" as const,
    summary: "We discussed the architecture of the new system and agreed on the approach.",
    timestamp: Date.now(),
  };

  it("user string message — matches Pi output", () => {
    const piResult = piEstimateTokens(userStringMessage);
    const argentResult = argentEstimateTokens(userStringMessage);
    expect(argentResult).toBe(piResult);
    // Also verify the seam-exported version
    expect(coding.estimateTokens(userStringMessage)).toBe(piResult);
  });

  it("user array message — matches Pi output", () => {
    const piResult = piEstimateTokens(userArrayMessage);
    const argentResult = argentEstimateTokens(userArrayMessage);
    expect(argentResult).toBe(piResult);
  });

  it("assistant message — matches Pi output", () => {
    const piResult = piEstimateTokens(assistantMessage);
    const argentResult = argentEstimateTokens(assistantMessage);
    expect(argentResult).toBe(piResult);
  });

  it("tool result message — matches Pi output", () => {
    const piResult = piEstimateTokens(toolResultMessage);
    const argentResult = argentEstimateTokens(toolResultMessage);
    expect(argentResult).toBe(piResult);
  });

  it("bash execution message — matches Pi output", () => {
    const piResult = piEstimateTokens(bashMessage);
    const argentResult = argentEstimateTokens(bashMessage);
    expect(argentResult).toBe(piResult);
  });

  it("compaction summary — matches Pi output", () => {
    const piResult = piEstimateTokens(summaryMessage);
    const argentResult = argentEstimateTokens(summaryMessage);
    expect(argentResult).toBe(piResult);
  });

  it("unknown role returns 0", () => {
    const unknownMsg = { role: "unknown_thing" as string };
    expect(argentEstimateTokens(unknownMsg)).toBe(0);
  });

  it("empty content returns 0", () => {
    const emptyUser = { role: "user" as const, content: "" };
    const piResult = piEstimateTokens(emptyUser);
    const argentResult = argentEstimateTokens(emptyUser);
    expect(argentResult).toBe(0);
    expect(argentResult).toBe(piResult);
  });

  it("image in tool result counts as 4800 chars", () => {
    const imageMsg = {
      role: "toolResult" as const,
      toolCallId: "call_2",
      toolName: "screenshot",
      content: [{ type: "image" as const, mimeType: "image/png", data: "base64data" }],
      isError: false,
      timestamp: Date.now(),
    };
    const piResult = piEstimateTokens(imageMsg);
    const argentResult = argentEstimateTokens(imageMsg);
    expect(argentResult).toBe(piResult);
    expect(argentResult).toBe(Math.ceil(4800 / 4)); // 1200 tokens
  });
});

// ============================================================================
// 3) ProxyStreamOptions type shape parity
// ============================================================================

describe("seam swap: proxy stream type parity", () => {
  it("streamProxy is exported and callable", () => {
    expect(typeof argentStreamProxy).toBe("function");
    expect(typeof piStreamProxy).toBe("function");
    // Both should take (model, context, options)
    expect(argentStreamProxy.length).toBe(piStreamProxy.length);
  });

  it("ProxyStreamOptions has the same required fields", () => {
    // Validate the shape compiles — this is really a compile-time check
    const opts: ProxyStreamOptions = {
      authToken: "test",
      proxyUrl: "https://example.com",
    };
    // Pi version
    const piOpts: PiProxyOpts = {
      authToken: "test",
      proxyUrl: "https://example.com",
    };
    expect(opts.authToken).toBe(piOpts.authToken);
    expect(opts.proxyUrl).toBe(piOpts.proxyUrl);
  });

  it("ProxyAssistantMessageEvent covers all event types", () => {
    // Validate all event types compile
    const events: ProxyAssistantMessageEvent[] = [
      { type: "start" },
      { type: "text_start", contentIndex: 0 },
      { type: "text_delta", contentIndex: 0, delta: "hi" },
      { type: "text_end", contentIndex: 0 },
      { type: "thinking_start", contentIndex: 0 },
      { type: "thinking_delta", contentIndex: 0, delta: "hmm" },
      { type: "thinking_end", contentIndex: 0 },
      { type: "toolcall_start", contentIndex: 0, id: "tc1", toolName: "test" },
      { type: "toolcall_delta", contentIndex: 0, delta: "{" },
      { type: "toolcall_end", contentIndex: 0 },
      {
        type: "done",
        reason: "stop",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      },
      {
        type: "error",
        reason: "error",
        errorMessage: "fail",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      },
    ];
    expect(events).toHaveLength(12);
  });
});

// ============================================================================
// 4) Core export symbol parity — nothing dropped
// ============================================================================

describe("seam swap: no dropped exports", () => {
  it("core.ts has all critical symbols", () => {
    // Agent
    expect(typeof core.Agent).toBe("function");
    expect(typeof core.createAgent).toBe("function");
    expect(typeof core.agentLoop).toBe("function");
    expect(typeof core.agentLoopV2).toBe("function");
    expect(typeof core.coreLoop).toBe("function");

    // Events
    expect(typeof core.isStreamEvent).toBe("function");
    expect(typeof core.isToolEvent).toBe("function");
    expect(typeof core.isLoopEvent).toBe("function");

    // Tools
    expect(typeof core.ToolRegistry).toBe("function");
    expect(typeof core.executeToolCall).toBe("function");
    expect(typeof core.ToolExecutor).toBe("function");
    expect(typeof core.createToolExecutor).toBe("function");

    // Policies
    expect(typeof core.createAllowlistPolicy).toBe("function");
    expect(typeof core.createDenylistPolicy).toBe("function");
    expect(typeof core.createPermissionPolicy).toBe("function");
    expect(typeof core.createRateLimitPolicy).toBe("function");

    // Hooks
    expect(typeof core.createAuditHook).toBe("function");
    expect(typeof core.createErrorRetryHook).toBe("function");
    expect(typeof core.createValidationHook).toBe("function");

    // Session
    expect(typeof core.Session).toBe("function");
    expect(typeof core.SessionStore).toBe("function");
    expect(typeof core.compactMessages).toBe("function");
    expect(typeof core.needsCompaction).toBe("function");

    // Proxy (was pi-agent-core, now argent-native)
    expect(typeof core.streamProxy).toBe("function");

    // In-memory test helpers
    expect(typeof core.InMemoryStateManager).toBe("function");
    expect(typeof core.InMemoryEventBus).toBe("function");
    expect(typeof core.NoopEventBus).toBe("function");
  });

  it("ai.ts has all critical symbols", () => {
    // Type re-export (runtime value check where available)
    expect(typeof ai.complete).toBe("function");
    expect(typeof ai.completeSimple).toBe("function");
    expect(typeof ai.stream).toBe("function");
    expect(typeof ai.streamSimple).toBe("function");

    // Model DB
    expect(typeof ai.getModel).toBe("function");
    expect(typeof ai.getModels).toBe("function");
    expect(typeof ai.getProviders).toBe("function");
    expect(typeof ai.calculateCost).toBe("function");
    expect(typeof ai.MODELS).toBe("object");

    // Registry
    expect(typeof ai.registerApiProvider).toBe("function");
    expect(typeof ai.getApiProvider).toBe("function");
    expect(typeof ai.clearApiProviders).toBe("function");

    // Event stream
    expect(typeof ai.createAssistantMessageEventStream).toBe("function");

    // Compat bridge
    expect(typeof ai.createArgentStreamSimple).toBe("function");
    expect(typeof ai.piModelToArgentConfig).toBe("function");
    expect(typeof ai.piContextToArgentRequest).toBe("function");
  });

  it("coding.ts has all critical symbols", () => {
    // Session Manager
    expect(typeof coding.SessionManager).toBe("function");
    expect(typeof coding.ArgentSessionManager).toBe("function");
    expect(typeof coding.buildSessionContext).toBe("function");
    expect(typeof coding.CURRENT_SESSION_VERSION).toBe("number");

    // Settings
    expect(typeof coding.SettingsManager).toBe("function");
    expect(typeof coding.ArgentSettingsManager).toBe("function");

    // File tools
    expect(typeof coding.createReadTool).toBe("function");
    expect(typeof coding.createWriteTool).toBe("function");
    expect(typeof coding.createEditTool).toBe("function");
    expect(typeof coding.createBashTool).toBe("function");
    expect(typeof coding.codingTools).toBe("object");
    expect(typeof coding.readTool).toBe("object");

    // Skills
    expect(typeof coding.loadSkillsFromDir).toBe("function");
    expect(typeof coding.loadSkills).toBe("function");
    expect(typeof coding.formatSkillsForPrompt).toBe("function");

    // Factory
    expect(typeof coding.createAgentSession).toBe("function");
    expect(typeof coding.createArgentAgentSession).toBe("function");

    // Compaction
    expect(typeof coding.estimateTokens).toBe("function");
    expect(typeof coding.generateSummary).toBe("function");

    // Argent aliases
    expect(typeof coding.argentCreateReadTool).toBe("function");
    expect(typeof coding.argentLoadSkillsFromDir).toBe("function");
  });
});
