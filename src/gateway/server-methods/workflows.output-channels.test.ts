import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ArgentConfig } from "../../config/config.js";
import {
  buildWorkflowConnectorCapabilities,
  buildWorkflowConnectorCapabilitiesSafely,
  buildWorkflowOutputChannels,
} from "./workflows.js";

const mocks = vi.hoisted(() => ({
  config: {} as ArgentConfig,
  discoverConnectorCatalog: vi.fn(),
}));

vi.mock("../../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/config.js")>();
  return {
    ...actual,
    loadConfig: () => mocks.config,
  };
});

vi.mock("../../channels/plugins/index.js", () => ({
  listChannelPlugins: () => [],
}));

vi.mock("../../connectors/catalog.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../connectors/catalog.js")>();
  return {
    ...actual,
    discoverConnectorCatalog: mocks.discoverConnectorCatalog,
  };
});

describe("buildWorkflowOutputChannels", () => {
  beforeEach(() => {
    mocks.config = {};
    mocks.discoverConnectorCatalog.mockReset();
    mocks.discoverConnectorCatalog.mockResolvedValue({ connectors: [] });
  });

  it("surfaces configured core chat channels without the heavy plugin registry", async () => {
    mocks.config = {
      channels: {
        telegram: {
          botToken: "123:token",
          groups: {
            "-100123": { requireMention: false },
          },
          dms: {
            "555": {},
          },
          allowFrom: ["@operator"],
        },
      },
    } as ArgentConfig;

    const channels = await buildWorkflowOutputChannels();

    expect(channels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "telegram",
          label: "Telegram (Bot API)",
          configured: true,
          accountIds: expect.arrayContaining(["default"]),
          targets: expect.arrayContaining([
            expect.objectContaining({ id: "-100123", kind: "group" }),
            expect.objectContaining({ id: "555", kind: "dm" }),
            expect.objectContaining({ id: "@operator", kind: "allowlist" }),
          ]),
        }),
      ]),
    );
  });

  it("does not advertise tokenless channel configs as runnable output channels", async () => {
    mocks.config = {
      channels: {
        discord: {
          channels: {
            "123": { requireMention: false },
          },
        },
      },
    } as ArgentConfig;

    const channels = await buildWorkflowOutputChannels();

    expect(channels.some((channel) => channel.id === "discord")).toBe(false);
  });

  it("builds workflow connector capabilities from the connector catalog", async () => {
    mocks.discoverConnectorCatalog.mockResolvedValue({
      connectors: [
        {
          tool: "aos-slack",
          label: "Slack",
          category: "messaging",
          categories: ["messaging"],
          commands: [{ id: "message.send", summary: "Send message", actionClass: "write" }],
          installState: "ready",
          status: { ok: true },
        },
        {
          tool: "aos-placeholder",
          label: "Placeholder",
          category: "general",
          categories: ["general"],
          commands: [],
          installState: "repo-only",
          status: { ok: false },
        },
      ],
    });

    const connectors = await buildWorkflowConnectorCapabilities();

    expect(connectors).toEqual([
      expect.objectContaining({
        id: "aos-slack",
        name: "Slack",
        readinessState: "write_ready",
        commands: [expect.objectContaining({ id: "message.send", actionClass: "write" })],
      }),
      expect.objectContaining({
        id: "aos-placeholder",
        readinessState: "blocked",
      }),
    ]);
  });

  it("keeps workflow capabilities alive when connector discovery fails", async () => {
    mocks.discoverConnectorCatalog.mockRejectedValue(new Error("catalog unavailable"));

    await expect(buildWorkflowConnectorCapabilitiesSafely()).resolves.toEqual([]);
  });
});
