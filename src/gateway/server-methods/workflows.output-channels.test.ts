import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ArgentConfig } from "../../config/config.js";
import type { WorkflowDefinition } from "../../infra/workflow-types.js";
import {
  buildWorkflowConnectorCapabilities,
  buildWorkflowConnectorCapabilitiesSafely,
  buildWorkflowOutputChannels,
  validateWorkflowRuntimeCapabilities,
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

  it("includes per-account chat targets for configured output channels", async () => {
    mocks.config = {
      channels: {
        telegram: {
          accounts: {
            operator: {
              botToken: "123:token",
              groups: {
                "-100456": { requireMention: false },
              },
              dms: {
                "777": {},
              },
              allowFrom: ["@jason"],
            },
          },
        },
      },
    } as ArgentConfig;

    const channels = await buildWorkflowOutputChannels();

    expect(channels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "telegram",
          configured: true,
          accountIds: ["operator"],
          targets: expect.arrayContaining([
            expect.objectContaining({ id: "-100456", kind: "group" }),
            expect.objectContaining({ id: "777", kind: "dm" }),
            expect.objectContaining({ id: "@jason", kind: "dm" }),
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
          discovery: { binaryPath: "/tmp/aos-slack" },
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

  it("truth-labels AppForge Core as read-ready metadata, not connector runtime write-ready", async () => {
    mocks.discoverConnectorCatalog.mockResolvedValue({
      connectors: [
        {
          tool: "appforge-core",
          label: "AppForge Core",
          category: "appforge",
          categories: ["appforge", "workflow"],
          commands: [
            { id: "appforge.bases.list", summary: "List bases", actionClass: "read" },
            { id: "appforge.tables.list", summary: "List tables", actionClass: "read" },
            { id: "workflows.emitAppForgeEvent", summary: "Emit event", actionClass: "read" },
          ],
          installState: "metadata-only",
          status: { ok: true },
          discovery: {},
        },
      ],
    });

    const connectors = await buildWorkflowConnectorCapabilities();

    expect(connectors).toEqual([
      expect.objectContaining({
        id: "appforge-core",
        name: "AppForge Core",
        readinessState: "read_ready",
        installState: "metadata-only",
        statusOk: true,
        commands: expect.arrayContaining([
          expect.objectContaining({ id: "appforge.bases.list", actionClass: "read" }),
          expect.objectContaining({ id: "appforge.tables.list", actionClass: "read" }),
          expect.objectContaining({ id: "workflows.emitAppForgeEvent", actionClass: "read" }),
        ]),
      }),
    ]);
  });

  it("keeps workflow capabilities alive when connector discovery fails", async () => {
    mocks.discoverConnectorCatalog.mockRejectedValue(new Error("catalog unavailable"));

    await expect(buildWorkflowConnectorCapabilitiesSafely()).resolves.toEqual([]);
  });

  it("flags workflow destinations that are not currently runnable", async () => {
    mocks.config = {
      channels: {
        discord: {
          channels: {
            "123": { requireMention: false },
          },
        },
      },
    } as ArgentConfig;
    mocks.discoverConnectorCatalog.mockResolvedValue({
      connectors: [
        {
          tool: "aos-placeholder",
          label: "Placeholder",
          category: "general",
          categories: ["general"],
          commands: [{ id: "message.send", summary: "Send message", actionClass: "write" }],
          installState: "repo-only",
          status: { ok: false },
        },
      ],
    });

    const workflow: WorkflowDefinition = {
      id: "wf-runtime",
      name: "Runtime Validation",
      version: 1,
      ownerAgentId: "argent",
      deploymentStage: "live",
      defaultOnError: { strategy: "fail", notifyOnError: true },
      maxRunDurationMs: 60000,
      nodes: [
        {
          kind: "trigger",
          id: "trigger",
          label: "Manual",
          config: { triggerType: "manual" },
        },
        {
          kind: "action",
          id: "send",
          label: "Send message",
          config: {
            actionType: {
              type: "send_message",
              channelType: "discord",
              channelId: "123",
              template: "Hi",
            },
          },
        },
        {
          kind: "output",
          id: "out",
          label: "Output",
          config: {
            outputType: "connector_action",
            connectorId: "aos-placeholder",
            resource: "message",
            operation: "message.send",
            parameters: { text: "{{previous.text}}" },
          },
        },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "send" },
        { id: "e2", source: "send", target: "out" },
      ],
    };

    const issues = await validateWorkflowRuntimeCapabilities(workflow);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "workflow_action_channel_unavailable",
          nodeId: "send",
        }),
        expect.objectContaining({
          code: "workflow_output_connector_unavailable",
          nodeId: "out",
        }),
      ]),
    );
  });

  it("rejects connector outputs that point at read-only operations", async () => {
    mocks.discoverConnectorCatalog.mockResolvedValue({
      connectors: [
        {
          tool: "aos-buffer",
          label: "Buffer",
          category: "social",
          categories: ["social"],
          commands: [{ id: "post.list", summary: "List posts", actionClass: "read" }],
          installState: "ready",
          status: { ok: true },
          discovery: { binaryPath: "/tmp/aos-buffer" },
        },
      ],
    });

    const workflow: WorkflowDefinition = {
      id: "wf-readonly-output",
      name: "Read-only Output",
      version: 1,
      ownerAgentId: "argent",
      deploymentStage: "live",
      defaultOnError: { strategy: "fail" },
      nodes: [
        {
          kind: "trigger",
          id: "trigger",
          label: "Manual",
          config: { triggerType: "manual" },
        },
        {
          kind: "output",
          id: "out",
          label: "Output",
          config: {
            outputType: "connector_action",
            connectorId: "aos-buffer",
            resource: "post",
            operation: "post.list",
            parameters: {},
          },
        },
      ],
      edges: [{ id: "e1", source: "trigger", target: "out" }],
    };

    const issues = await validateWorkflowRuntimeCapabilities(workflow);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "workflow_output_connector_operation_unavailable",
          nodeId: "out",
        }),
      ]),
    );
  });
});
