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
  createDispatchContract: vi.fn(),
  appendDispatchContractEvent: vi.fn(),
  getDispatchContract: vi.fn(),
  listDispatchContracts: vi.fn(),
  listDispatchContractEvents: vi.fn(),
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

vi.mock("../../infra/dispatch-contracts.js", () => ({
  createDispatchContract: mocks.createDispatchContract,
  appendDispatchContractEvent: mocks.appendDispatchContractEvent,
  getDispatchContract: mocks.getDispatchContract,
  listDispatchContracts: mocks.listDispatchContracts,
  listDispatchContractEvents: mocks.listDispatchContractEvents,
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

describe("family dispatch_contracted", () => {
  beforeEach(() => {
    mocks.getAgentFamily.mockReset();
    mocks.spawnSubagentSession.mockReset();
    mocks.createDispatchContract.mockReset();
    mocks.appendDispatchContractEvent.mockReset();
    mocks.getDispatchContract.mockReset();
    mocks.listDispatchContracts.mockReset();
    mocks.listDispatchContractEvents.mockReset();

    mocks.getAgentFamily.mockResolvedValue(
      createFamilyFixture([
        { id: "forge", name: "Forge", role: "software_engineer", team: "dev-team" },
      ]),
    );
    mocks.createDispatchContract.mockResolvedValue({
      contractId: "contract-abc",
      status: "contract_created",
      expiresAt: new Date("2026-03-01T12:05:00.000Z"),
    });
  });

  it("creates contract and appends accepted/started events on successful dispatch", async () => {
    mocks.spawnSubagentSession.mockResolvedValue({
      ok: true,
      childSessionKey: "agent:forge:subagent:test",
      runId: "run-test",
    });

    const tool = createFamilyTool({ agentId: "argent" });
    const result = await tool.execute("call-contracted-success", {
      action: "dispatch_contracted",
      mode: "family",
      id: "forge",
      task_id: "task-55335",
      task: "Fix a dashboard TypeScript issue",
      timeout_ms: 60000,
      heartbeat_interval_ms: 5000,
      toolsAllow: ["read", "write"],
    });

    const details = result.details as {
      ok?: boolean;
      contract_id?: string;
      contract_status?: string;
    };
    expect(details.ok).toBe(true);
    expect(details.contract_id).toBe("contract-abc");
    expect(details.contract_status).toBe("started");

    expect(mocks.createDispatchContract).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-55335",
        targetAgentId: "forge",
        toolGrantSnapshot: ["read", "write"],
        timeoutMs: 60000,
        heartbeatIntervalMs: 5000,
      }),
    );

    expect(mocks.appendDispatchContractEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        contractId: "contract-abc",
        status: "accepted",
      }),
    );
    expect(mocks.appendDispatchContractEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        contractId: "contract-abc",
        status: "started",
      }),
    );
  });

  it("appends failed event when routed dispatch fails", async () => {
    mocks.spawnSubagentSession.mockResolvedValue({
      ok: false,
      error: "model not allowed: zai/glm-5-code",
      childSessionKey: "agent:forge:subagent:test",
    });

    const tool = createFamilyTool({ agentId: "argent" });
    const result = await tool.execute("call-contracted-failure", {
      action: "dispatch_contracted",
      mode: "family",
      id: "forge",
      task: "Fix a dashboard TypeScript issue",
      timeout_ms: 60000,
      heartbeat_interval_ms: 5000,
      toolsAllow: ["read", "write"],
    });

    const details = result.details as { ok?: boolean; contract_status?: string; error?: string };
    expect(details.ok).toBe(false);
    expect(details.contract_status).toBe("failed");
    expect(details.error).toContain("model not allowed");

    expect(mocks.appendDispatchContractEvent).toHaveBeenCalledTimes(1);
    expect(mocks.appendDispatchContractEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        contractId: "contract-abc",
        status: "failed",
      }),
    );
  });

  it("rejects dispatch_contracted without toolsAllow grant snapshot", async () => {
    const tool = createFamilyTool({ agentId: "argent" });
    const result = await tool.execute("call-contracted-no-grant", {
      action: "dispatch_contracted",
      mode: "family",
      id: "forge",
      task: "Fix a dashboard TypeScript issue",
    });
    const details = result.details as { ok?: boolean; error?: string };
    expect(details.ok).toBe(false);
    expect(details.error).toContain("requires toolsAllow");
    expect(mocks.createDispatchContract).not.toHaveBeenCalled();
  });

  it("fails closed when subagent grant includes tools outside strict allowlist", async () => {
    const tool = createFamilyTool({ agentId: "argent" });
    const result = await tool.execute("call-contracted-subagent-unsafe", {
      action: "dispatch_contracted",
      mode: "subagent",
      task: "Run deep execution task",
      toolsAllow: ["read", "write"],
    });
    const details = result.details as { ok?: boolean; error?: string };
    expect(details.ok).toBe(false);
    expect(details.error).toContain("violates strict subagent policy");
    expect(mocks.createDispatchContract).not.toHaveBeenCalled();
  });

  it("fails closed when think-tank grant includes tools outside think-tank allowlist", async () => {
    mocks.getAgentFamily.mockResolvedValue(
      createFamilyFixture([
        { id: "elon", name: "Elon", role: "think_tank_panelist", team: "think-tank" },
      ]),
    );
    const tool = createFamilyTool({ agentId: "argent" });
    const result = await tool.execute("call-contracted-think-tank-unsafe", {
      action: "dispatch_contracted",
      mode: "family",
      id: "elon",
      task: "Provide strategic recommendation",
      toolsAllow: ["read", "write"],
    });
    const details = result.details as { ok?: boolean; error?: string };
    expect(details.ok).toBe(false);
    expect(details.error).toContain("violates think-tank policy");
    expect(mocks.createDispatchContract).not.toHaveBeenCalled();
  });

  it("returns filtered contract history with ordered lifecycle events", async () => {
    const createdAt = new Date("2026-03-01T10:00:00.000Z");
    const updatedAt = new Date("2026-03-01T10:01:00.000Z");
    mocks.listDispatchContracts.mockResolvedValue([
      {
        contractId: "contract-history-1",
        taskId: "task-55335",
        task: "Research least-privilege scopes",
        targetAgentId: "scout",
        dispatchedBy: "argent",
        toolGrantSnapshot: ["web_search", "doc_panel"],
        timeoutMs: 30000,
        heartbeatIntervalMs: 5000,
        status: "started",
        createdAt,
        updatedAt,
        expiresAt: new Date("2026-03-01T10:10:00.000Z"),
        acceptedAt: new Date("2026-03-01T10:00:10.000Z"),
        startedAt: new Date("2026-03-01T10:00:20.000Z"),
        lastHeartbeatAt: null,
        completedAt: null,
        failedAt: null,
        cancelledAt: null,
        failureReason: null,
        resultSummary: null,
        metadata: { mode: "auto" },
      },
    ]);
    mocks.listDispatchContractEvents.mockResolvedValue([
      {
        id: 2,
        contractId: "contract-history-1",
        status: "started",
        eventAt: new Date("2026-03-01T10:00:20.000Z"),
        payload: {},
      },
      {
        id: 1,
        contractId: "contract-history-1",
        status: "accepted",
        eventAt: new Date("2026-03-01T10:00:10.000Z"),
        payload: {},
      },
    ]);

    const tool = createFamilyTool({ agentId: "argent" });
    const result = await tool.execute("call-contract-history-filtered", {
      action: "contract_history",
      task_id: "task-55335",
      target_agent_id: "scout",
      contract_status: "started",
      limit: 20,
      include_events: true,
    });

    expect(mocks.listDispatchContracts).toHaveBeenCalledWith({
      status: "started",
      targetAgentId: "scout",
      taskId: "task-55335",
      limit: 20,
    });
    expect(mocks.listDispatchContractEvents).toHaveBeenCalledWith("contract-history-1", 20);

    const details = result.details as {
      ok?: boolean;
      contracts?: Array<{ contract_id: string }>;
      eventsByContract?: Record<string, Array<{ status: string }>>;
    };
    expect(details.ok).toBe(true);
    expect(details.contracts?.[0]?.contract_id).toBe("contract-history-1");
    expect(details.eventsByContract?.["contract-history-1"]?.map((event) => event.status)).toEqual([
      "accepted",
      "started",
    ]);
  });

  it("returns single contract history by contract_id with ordered events payload", async () => {
    const contract = {
      contractId: "contract-single-1",
      taskId: "task-9001",
      task: "Fix dashboard bug",
      targetAgentId: "forge",
      dispatchedBy: "argent",
      toolGrantSnapshot: ["read", "write"],
      timeoutMs: 30000,
      heartbeatIntervalMs: 5000,
      status: "failed",
      createdAt: new Date("2026-03-01T11:00:00.000Z"),
      updatedAt: new Date("2026-03-01T11:01:00.000Z"),
      expiresAt: new Date("2026-03-01T11:10:00.000Z"),
      acceptedAt: new Date("2026-03-01T11:00:05.000Z"),
      startedAt: new Date("2026-03-01T11:00:10.000Z"),
      lastHeartbeatAt: null,
      completedAt: null,
      failedAt: new Date("2026-03-01T11:00:40.000Z"),
      cancelledAt: null,
      failureReason: "timed out",
      resultSummary: null,
      metadata: { mode: "family" },
    };
    mocks.getDispatchContract.mockResolvedValue(contract);
    mocks.listDispatchContractEvents.mockResolvedValue([
      {
        id: 1,
        contractId: "contract-single-1",
        status: "contract_created",
        eventAt: new Date("2026-03-01T11:00:00.000Z"),
        payload: {},
      },
      {
        id: 2,
        contractId: "contract-single-1",
        status: "accepted",
        eventAt: new Date("2026-03-01T11:00:05.000Z"),
        payload: {},
      },
      {
        id: 3,
        contractId: "contract-single-1",
        status: "failed",
        eventAt: new Date("2026-03-01T11:00:40.000Z"),
        payload: { reason: "timed out" },
      },
    ]);

    const tool = createFamilyTool({ agentId: "argent" });
    const result = await tool.execute("call-contract-history-single", {
      action: "contract_history",
      contract_id: "contract-single-1",
      include_events: true,
      limit: 50,
    });

    expect(mocks.getDispatchContract).toHaveBeenCalledWith("contract-single-1");
    expect(mocks.listDispatchContractEvents).toHaveBeenCalledWith("contract-single-1", 50);

    const details = result.details as {
      ok?: boolean;
      contracts?: Array<{ contract_id: string; failure_reason: string | null }>;
      events?: Array<{ status: string }>;
    };
    expect(details.ok).toBe(true);
    expect(details.contracts?.[0]?.contract_id).toBe("contract-single-1");
    expect(details.contracts?.[0]?.failure_reason).toBe("timed out");
    expect(details.events?.map((event) => event.status)).toEqual([
      "contract_created",
      "accepted",
      "failed",
    ]);
  });

  it("blocks incident-class external write grant for think-tank dispatch (ticket comment class)", async () => {
    mocks.getAgentFamily.mockResolvedValue(
      createFamilyFixture([
        { id: "elon", name: "Elon", role: "think_tank_panelist", team: "think-tank" },
      ]),
    );
    const tool = createFamilyTool({ agentId: "argent" });
    const result = await tool.execute("call-contracted-think-tank-incident-class", {
      action: "dispatch_contracted",
      mode: "family",
      id: "elon",
      task: "Comment on Atera ticket #55335",
      toolsAllow: ["atera_ticket"],
    });
    const details = result.details as { ok?: boolean; error?: string };
    expect(details.ok).toBe(false);
    expect(details.error).toContain("violates think-tank policy");
    expect(mocks.createDispatchContract).not.toHaveBeenCalled();
  });
});
