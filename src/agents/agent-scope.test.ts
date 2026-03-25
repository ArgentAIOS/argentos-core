import { describe, expect, it } from "vitest";
import type { ArgentConfig } from "../config/config.js";
import {
  resolveAgentConfig,
  resolveMemoryAgentId,
  resolveAgentModelFallbacksOverride,
  resolveAgentModelPrimary,
} from "./agent-scope.js";

describe("resolveAgentConfig", () => {
  it("should return undefined when no agents config exists", () => {
    const cfg: ArgentConfig = {};
    const result = resolveAgentConfig(cfg, "main");
    expect(result).toBeUndefined();
  });

  it("should return undefined when agent id does not exist", () => {
    const cfg: ArgentConfig = {
      agents: {
        list: [{ id: "main", workspace: "~/argent" }],
      },
    };
    const result = resolveAgentConfig(cfg, "nonexistent");
    expect(result).toBeUndefined();
  });

  it("should return basic agent config", () => {
    const cfg: ArgentConfig = {
      agents: {
        list: [
          {
            id: "main",
            name: "Main Agent",
            workspace: "~/argent",
            agentDir: "~/.argentos/agents/main",
            model: "anthropic/claude-opus-4",
          },
        ],
      },
    };
    const result = resolveAgentConfig(cfg, "main");
    expect(result).toEqual({
      name: "Main Agent",
      workspace: "~/argent",
      agentDir: "~/.argentos/agents/main",
      model: "anthropic/claude-opus-4",
      identity: undefined,
      groupChat: undefined,
      subagents: undefined,
      sandbox: undefined,
      tools: undefined,
    });
  });

  it("supports per-agent model primary+fallbacks", () => {
    const cfg: ArgentConfig = {
      agents: {
        defaults: {
          model: {
            primary: "anthropic/claude-sonnet-4",
            fallbacks: ["openai/gpt-4.1"],
          },
        },
        list: [
          {
            id: "linus",
            model: {
              primary: "anthropic/claude-opus-4",
              fallbacks: ["openai/gpt-5.2"],
            },
          },
        ],
      },
    };

    expect(resolveAgentModelPrimary(cfg, "linus")).toBe("anthropic/claude-opus-4");
    expect(resolveAgentModelFallbacksOverride(cfg, "linus")).toEqual(["openai/gpt-5.2"]);

    // If fallbacks isn't present, we don't override the global fallbacks.
    const cfgNoOverride: ArgentConfig = {
      agents: {
        list: [
          {
            id: "linus",
            model: {
              primary: "anthropic/claude-opus-4",
            },
          },
        ],
      },
    };
    expect(resolveAgentModelFallbacksOverride(cfgNoOverride, "linus")).toBe(undefined);

    // Explicit empty list disables global fallbacks for that agent.
    const cfgDisable: ArgentConfig = {
      agents: {
        list: [
          {
            id: "linus",
            model: {
              primary: "anthropic/claude-opus-4",
              fallbacks: [],
            },
          },
        ],
      },
    };
    expect(resolveAgentModelFallbacksOverride(cfgDisable, "linus")).toEqual([]);
  });

  it("should return agent-specific sandbox config", () => {
    const cfg: ArgentConfig = {
      agents: {
        list: [
          {
            id: "work",
            workspace: "~/argent-work",
            sandbox: {
              mode: "all",
              scope: "agent",
              perSession: false,
              workspaceAccess: "ro",
              workspaceRoot: "~/sandboxes",
            },
          },
        ],
      },
    };
    const result = resolveAgentConfig(cfg, "work");
    expect(result?.sandbox).toEqual({
      mode: "all",
      scope: "agent",
      perSession: false,
      workspaceAccess: "ro",
      workspaceRoot: "~/sandboxes",
    });
  });

  it("should return agent-specific tools config", () => {
    const cfg: ArgentConfig = {
      agents: {
        list: [
          {
            id: "restricted",
            workspace: "~/argent-restricted",
            tools: {
              allow: ["read"],
              deny: ["exec", "write", "edit"],
              elevated: {
                enabled: false,
                allowFrom: { whatsapp: ["+15555550123"] },
              },
            },
          },
        ],
      },
    };
    const result = resolveAgentConfig(cfg, "restricted");
    expect(result?.tools).toEqual({
      allow: ["read"],
      deny: ["exec", "write", "edit"],
      elevated: {
        enabled: false,
        allowFrom: { whatsapp: ["+15555550123"] },
      },
    });
  });

  it("should return both sandbox and tools config", () => {
    const cfg: ArgentConfig = {
      agents: {
        list: [
          {
            id: "family",
            workspace: "~/argent-family",
            sandbox: {
              mode: "all",
              scope: "agent",
            },
            tools: {
              allow: ["read"],
              deny: ["exec"],
            },
          },
        ],
      },
    };
    const result = resolveAgentConfig(cfg, "family");
    expect(result?.sandbox?.mode).toBe("all");
    expect(result?.tools?.allow).toEqual(["read"]);
  });

  it("should normalize agent id", () => {
    const cfg: ArgentConfig = {
      agents: {
        list: [{ id: "main", workspace: "~/argent" }],
      },
    };
    // Should normalize to "main" (default)
    const result = resolveAgentConfig(cfg, "");
    expect(result).toBeDefined();
    expect(result?.workspace).toBe("~/argent");
  });
});

describe("resolveMemoryAgentId", () => {
  it("maps legacy main sessions to argent when argent is the configured default", () => {
    const cfg: ArgentConfig = {
      agents: {
        list: [{ id: "argent", default: true }, { id: "main" }],
      },
    };

    expect(
      resolveMemoryAgentId({
        sessionKey: "agent:main:webchat",
        config: cfg,
      }),
    ).toBe("argent");
    expect(
      resolveMemoryAgentId({
        agentId: "main",
        config: cfg,
      }),
    ).toBe("argent");
  });

  it("keeps explicit non-legacy agents untouched", () => {
    const cfg: ArgentConfig = {
      agents: {
        list: [{ id: "argent", default: true }, { id: "main" }, { id: "dario" }],
      },
    };

    expect(
      resolveMemoryAgentId({
        sessionKey: "agent:dario:discord:dm:123",
        config: cfg,
      }),
    ).toBe("dario");
    expect(
      resolveMemoryAgentId({
        sessionKey: "agent:argent:webchat",
        config: cfg,
      }),
    ).toBe("argent");
  });

  it("does not remap main when main is still the default agent", () => {
    const cfg: ArgentConfig = {
      agents: {
        list: [{ id: "main", default: true }, { id: "argent" }],
      },
    };

    expect(
      resolveMemoryAgentId({
        sessionKey: "agent:main:webchat",
        config: cfg,
      }),
    ).toBe("main");
  });
});
