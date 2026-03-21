import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAgentFamily: vi.fn(),
  spawnSubagentSession: vi.fn(),
  loadConfig: vi.fn(() => ({})),
  resolveMainSessionAlias: vi.fn(() => ({
    mainKey: "agent:main:main",
    alias: "agent:main:main",
  })),
  resolveInternalSessionKey: vi.fn(() => "agent:main:main"),
  resolveDisplaySessionKey: vi.fn(() => "agent:main:main"),
  normalizeDeliveryContext: vi.fn(() => undefined),
}));

vi.mock("../../data/agent-family.js", () => ({
  getAgentFamily: mocks.getAgentFamily,
}));

vi.mock("./sessions-spawn-helpers.js", () => ({
  spawnSubagentSession: mocks.spawnSubagentSession,
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock("./sessions-helpers.js", () => ({
  resolveMainSessionAlias: mocks.resolveMainSessionAlias,
  resolveInternalSessionKey: mocks.resolveInternalSessionKey,
  resolveDisplaySessionKey: mocks.resolveDisplaySessionKey,
}));

vi.mock("../../utils/delivery-context.js", () => ({
  normalizeDeliveryContext: mocks.normalizeDeliveryContext,
}));

import { createFamilyTool } from "./family-tool.js";

type AgentFixture = {
  id: string;
  name: string;
  role: string;
  team?: string;
};

function createFamilyFixture(agents: AgentFixture[]) {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  return {
    listTeamMembers: vi.fn(async (team: string) =>
      agents
        .filter((agent) => agent.team === team)
        .map((agent) => ({
          id: agent.id,
          name: agent.name,
          role: agent.role,
          config: agent.team ? { team: agent.team } : {},
        })),
    ),
    listMembers: vi.fn(async () =>
      agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        role: agent.role,
        team: agent.team,
        status: "active" as const,
        alive: true,
      })),
    ),
    getAgent: vi.fn(async (id: string) => {
      const agent = byId.get(id);
      if (!agent) return null;
      return {
        id: agent.id,
        name: agent.name,
        role: agent.role,
        status: "active",
        config: agent.team ? { team: agent.team } : {},
      };
    }),
    getRedis: vi.fn(() => null),
  };
}

