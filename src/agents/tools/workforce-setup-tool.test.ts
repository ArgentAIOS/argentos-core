import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(() => ({
    agents: {
      list: [
        { id: "main", name: "Argent" },
        { id: "relay", name: "Relay" },
        { id: "maya", name: "Maya" },
      ],
    },
  })),
  getStorageAdapter: vi.fn(),
  resolveRuntimeStorageConfig: vi.fn(),
  isStrictPostgresOnly: vi.fn(),
  getAgentFamily: vi.fn(),
  provisionFamilyWorker: vi.fn(),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock("../../data/storage-factory.js", () => ({
  getStorageAdapter: mocks.getStorageAdapter,
}));

vi.mock("../../data/storage-resolver.js", () => ({
  resolveRuntimeStorageConfig: (...args: unknown[]) => mocks.resolveRuntimeStorageConfig(...args),
}));

vi.mock("../../data/storage-config.js", () => ({
  isStrictPostgresOnly: (...args: unknown[]) => mocks.isStrictPostgresOnly(...args),
}));

vi.mock("../../data/agent-family.js", () => ({
  getAgentFamily: (...args: unknown[]) => mocks.getAgentFamily(...args),
}));

vi.mock("../family-worker-provisioning.js", () => ({
  provisionFamilyWorker: mocks.provisionFamilyWorker,
}));

import { createWorkforceSetupTool } from "./workforce-setup-tool.js";

function createStorageFixture() {
  return {
    jobs: {
      createTemplate: vi.fn(async (payload: Record<string, unknown>) => ({
        id: "template-tier1",
        ...payload,
      })),
      createAssignment: vi.fn(async (payload: Record<string, unknown>) => ({
        id: "assignment-tier1",
        ...payload,
      })),
    },
  };
}

const relayRolePayload = {
  roleName: "Tier 1 Support",
  brief:
    "Tier 1 support specialist for intake, triage, common troubleshooting, evidence gathering, and escalation prep only.",
  successDefinition:
    "Correctly triages common Tier 1 issues, asks the right follow-up questions, avoids hallucinated fixes, and produces clean escalation packets when beyond scope.",
  relationshipObjective:
    "Reliable first-line support specialist that reduces interrupt load while staying truthful, safe, and escalation-aware.",
  scenarios: [
    "User reports intermittent VPN drops and is frustrated after restarting twice.",
    "Customer asks for an exception to policy and pressures the worker for a quick bypass.",
    "Issue is beyond Tier 1 scope and needs a clean escalation packet with evidence.",
  ],
  defaultStage: "simulate",
  cadenceMinutes: 1440,
  assignmentTitle: "Tier 1 Support Simulation",
  scopeLimit:
    "Tier 1 only — intake, triage, common troubleshooting, evidence gathering, escalation prep. No destructive actions, no policy exceptions, no external commitments.",
};

type StorageConfigShape = {
  backend: "sqlite" | "dual" | "postgres";
  readFrom: "sqlite" | "postgres";
  writeTo: Array<"sqlite" | "postgres">;
  postgres: { connectionString: string } | null;
  redis: { host: string; port: number } | null;
};

const NON_PG_CONFIG: StorageConfigShape = {
  backend: "sqlite",
  readFrom: "sqlite",
  writeTo: ["sqlite"],
  postgres: null,
  redis: null,
};

const OLD_NODE_ENV = process.env.NODE_ENV;
const OLD_ALLOW_NON_PG = process.env.ARGENT_ALLOW_NON_PG_WORKFORCE;
const OLD_VITEST = process.env.VITEST;

