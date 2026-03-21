import { describe, expect, it } from "vitest";
import "./test-helpers/fast-coding-tools.js";
import type { ArgentConfig } from "../config/config.js";
import type { SandboxDockerConfig } from "./sandbox.js";
import { createArgentCodingTools } from "./pi-tools.js";

describe("Agent-specific tool filtering", () => {
  it("should apply global tool policy when no agent-specific policy exists", () => {
    const cfg: ArgentConfig = {
      tools: {
        allow: ["read", "write"],
        deny: ["bash"],
      },
      agents: {
        list: [
          {
            id: "main",
            workspace: "~/argent",
          },
        ],
      },
    };

    const tools = createArgentCodingTools({
      config: cfg,
      sessionKey: "agent:main:main",
      workspaceDir: "/tmp/test",
      agentDir: "/tmp/agent",
    });

    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("read");
    expect(toolNames).toContain("write");
    expect(toolNames).not.toContain("exec");
    expect(toolNames).not.toContain("apply_patch");
  });

  it("should keep global tool policy when agent only sets tools.elevated", () => {
    const cfg: ArgentConfig = {
      tools: {
        deny: ["write"],
      },
      agents: {
        list: [
          {
            id: "main",
            workspace: "~/argent",
            tools: {
              elevated: {
                enabled: true,
                allowFrom: { whatsapp: ["+15555550123"] },
              },
            },
          },
        ],
      },
    };

    const tools = createArgentCodingTools({
      config: cfg,
      sessionKey: "agent:main:main",
      workspaceDir: "/tmp/test",
      agentDir: "/tmp/agent",
    });

    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("exec");
    expect(toolNames).toContain("read");
    expect(toolNames).not.toContain("write");
    expect(toolNames).not.toContain("apply_patch");
  });

  it("should allow apply_patch when exec is allow-listed and applyPatch is enabled", () => {
    const cfg: ArgentConfig = {
      tools: {
        allow: ["read", "exec"],
        exec: {
          applyPatch: { enabled: true },
        },
      },
    };

    const tools = createArgentCodingTools({
      config: cfg,
      sessionKey: "agent:main:main",
      workspaceDir: "/tmp/test",
      agentDir: "/tmp/agent",
      modelProvider: "openai",
      modelId: "gpt-5.2",
    });

    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("read");
    expect(toolNames).toContain("exec");
    expect(toolNames).toContain("apply_patch");
  });

  it("should apply agent-specific tool policy", () => {
    const cfg: ArgentConfig = {
      tools: {
        allow: ["read", "write", "exec"],
        deny: [],
      },
      agents: {
        list: [
          {
            id: "restricted",
            workspace: "~/argent-restricted",
            tools: {
              allow: ["read"], // Agent override: only read
              deny: ["exec", "write", "edit"],
            },
          },
        ],
      },
    };

    const tools = createArgentCodingTools({
      config: cfg,
      sessionKey: "agent:restricted:main",
      workspaceDir: "/tmp/test-restricted",
      agentDir: "/tmp/agent-restricted",
    });

    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("read");
    expect(toolNames).not.toContain("exec");
    expect(toolNames).not.toContain("write");
    expect(toolNames).not.toContain("apply_patch");
    expect(toolNames).not.toContain("edit");
  });

  it("should keep exec visible when approval is required via tools.ask", () => {
    const cfg: ArgentConfig = {
      agents: {
        list: [
          {
            id: "main",
            workspace: "~/argent",
            tools: {
              ask: ["exec"],
            },
          },
        ],
      },
    };

    const tools = createArgentCodingTools({
      config: cfg,
      sessionKey: "agent:main:main",
      workspaceDir: "/tmp/test-ask-exec",
      agentDir: "/tmp/agent-ask-exec",
    });

    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("exec");
  });

  it("should apply department-level tool policy before agent overrides", () => {
    const cfg: ArgentConfig = {
      tools: {
        allow: ["read", "write", "exec"],
        departments: {
          support: {
            allow: ["read"],
            deny: ["exec", "write"],
          },
        },
      },
      intent: {
        agents: {
          main: {
            departmentId: "support",
          },
        },
      },
      agents: {
        list: [
          {
            id: "main",
            workspace: "~/argent",
          },
        ],
      },
    };

    const tools = createArgentCodingTools({
      config: cfg,
      sessionKey: "agent:main:main",
      workspaceDir: "/tmp/test-department-policy",
      agentDir: "/tmp/agent-department-policy",
    });

    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("read");
    expect(toolNames).not.toContain("exec");
    expect(toolNames).not.toContain("write");
  });

  it("should require approval when department policy marks exec as ask", () => {
    const cfg: ArgentConfig = {
      tools: {
        departments: {
          support: {
            ask: ["exec"],
          },
        },
      },
      intent: {
        agents: {
          main: {
            departmentId: "support",
          },
        },
      },
      agents: {
        list: [
          {
            id: "main",
            workspace: "~/argent",
          },
        ],
      },
    };

    const tools = createArgentCodingTools({
      config: cfg,
      sessionKey: "agent:main:main",
      workspaceDir: "/tmp/test-department-ask-exec",
      agentDir: "/tmp/agent-department-ask-exec",
    });

    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("exec");
  });

  it("should apply provider-specific tool policy", () => {
    const cfg: ArgentConfig = {
      tools: {
        allow: ["read", "write", "exec"],
        byProvider: {
          "google-antigravity": {
            allow: ["read"],
          },
        },
      },
    };

    const tools = createArgentCodingTools({
      config: cfg,
      sessionKey: "agent:main:main",
      workspaceDir: "/tmp/test-provider",
      agentDir: "/tmp/agent-provider",
      modelProvider: "google-antigravity",
      modelId: "claude-opus-4-5-thinking",
    });

    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("read");
    expect(toolNames).not.toContain("exec");
    expect(toolNames).not.toContain("write");
    expect(toolNames).not.toContain("apply_patch");
  });

  it("should apply provider-specific tool profile overrides", () => {
    const cfg: ArgentConfig = {
      tools: {
        profile: "coding",
        byProvider: {
          "google-antigravity": {
            profile: "minimal",
          },
        },
      },
    };

    const tools = createArgentCodingTools({
      config: cfg,
      sessionKey: "agent:main:main",
      workspaceDir: "/tmp/test-provider-profile",
      agentDir: "/tmp/agent-provider-profile",
      modelProvider: "google-antigravity",
      modelId: "claude-opus-4-5-thinking",
    });

    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toEqual(["session_status"]);
  });

  it("should allow different tool policies for different agents", () => {
    const cfg: ArgentConfig = {
      agents: {
        list: [
          {
            id: "main",
            workspace: "~/argent",
            // No tools restriction - all tools available
          },
          {
            id: "family",
            workspace: "~/argent-family",
            tools: {
              allow: ["read"],
              deny: ["exec", "write", "edit", "process"],
            },
          },
        ],
      },
    };

    // main agent: all tools
    const mainTools = createArgentCodingTools({
      config: cfg,
      sessionKey: "agent:main:main",
      workspaceDir: "/tmp/test-main",
      agentDir: "/tmp/agent-main",
    });
    const mainToolNames = mainTools.map((t) => t.name);
    expect(mainToolNames).toContain("exec");
    expect(mainToolNames).toContain("write");
    expect(mainToolNames).toContain("edit");
    expect(mainToolNames).not.toContain("apply_patch");

    // family agent: restricted
    const familyTools = createArgentCodingTools({
      config: cfg,
      sessionKey: "agent:family:whatsapp:group:123",
      workspaceDir: "/tmp/test-family",
      agentDir: "/tmp/agent-family",
    });
    const familyToolNames = familyTools.map((t) => t.name);
    expect(familyToolNames).toContain("read");
    expect(familyToolNames).not.toContain("exec");
    expect(familyToolNames).not.toContain("write");
    expect(familyToolNames).not.toContain("edit");
    expect(familyToolNames).not.toContain("apply_patch");
  });

  it("should apply group tool policy overrides (group-specific beats wildcard)", () => {
    const cfg: ArgentConfig = {
      channels: {
        whatsapp: {
          groups: {
            "*": {
              tools: { allow: ["read"] },
            },
            trusted: {
              tools: { allow: ["read", "exec"] },
            },
          },
        },
      },
    };

    const trustedTools = createArgentCodingTools({
      config: cfg,
      sessionKey: "agent:main:whatsapp:group:trusted",
      messageProvider: "whatsapp",
      workspaceDir: "/tmp/test-group-trusted",
      agentDir: "/tmp/agent-group",
    });
    const trustedNames = trustedTools.map((t) => t.name);
    expect(trustedNames).toContain("read");
    expect(trustedNames).toContain("exec");

    const defaultTools = createArgentCodingTools({
      config: cfg,
      sessionKey: "agent:main:whatsapp:group:unknown",
      messageProvider: "whatsapp",
      workspaceDir: "/tmp/test-group-default",
      agentDir: "/tmp/agent-group",
    });
    const defaultNames = defaultTools.map((t) => t.name);
    expect(defaultNames).toContain("read");
    expect(defaultNames).not.toContain("exec");
  });

  it("should apply per-sender tool policies for group tools", () => {
    const cfg: ArgentConfig = {
      channels: {
        whatsapp: {
          groups: {
            "*": {
              tools: { allow: ["read"] },
              toolsBySender: {
                alice: { allow: ["read", "exec"] },
              },
            },
          },
        },
      },
    };

    const aliceTools = createArgentCodingTools({
      config: cfg,
      sessionKey: "agent:main:whatsapp:group:family",
      senderId: "alice",
      workspaceDir: "/tmp/test-group-sender",
      agentDir: "/tmp/agent-group-sender",
    });
    const aliceNames = aliceTools.map((t) => t.name);
    expect(aliceNames).toContain("read");
    expect(aliceNames).toContain("exec");

    const bobTools = createArgentCodingTools({
      config: cfg,
      sessionKey: "agent:main:whatsapp:group:family",
      senderId: "bob",
      workspaceDir: "/tmp/test-group-sender-bob",
      agentDir: "/tmp/agent-group-sender",
    });
    const bobNames = bobTools.map((t) => t.name);
    expect(bobNames).toContain("read");
    expect(bobNames).not.toContain("exec");
  });

  it("should not let default sender policy override group tools", () => {
    const cfg: ArgentConfig = {
      channels: {
        whatsapp: {
          groups: {
            "*": {
              toolsBySender: {
                admin: { allow: ["read", "exec"] },
              },
            },
            locked: {
              tools: { allow: ["read"] },
            },
          },
        },
      },
    };

    const adminTools = createArgentCodingTools({
      config: cfg,
      sessionKey: "agent:main:whatsapp:group:locked",
      senderId: "admin",
      workspaceDir: "/tmp/test-group-default-override",
      agentDir: "/tmp/agent-group-default-override",
    });
    const adminNames = adminTools.map((t) => t.name);
    expect(adminNames).toContain("read");
    expect(adminNames).not.toContain("exec");
  });

  it("should resolve telegram group tool policy for topic session keys", () => {
    const cfg: ArgentConfig = {
      channels: {
        telegram: {
          groups: {
            "123": {
              tools: { allow: ["read"] },
            },
          },
        },
      },
    };

    const tools = createArgentCodingTools({
      config: cfg,
      sessionKey: "agent:main:telegram:group:123:topic:456",
      messageProvider: "telegram",
      workspaceDir: "/tmp/test-telegram-topic",
      agentDir: "/tmp/agent-telegram",
    });
    const names = tools.map((t) => t.name);
    expect(names).toContain("read");
    expect(names).not.toContain("exec");
  });

  it("should inherit group tool policy for subagents from spawnedBy session keys", () => {
    const cfg: ArgentConfig = {
      channels: {
        whatsapp: {
          groups: {
            trusted: {
              tools: { allow: ["read"] },
            },
          },
        },
      },
    };

    const tools = createArgentCodingTools({
      config: cfg,
      sessionKey: "agent:main:subagent:test",
      spawnedBy: "agent:main:whatsapp:group:trusted",
      workspaceDir: "/tmp/test-subagent-group",
      agentDir: "/tmp/agent-subagent",
    });
    const names = tools.map((t) => t.name);
    expect(names).toContain("read");
    expect(names).not.toContain("exec");
  });

  it("should apply global tool policy before agent-specific policy", () => {
    const cfg: ArgentConfig = {
      tools: {
        deny: ["browser"], // Global deny
      },
      agents: {
        list: [
          {
            id: "work",
            workspace: "~/argent-work",
            tools: {
              deny: ["exec", "process"], // Agent deny (override)
            },
          },
        ],
      },
    };

    const tools = createArgentCodingTools({
      config: cfg,
      sessionKey: "agent:work:slack:dm:user123",
      workspaceDir: "/tmp/test-work",
      agentDir: "/tmp/agent-work",
    });

    const toolNames = tools.map((t) => t.name);
    // Global policy still applies; agent policy further restricts
    expect(toolNames).not.toContain("browser");
    expect(toolNames).not.toContain("exec");
    expect(toolNames).not.toContain("process");
    expect(toolNames).not.toContain("apply_patch");
  });

  it("should work with sandbox tools filtering", () => {
    const cfg: ArgentConfig = {
      agents: {
        defaults: {
          sandbox: {
            mode: "all",
            scope: "agent",
          },
        },
        list: [
          {
            id: "restricted",
            workspace: "~/argent-restricted",
            sandbox: {
              mode: "all",
              scope: "agent",
            },
            tools: {
              allow: ["read"], // Agent further restricts to only read
              deny: ["exec", "write"],
            },
          },
        ],
      },
      tools: {
        sandbox: {
          tools: {
            allow: ["read", "write", "exec"], // Sandbox allows these
            deny: [],
          },
        },
      },
    };

    const tools = createArgentCodingTools({
      config: cfg,
      sessionKey: "agent:restricted:main",
      workspaceDir: "/tmp/test-restricted",
      agentDir: "/tmp/agent-restricted",
      sandbox: {
        enabled: true,
        sessionKey: "agent:restricted:main",
        workspaceDir: "/tmp/sandbox",
        agentWorkspaceDir: "/tmp/test-restricted",
        workspaceAccess: "none",
        containerName: "test-container",
        containerWorkdir: "/workspace",
        docker: {
          image: "test-image",
          containerPrefix: "test-",
          workdir: "/workspace",
          readOnlyRoot: true,
          tmpfs: [],
          network: "none",
          capDrop: [],
        } satisfies SandboxDockerConfig,
        tools: {
          allow: ["read", "write", "exec"],
          deny: [],
        },
        browserAllowHostControl: false,
      },
    });

    const toolNames = tools.map((t) => t.name);
    // Agent policy should be applied first, then sandbox
    // Agent allows only "read", sandbox allows ["read", "write", "exec"]
    // Result: only "read" (most restrictive wins)
    expect(toolNames).toContain("read");
    expect(toolNames).not.toContain("exec");
    expect(toolNames).not.toContain("write");
  });

  it("should run exec synchronously when process is denied", async () => {
    const cfg: ArgentConfig = {
      tools: {
        deny: ["process"],
      },
    };

    const tools = createArgentCodingTools({
      config: cfg,
      sessionKey: "agent:main:main",
      workspaceDir: "/tmp/test-main",
      agentDir: "/tmp/agent-main",
    });
    const execTool = tools.find((tool) => tool.name === "exec");
    expect(execTool).toBeDefined();

    const result = await execTool?.execute("call1", {
      command: "echo done",
      yieldMs: 10,
    });

    expect(result?.details.status).toBe("completed");
  });
});