describe("family dispatch routing", () => {
  beforeEach(() => {
    mocks.getAgentFamily.mockReset();
    mocks.spawnSubagentSession.mockReset();
    mocks.spawnSubagentSession.mockResolvedValue({
      ok: true,
      childSessionKey: "agent:main:subagent:test",
      runId: "run-test",
    });
  });

  it("routes strategy/advisory tasks to strict subagent in auto mode", async () => {
    mocks.getAgentFamily.mockResolvedValue(
      createFamilyFixture([
        { id: "elon", name: "Elon", role: "worker", team: "think-tank" },
        { id: "forge", name: "Forge", role: "software_engineer", team: "dev-team" },
      ]),
    );

    const tool = createFamilyTool();
    const result = await tool.execute("call-1", {
      action: "dispatch",
      task: "Evaluate options and provide strategy recommendations for go-to-market messaging",
      toolsAllow: ["read", "write", "atera_ticket"],
    });

    const details = result.details as { ok?: boolean; mode?: string };
    expect(details.ok).toBe(true);
    expect(details.mode).toBe("subagent");

    const spawnParams = mocks.spawnSubagentSession.mock.calls[0]?.[0] as
      | {
          label?: string;
          requestedAgentId?: string;
          toolsAllow?: string[];
        }
      | undefined;
    expect(spawnParams?.label).toBe("dispatch:worker");
    expect(spawnParams?.requestedAgentId).toBeUndefined();
    expect(spawnParams?.toolsAllow).toContain("read");
    expect(spawnParams?.toolsAllow).not.toContain("write");
    expect(spawnParams?.toolsAllow).not.toContain("atera_ticket");
  });

  it("allows think-tank only via explicit family target (mode=family + id)", async () => {
    mocks.getAgentFamily.mockResolvedValue(
      createFamilyFixture([
        { id: "elon", name: "Elon", role: "think_tank_panelist", team: "think-tank" },
        { id: "forge", name: "Forge", role: "software_engineer", team: "dev-team" },
      ]),
    );

    const tool = createFamilyTool();
    const result = await tool.execute("call-1-explicit-think-tank", {
      action: "dispatch",
      mode: "family",
      id: "elon",
      task: "Evaluate options and provide strategy recommendations for go-to-market messaging",
      toolsAllow: ["read", "write", "atera_ticket"],
    });

    const details = result.details as { ok?: boolean };
    expect(details.ok).toBe(true);

    const spawnParams = mocks.spawnSubagentSession.mock.calls[0]?.[0] as
      | {
          label?: string;
          requestedAgentId?: string;
          toolsAllow?: string[];
          toolsDeny?: string[];
        }
      | undefined;
    expect(spawnParams?.label).toBe("family:elon");
    expect(spawnParams?.requestedAgentId).toBe("elon");
    expect(spawnParams?.toolsAllow).toContain("read");
    expect(spawnParams?.toolsAllow).not.toContain("write");
    expect(spawnParams?.toolsAllow).not.toContain("atera_ticket");
    expect(spawnParams?.toolsDeny).toEqual(expect.arrayContaining(["write", "atera_ticket"]));
  });

  it("routes technical research tasks to dev-team in auto mode", async () => {
    mocks.getAgentFamily.mockResolvedValue(
      createFamilyFixture([
        { id: "dario", name: "Dario", role: "think_tank_panelist", team: "think-tank" },
        { id: "scout", name: "Scout", role: "research_lead", team: "dev-team" },
        { id: "forge", name: "Forge", role: "software_engineer", team: "dev-team" },
      ]),
    );

    const tool = createFamilyTool();
    const result = await tool.execute("call-tech-research", {
      action: "dispatch",
      task: "Research least-privilege Microsoft Graph scopes for SharePoint app access",
      mode: "auto",
    });

    const details = result.details as { ok?: boolean };
    expect(details.ok).toBe(true);

    const spawnParams = mocks.spawnSubagentSession.mock.calls[0]?.[0] as
      | {
          label?: string;
          requestedAgentId?: string;
        }
      | undefined;
    expect(spawnParams?.label).toBe("family:scout");
    expect(spawnParams?.requestedAgentId).toBe("scout");
  });

  it("routes dev tasks to dev-team by default", async () => {
    mocks.getAgentFamily.mockResolvedValue(
      createFamilyFixture([
        { id: "dario", name: "Dario", role: "worker", team: "think-tank" },
        { id: "forge", name: "Forge", role: "software_engineer", team: "dev-team" },
      ]),
    );

    const tool = createFamilyTool();
    const result = await tool.execute("call-2", {
      action: "dispatch",
      task: "Fix dashboard build failure and add QA regression tests",
    });

    const details = result.details as { ok?: boolean };
    expect(details.ok).toBe(true);

    const spawnParams = mocks.spawnSubagentSession.mock.calls[0]?.[0] as
      | {
          label?: string;
          requestedAgentId?: string;
          toolsAllow?: string[];
        }
      | undefined;
    expect(spawnParams?.label).toBe("family:forge");
    expect(spawnParams?.requestedAgentId).toBe("forge");
    expect(spawnParams?.toolsAllow).toEqual(
      expect.arrayContaining(["write", "edit", "bash", "tasks"]),
    );
  });

  it("retries another dev-team family candidate when first one fails model allowlist", async () => {
    mocks.getAgentFamily.mockResolvedValue(
      createFamilyFixture([
        { id: "scout", name: "Scout", role: "research_lead", team: "dev-team" },
        { id: "forge", name: "Forge", role: "software_engineer", team: "dev-team" },
      ]),
    );
    mocks.spawnSubagentSession
      .mockResolvedValueOnce({
        ok: false,
        error: "model not allowed: zai/glm-5-code",
        childSessionKey: "agent:scout:subagent:test",
      })
      .mockResolvedValueOnce({
        ok: true,
        childSessionKey: "agent:forge:subagent:test",
        runId: "run-forge",
      });

    const tool = createFamilyTool();
    const result = await tool.execute("call-retry-candidate", {
      action: "dispatch",
      task: "Research least-privilege Graph scopes for SharePoint app access",
      mode: "auto",
    });

    const details = result.details as { ok?: boolean };
    expect(details.ok).toBe(true);
    expect(mocks.spawnSubagentSession).toHaveBeenCalledTimes(2);

    const firstCall = mocks.spawnSubagentSession.mock.calls[0]?.[0] as {
      requestedAgentId?: string;
    };
    const secondCall = mocks.spawnSubagentSession.mock.calls[1]?.[0] as {
      requestedAgentId?: string;
    };
    expect(firstCall.requestedAgentId).toBe("scout");
    expect(secondCall.requestedAgentId).toBe("forge");
  });

  it("falls back to strict subagent when dev-team family candidate fails model allowlist in auto mode", async () => {
    mocks.getAgentFamily.mockResolvedValue(
      createFamilyFixture([
        { id: "scout", name: "Scout", role: "research_lead", team: "dev-team" },
      ]),
    );
    mocks.spawnSubagentSession
      .mockResolvedValueOnce({
        ok: false,
        error: "model not allowed: zai/glm-5-code",
        childSessionKey: "agent:scout:subagent:test",
      })
      .mockResolvedValueOnce({
        ok: true,
        childSessionKey: "agent:main:subagent:fallback",
        runId: "run-fallback",
      });

    const tool = createFamilyTool();
    const result = await tool.execute("call-fallback-subagent", {
      action: "dispatch",
      task: "Research least-privilege Graph scopes for SharePoint app access",
      mode: "auto",
    });

    const details = result.details as { ok?: boolean; mode?: string };
    expect(details.ok).toBe(true);
    expect(details.mode).toBe("subagent");
    expect(mocks.spawnSubagentSession).toHaveBeenCalledTimes(2);

    const familyCall = mocks.spawnSubagentSession.mock.calls[0]?.[0] as {
      label?: string;
      requestedAgentId?: string;
    };
    const subagentCall = mocks.spawnSubagentSession.mock.calls[1]?.[0] as {
      label?: string;
      requestedAgentId?: string;
      toolsAllow?: string[];
    };
    expect(familyCall.label).toBe("family:scout");
    expect(familyCall.requestedAgentId).toBe("scout");
    expect(subagentCall.label).toBe("dispatch:worker");
    expect(subagentCall.requestedAgentId).toBeUndefined();
    expect(subagentCall.toolsAllow).toContain("read");
    expect(subagentCall.toolsAllow).not.toContain("write");
  });

  it("falls back to strict subagent when dev-team is unavailable in auto mode", async () => {
    mocks.getAgentFamily.mockResolvedValue(
      createFamilyFixture([{ id: "elon", name: "Elon", role: "worker", team: "think-tank" }]),
    );

    const tool = createFamilyTool();
    const result = await tool.execute("call-3", {
      action: "dispatch",
      task: "Implement API endpoint and update integration tests",
      mode: "auto",
    });

    const details = result.details as { ok?: boolean; mode?: string };
    expect(details.ok).toBe(true);
    expect(details.mode).toBe("subagent");

    const spawnParams = mocks.spawnSubagentSession.mock.calls[0]?.[0] as
      | {
          label?: string;
          requestedAgentId?: string;
          toolsAllow?: string[];
        }
      | undefined;
    expect(spawnParams?.label).toBe("dispatch:worker");
    expect(spawnParams?.requestedAgentId).toBeUndefined();
    expect(spawnParams?.toolsAllow).toContain("read");
    expect(spawnParams?.toolsAllow).not.toContain("write");
  });

  it("blocks non-explicit think-tank routing in family mode", async () => {
    mocks.getAgentFamily.mockResolvedValue(
      createFamilyFixture([
        { id: "elon", name: "Elon", role: "think_tank_panelist", team: "think-tank" },
      ]),
    );

    const tool = createFamilyTool();
    const result = await tool.execute("call-think-tank-non-explicit", {
      action: "dispatch",
      mode: "family",
      task: "Provide strategy recommendations for enterprise licensing",
    });

    const details = result.details as { ok?: boolean; error?: string };
    expect(details.ok).toBe(false);
    expect(details.error).toContain("requires explicit target");
    expect(mocks.spawnSubagentSession).not.toHaveBeenCalled();
  });

  it("blocks think-tank execution tasks even through dispatch family mode", async () => {
    mocks.getAgentFamily.mockResolvedValue(
      createFamilyFixture([{ id: "elon", name: "Elon", role: "worker", team: "think-tank" }]),
    );

    const tool = createFamilyTool();
    const result = await tool.execute("call-4", {
      action: "dispatch",
      mode: "family",
      id: "elon",
      task: "Update ticket 55335 and assign to Alex",
    });

    const details = result.details as { ok?: boolean; error?: string };
    expect(details.ok).toBe(false);
    expect(details.error).toContain("think-tank/advisory only");
    expect(mocks.spawnSubagentSession).not.toHaveBeenCalled();
  });
});