describe("workforce_setup_tool", () => {
  beforeEach(() => {
    mocks.loadConfig.mockClear();
    mocks.getStorageAdapter.mockReset();
    mocks.resolveRuntimeStorageConfig.mockReset().mockReturnValue(NON_PG_CONFIG);
    mocks.isStrictPostgresOnly.mockReset().mockReturnValue(false);
    mocks.getAgentFamily.mockReset().mockResolvedValue({
      listMembers: vi.fn(async () => [
        { id: "relay", name: "Relay", role: "support" },
        { id: "tier-1-technical-support", name: "Tier 1 Technical Support", role: "support" },
      ]),
    });
    mocks.provisionFamilyWorker.mockReset();
    mocks.loadConfig.mockReturnValue({
      agents: {
        list: [
          { id: "main", name: "Argent" },
          { id: "relay", name: "Relay" },
          { id: "maya", name: "Maya" },
        ],
      },
    });
    process.env.NODE_ENV = "production";
    delete process.env.ARGENT_ALLOW_NON_PG_WORKFORCE;
  });

  afterEach(() => {
    if (OLD_NODE_ENV === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = OLD_NODE_ENV;
    }
    if (OLD_ALLOW_NON_PG === undefined) {
      delete process.env.ARGENT_ALLOW_NON_PG_WORKFORCE;
    } else {
      process.env.ARGENT_ALLOW_NON_PG_WORKFORCE = OLD_ALLOW_NON_PG;
    }
    if (OLD_VITEST === undefined) {
      delete process.env.VITEST;
    } else {
      process.env.VITEST = OLD_VITEST;
    }
  });

  it("dispatches agent_options instead of collapsing to action required", async () => {
    const tool = createWorkforceSetupTool();
    const result = await tool.execute("call-agent-options", {
      action: "agent_options",
    });

    const details = result.details as {
      agents?: Array<{ id: string; label: string; role: string }>;
      guidance?: string;
    };

    expect(details.guidance).toContain("Assign roles");
    expect(details.agents).toEqual(
      expect.arrayContaining([
        { id: "main", label: "Argent (Primary)", role: "primary" },
        { id: "relay", label: "Relay (relay)", role: "family" },
        {
          id: "tier-1-technical-support",
          label: "Tier 1 Technical Support (tier-1-technical-support)",
          role: "family",
        },
      ]),
    );
  });

  it("returns useful draft follow-up guidance when fields are missing", async () => {
    const tool = createWorkforceSetupTool();
    const result = await tool.execute("call-draft", {
      action: "draft",
      targetMode: "existing",
    });

    const details = result.details as {
      missing?: string[];
      followUpQuestions?: string[];
    };

    expect(details.missing).toEqual(
      expect.arrayContaining([
        "roleName",
        "rolePrompt_or_brief",
        "successDefinition",
        "relationshipObjective",
        "simulationScenarios",
      ]),
    );
    expect(details.followUpQuestions?.length).toBeGreaterThan(0);
  });

  it("returns field-specific validation for assignment_create with missing templateId", async () => {
    process.env.NODE_ENV = "development";
    const tool = createWorkforceSetupTool();
    const result = await tool.execute("call-assignment-missing-template", {
      action: "assignment_create",
      targetMode: "existing",
      targetAgentId: "relay",
      ...relayRolePayload,
    });

    const details = result.details as { ok?: boolean; error?: string };
    expect(details.ok).toBe(false);
    expect(details.error).toBe("templateId is required for assignment_create.");
  });

  it("creates an assignment for an existing worker", async () => {
    process.env.NODE_ENV = "development";
    const storage = createStorageFixture();
    mocks.getStorageAdapter.mockResolvedValue(storage);

    const tool = createWorkforceSetupTool();
    const result = await tool.execute("call-assignment-create", {
      action: "assignment_create",
      templateId: "template-tier1",
      targetMode: "existing",
      targetAgentId: "relay",
      ...relayRolePayload,
    });

    const details = result.details as {
      ok?: boolean;
      assignment?: Record<string, unknown>;
    };

    expect(details.ok).toBe(true);
    expect(storage.jobs.createAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        templateId: "template-tier1",
        agentId: "relay",
        title: "Tier 1 Support Simulation",
        executionMode: "simulate",
        deploymentStage: "simulate",
      }),
    );
    expect(details.assignment).toEqual(
      expect.objectContaining({
        id: "assignment-tier1",
        agentId: "relay",
      }),
    );
  });

  it("runs project_start end to end for an existing worker", async () => {
    process.env.NODE_ENV = "development";
    const storage = createStorageFixture();
    mocks.getStorageAdapter.mockResolvedValue(storage);

    const tool = createWorkforceSetupTool();
    const result = await tool.execute("call-project-start", {
      action: "project_start",
      targetMode: "existing",
      targetAgentId: "relay",
      ...relayRolePayload,
    });

    const details = result.details as {
      ok?: boolean;
      worker?: unknown;
      template?: Record<string, unknown>;
      assignment?: Record<string, unknown>;
    };

    expect(details.ok).toBe(true);
    expect(details.worker).toBeUndefined();
    expect(storage.jobs.createTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Tier 1 Support",
        defaultStage: "simulate",
        defaultMode: "simulate",
      }),
    );
    expect(storage.jobs.createAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "relay",
        deploymentStage: "simulate",
        executionMode: "simulate",
      }),
    );
    expect(details.template).toEqual(expect.objectContaining({ id: "template-tier1" }));
    expect(details.assignment).toEqual(expect.objectContaining({ id: "assignment-tier1" }));
  });

  it("blocks write actions in production when storage is not strict PG", async () => {
    delete process.env.VITEST;
    process.env.NODE_ENV = "production";
    const tool = createWorkforceSetupTool();

    await expect(
      tool.execute("call-template-create-blocked", {
        action: "template_create",
        targetMode: "existing",
        targetAgentId: "relay",
        ...relayRolePayload,
      }),
    ).rejects.toThrow("workforce requires PostgreSQL-canonical storage in production");
  });

  it("allows explicit override in production via ARGENT_ALLOW_NON_PG_WORKFORCE=1", async () => {
    delete process.env.VITEST;
    process.env.NODE_ENV = "production";
    process.env.ARGENT_ALLOW_NON_PG_WORKFORCE = "1";
    const storage = createStorageFixture();
    mocks.getStorageAdapter.mockResolvedValue(storage);

    const tool = createWorkforceSetupTool();
    const result = await tool.execute("call-template-create-override", {
      action: "template_create",
      targetMode: "existing",
      targetAgentId: "relay",
      ...relayRolePayload,
    });

    const details = result.details as {
      ok?: boolean;
      template?: Record<string, unknown>;
    };
    expect(details.ok).toBe(true);
    expect(details.template).toEqual(expect.objectContaining({ id: "template-tier1" }));
  });
});
