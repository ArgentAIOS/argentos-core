import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAgentFamily: vi.fn(),
  provisionFamilyWorker: vi.fn(),
  loadConfig: vi.fn(() => ({
    agents: { list: [{ id: "main", name: "Argent" }] },
    messages: {
      tts: {
        provider: "elevenlabs",
        elevenlabs: { apiKey: "secret-global", voiceId: "global-voice" },
      },
    },
  })),
  writeConfigFile: vi.fn(async () => undefined),
  validateConfigObjectWithPlugins: vi.fn((config) => ({ ok: true, config })),
  ensureAuthProfileStore: vi.fn(() => ({
    version: 1,
    profiles: {
      "google:agent": {
        type: "oauth",
        provider: "google",
        accessToken: "secret-access",
        refreshToken: "secret-refresh",
        email: "agent@example.com",
      },
    },
  })),
}));

vi.mock("../../data/agent-family.js", () => ({
  getAgentFamily: mocks.getAgentFamily,
}));

vi.mock("../../agents/family-worker-provisioning.js", () => ({
  provisionFamilyWorker: mocks.provisionFamilyWorker,
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: mocks.loadConfig,
  validateConfigObjectWithPlugins: mocks.validateConfigObjectWithPlugins,
  writeConfigFile: mocks.writeConfigFile,
}));

vi.mock("../../agents/agent-scope.js", () => ({
  listAgentIds: vi.fn(() => ["main"]),
  resolveAgentConfig: vi.fn(() => ({
    name: "Argent",
    tts: {
      provider: "elevenlabs",
      elevenlabs: { apiKey: "secret-agent", voiceId: "agent-voice" },
    },
    identity: { name: "Argent" },
  })),
  resolveAgentDir: vi.fn(() => "/tmp/agent-main"),
  resolveAgentWorkspaceDir: vi.fn(() => "/tmp/workspace-main"),
}));

vi.mock("../../agents/auth-profiles.js", () => ({
  ensureAuthProfileStore: mocks.ensureAuthProfileStore,
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
    mocks.loadConfig.mockClear();
    mocks.writeConfigFile.mockClear();
    mocks.validateConfigObjectWithPlugins.mockClear();
    mocks.ensureAuthProfileStore.mockClear();
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
      skillSource: "explicit",
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
          skillSource: "explicit",
        }),
      },
      undefined,
    );
  });

  it("returns a redacted agent profile for the dashboard", async () => {
    const respond = vi.fn();
    await agentsHandlers["agents.profile.get"]({
      params: { agentId: "main" },
      respond,
      req: { type: "req", id: "profile-1", method: "agents.profile.get" },
      client: null,
      isWebchatConnect: () => false,
      context: {} as never,
    });

    const payload = respond.mock.calls[0]?.[1];
    expect(respond.mock.calls[0]?.[0]).toBe(true);
    expect(JSON.stringify(payload)).not.toContain("secret-global");
    expect(JSON.stringify(payload)).not.toContain("secret-agent");
    expect(JSON.stringify(payload)).not.toContain("secret-access");
    expect(JSON.stringify(payload)).not.toContain("secret-refresh");
    expect(payload).toMatchObject({
      agentId: "main",
      tts: {
        effective: {
          elevenlabs: { voiceId: "agent-voice" },
        },
      },
      auth: {
        profileCount: 1,
        profiles: [{ id: "google:agent", provider: "google", email: "agent@example.com" }],
      },
    });
  });

  it("updates only the agent TTS profile surface", async () => {
    const respond = vi.fn();
    await agentsHandlers["agents.profile.update"]({
      params: {
        agentId: "main",
        tts: {
          provider: "elevenlabs",
          persona: "sam",
          elevenlabs: {
            apiKey: "must-not-save",
            voiceId: "voice-new",
            modelId: "eleven_multilingual_v2",
          },
          personas: {
            sam: {
              label: "Sam",
              prompt: { style: "warm", constraints: ["brief"] },
            },
          },
        },
      },
      respond,
      req: { type: "req", id: "profile-2", method: "agents.profile.update" },
      client: null,
      isWebchatConnect: () => false,
      context: {} as never,
    });

    expect(respond.mock.calls[0]?.[0]).toBe(true);
    expect(mocks.writeConfigFile).toHaveBeenCalledTimes(1);
    const saved = mocks.writeConfigFile.mock.calls[0]?.[0] as {
      agents?: { list?: Array<{ id: string; tts?: unknown }> };
    };
    expect(JSON.stringify(saved)).not.toContain("must-not-save");
    expect(saved.agents?.list?.[0]).toMatchObject({
      id: "main",
      tts: {
        provider: "elevenlabs",
        persona: "sam",
        elevenlabs: { voiceId: "voice-new", modelId: "eleven_multilingual_v2" },
        personas: {
          sam: {
            label: "Sam",
            prompt: { style: "warm", constraints: ["brief"] },
          },
        },
      },
    });
  });
});
