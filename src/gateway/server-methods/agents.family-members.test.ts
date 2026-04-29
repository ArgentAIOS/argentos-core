import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAgentFamily: vi.fn(),
  provisionFamilyWorker: vi.fn(),
}));

vi.mock("../../data/agent-family.js", () => ({
  getAgentFamily: mocks.getAgentFamily,
}));

vi.mock("../../agents/family-worker-provisioning.js", () => ({
  provisionFamilyWorker: mocks.provisionFamilyWorker,
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: vi.fn(() => ({ agents: { list: [{ id: "main", name: "Argent" }] } })),
}));

vi.mock("../../agents/agent-scope.js", () => ({
  listAgentIds: vi.fn(() => ["main"]),
  resolveAgentWorkspaceDir: vi.fn(() => "/tmp/workspace-main"),
}));

vi.mock("../session-utils.js", () => ({
  listAgentsForGateway: vi.fn(() => ({
    agents: [{ id: "main", name: "Argent" }],
  })),
}));

import { agentsHandlers } from "./agents.js";

describe("agentsHandlers family.members", () => {
  beforeEach(() => {
    mocks.getAgentFamily.mockReset();
    mocks.provisionFamilyWorker.mockReset();
  });

  it("returns family members from agent family service", async () => {
    const listMembers = vi.fn(async () => [
      { id: "relay", name: "Relay", role: "tier_1_support_specialist", alive: true },
      { id: "maya", name: "Maya", role: "concierge", alive: true },
    ]);
    mocks.getAgentFamily.mockResolvedValue({
      listMembers,
    });

    const respond = vi.fn();
    await agentsHandlers["family.members"]({
      params: {},
      respond,
      req: { type: "req", id: "family-1", method: "family.members" },
      client: null,
      isWebchatConnect: () => false,
      context: {} as never,
    });

    expect(mocks.getAgentFamily).toHaveBeenCalledTimes(1);
    expect(listMembers).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith(
      true,
      {
        members: [
          { id: "relay", name: "Relay", role: "tier_1_support_specialist", alive: true },
          { id: "maya", name: "Maya", role: "concierge", alive: true },
        ],
      },
      undefined,
    );
  });

  it("registers worker via family.register", async () => {
    mocks.provisionFamilyWorker.mockResolvedValue({
      id: "relay",
      name: "Relay",
      role: "tier_1_support_specialist",
      team: "Support Team",
      model: "default",
      provider: null,
      skills: ["argentos-code-verification"],
      identityDir: "/tmp/relay/agent",
      rootDir: "/tmp/relay",
      redis: true,
    });

    const respond = vi.fn();
    await agentsHandlers["family.register"]({
      params: {
        id: "relay",
        name: "Relay",
        role: "tier_1_support_specialist",
        team: "Support Team",
        skills: ["argentos-code-verification"],
      },
      respond,
      req: { type: "req", id: "family-2", method: "family.register" },
      client: null,
      isWebchatConnect: () => false,
      context: {} as never,
    });

    expect(mocks.provisionFamilyWorker).toHaveBeenCalledTimes(1);
    expect(mocks.provisionFamilyWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "relay",
        skills: ["argentos-code-verification"],
      }),
    );
    expect(respond).toHaveBeenCalledWith(
      true,
      {
        worker: expect.objectContaining({
          id: "relay",
          name: "Relay",
          team: "Support Team",
          skills: ["argentos-code-verification"],
        }),
      },
      undefined,
    );
  });
});
