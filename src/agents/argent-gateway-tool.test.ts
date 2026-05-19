import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./test-helpers/fast-core-tools.js";
import { createArgentTools } from "./argent-tools.js";
import { callGatewayTool } from "./tools/gateway.js";

vi.mock("./tools/gateway.js", () => ({
  callGatewayTool: vi.fn(async (_method: string) => ({ ok: true })),
}));

function configureGatewayMock(latestUserMessage: string): void {
  vi.mocked(callGatewayTool).mockImplementation(async (method: string) => {
    if (method === "chat.history") {
      return {
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: latestUserMessage }],
          },
        ],
      };
    }
    if (method === "config.get") {
      return { hash: "hash-1" };
    }
    return { ok: true };
  });
}

describe("gateway tool", () => {
  beforeEach(() => {
    configureGatewayMock("Please run update and apply config patch changes for me.");
  });

  it("schedules SIGUSR1 restart", async () => {
    vi.useFakeTimers();
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const previousStateDir = process.env.ARGENT_STATE_DIR;
    const previousProfile = process.env.ARGENT_PROFILE;
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "argent-test-"));
    process.env.ARGENT_STATE_DIR = stateDir;
    process.env.ARGENT_PROFILE = "isolated";

    try {
      const tool = createArgentTools({
        config: { commands: { restart: true } },
      }).find((candidate) => candidate.name === "gateway");
      expect(tool).toBeDefined();
      if (!tool) {
        throw new Error("missing gateway tool");
      }

      const result = await tool.execute("call1", {
        action: "restart",
        delayMs: 0,
      });
      expect(result.details).toMatchObject({
        ok: true,
        pid: process.pid,
        signal: "SIGUSR1",
        delayMs: 0,
      });

      const sentinelPath = path.join(stateDir, "restart-sentinel.json");
      const raw = await fs.readFile(sentinelPath, "utf-8");
      const parsed = JSON.parse(raw) as {
        payload?: { kind?: string; doctorHint?: string | null };
      };
      expect(parsed.payload?.kind).toBe("restart");
      expect(parsed.payload?.doctorHint).toBe(
        "Run: argent --profile isolated doctor --non-interactive",
      );

      expect(kill).not.toHaveBeenCalled();
      await vi.runAllTimersAsync();
      expect(kill).toHaveBeenCalledWith(process.pid, "SIGUSR1");
    } finally {
      kill.mockRestore();
      vi.useRealTimers();
      if (previousStateDir === undefined) {
        delete process.env.ARGENT_STATE_DIR;
      } else {
        process.env.ARGENT_STATE_DIR = previousStateDir;
      }
      if (previousProfile === undefined) {
        delete process.env.ARGENT_PROFILE;
      } else {
        process.env.ARGENT_PROFILE = previousProfile;
      }
    }
  });

  it("passes config.apply through gateway call", async () => {
    const tool = createArgentTools({
      agentSessionKey: "agent:main:whatsapp:dm:+15555550123",
    }).find((candidate) => candidate.name === "gateway");
    expect(tool).toBeDefined();
    if (!tool) {
      throw new Error("missing gateway tool");
    }

    const raw = '{\n  agents: { defaults: { workspace: "~/argent" } }\n}\n';
    await tool.execute("call2", {
      action: "config.apply",
      raw,
    });

    expect(callGatewayTool).toHaveBeenCalledWith("config.get", expect.any(Object), {});
    expect(callGatewayTool).toHaveBeenCalledWith(
      "config.apply",
      expect.any(Object),
      expect.objectContaining({
        raw: raw.trim(),
        baseHash: "hash-1",
        sessionKey: "agent:main:whatsapp:dm:+15555550123",
      }),
    );
  });

  it("passes config.patch through gateway call", async () => {
    const tool = createArgentTools({
      agentSessionKey: "agent:main:whatsapp:dm:+15555550123",
    }).find((candidate) => candidate.name === "gateway");
    expect(tool).toBeDefined();
    if (!tool) {
      throw new Error("missing gateway tool");
    }

    const raw = '{\n  channels: { telegram: { groups: { "*": { requireMention: false } } } }\n}\n';
    await tool.execute("call4", {
      action: "config.patch",
      raw,
    });

    expect(callGatewayTool).toHaveBeenCalledWith("config.get", expect.any(Object), {});
    expect(callGatewayTool).toHaveBeenCalledWith(
      "config.patch",
      expect.any(Object),
      expect.objectContaining({
        raw: raw.trim(),
        baseHash: "hash-1",
        sessionKey: "agent:main:whatsapp:dm:+15555550123",
      }),
    );
  });

  it("passes update.run through gateway call", async () => {
    const tool = createArgentTools({
      agentSessionKey: "agent:main:whatsapp:dm:+15555550123",
    }).find((candidate) => candidate.name === "gateway");
    expect(tool).toBeDefined();
    if (!tool) {
      throw new Error("missing gateway tool");
    }

    await tool.execute("call3", {
      action: "update.run",
      note: "test update",
    });

    expect(callGatewayTool).toHaveBeenCalledWith(
      "update.run",
      expect.any(Object),
      expect.objectContaining({
        note: "test update",
        sessionKey: "agent:main:whatsapp:dm:+15555550123",
      }),
    );
    const updateCall = vi
      .mocked(callGatewayTool)
      .mock.calls.find((call) => call[0] === "update.run");
    expect(updateCall).toBeDefined();
    if (updateCall) {
      const [, opts, params] = updateCall;
      expect(opts).toMatchObject({ timeoutMs: 20 * 60_000 });
      expect(params).toMatchObject({ timeoutMs: 20 * 60_000 });
    }
  });

  it("blocks restart when latest user message is narration, not request", async () => {
    configureGatewayMock("I'll restart the gateway really quick");

    const tool = createArgentTools({
      agentSessionKey: "agent:main:webchat",
      config: { commands: { restart: true } },
    }).find((candidate) => candidate.name === "gateway");
    expect(tool).toBeDefined();
    if (!tool) throw new Error("missing gateway tool");

    await expect(
      tool.execute("call-restart-narration", { action: "restart", delayMs: 0 }),
    ).rejects.toThrow("latest user message is not an explicit request");
  });

  it("allows restart when latest user message explicitly requests restart", async () => {
    configureGatewayMock("Can you restart the gateway now?");

    vi.useFakeTimers();
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    try {
      const tool = createArgentTools({
        agentSessionKey: "agent:main:webchat",
        config: { commands: { restart: true } },
      }).find((candidate) => candidate.name === "gateway");
      expect(tool).toBeDefined();
      if (!tool) throw new Error("missing gateway tool");

      const result = await tool.execute("call-restart-explicit", { action: "restart", delayMs: 0 });
      expect(result.details).toMatchObject({
        ok: true,
        signal: "SIGUSR1",
      });
    } finally {
      kill.mockRestore();
      vi.useRealTimers();
    }
  });

  it("blocks config.patch when latest user message is narration, not request", async () => {
    configureGatewayMock("I'll patch the config after lunch");

    const tool = createArgentTools({
      agentSessionKey: "agent:main:webchat",
    }).find((candidate) => candidate.name === "gateway");
    expect(tool).toBeDefined();
    if (!tool) throw new Error("missing gateway tool");

    await expect(
      tool.execute("call-config-patch-narration", {
        action: "config.patch",
        raw: "{ channels: { slack: { enabled: true } } }",
      }),
    ).rejects.toThrow("latest user message is not an explicit request");
  });

  it("blocks update.run when latest user message is narration, not request", async () => {
    configureGatewayMock("I'm going to run an update in a minute");

    const tool = createArgentTools({
      agentSessionKey: "agent:main:webchat",
    }).find((candidate) => candidate.name === "gateway");
    expect(tool).toBeDefined();
    if (!tool) throw new Error("missing gateway tool");

    await expect(
      tool.execute("call-update-run-narration", {
        action: "update.run",
      }),
    ).rejects.toThrow("latest user message is not an explicit request");
  });
});
