import { describe, expect, it } from "vitest";
import type { ArgentConfig } from "../../config/types.js";
import { createChannelConfigTool } from "./channel-config-tool.js";

describe("channel_config tool", () => {
  it("lists channel readiness from argent config without exposing secrets", async () => {
    const cfg: ArgentConfig = {
      channels: {
        telegram: {
          enabled: true,
          botToken: "super-private-telegram-token",
          dmPolicy: "allowlist",
          groupPolicy: "allowlist",
          allowFrom: ["8693117634"],
          groupAllowFrom: ["8693117634"],
        },
      },
    };
    const tool = createChannelConfigTool({ config: cfg });

    const result = await tool.execute("call-1", {});
    const text = result.content.find((block) => block.type === "text")?.text ?? "";

    expect(result.details).toMatchObject({
      ok: true,
      sourceOfTruth: "argent.json:channels",
      channels: [
        expect.objectContaining({
          id: "telegram",
          enabled: true,
          tokenConfigured: true,
          secretFieldsConfigured: ["botToken"],
          allowFromCount: 1,
          groupAllowFromCount: 1,
        }),
      ],
    });
    expect(text).not.toContain("super-private-telegram-token");
  });

  it("updates non-Telegram channels through argent config", async () => {
    let written: ArgentConfig | null = null;
    const tool = createChannelConfigTool({
      config: { channels: {} },
      writeConfigFile: async (cfg) => {
        written = cfg;
      },
    });

    const result = await tool.execute("call-2", {
      action: "update",
      channel: "slack",
      enabled: true,
      dmPolicy: "allowlist",
      allowFrom: "alice\nbob",
      token: "slack-secret-value",
      secretField: "appToken",
    });
    const text = result.content.find((block) => block.type === "text")?.text ?? "";

    expect(written).toMatchObject({
      channels: {
        slack: {
          enabled: true,
          dmPolicy: "allowlist",
          allowFrom: ["alice", "bob"],
          appToken: "slack-secret-value",
        },
      },
    });
    expect(result.details).toMatchObject({
      ok: true,
      sourceOfTruth: "argent.json:channels.slack",
      channel: expect.objectContaining({
        id: "slack",
        enabled: true,
        tokenConfigured: true,
        secretFieldsConfigured: ["appToken"],
      }),
    });
    expect(text).not.toContain("slack-secret-value");
  });

  it("uses botToken as Telegram's default write-only credential field", async () => {
    let written: ArgentConfig | null = null;
    const tool = createChannelConfigTool({
      config: {},
      writeConfigFile: async (cfg) => {
        written = cfg;
      },
    });

    await tool.execute("call-3", {
      action: "update",
      channel: "telegram",
      token: "telegram-secret-value",
    });

    expect(written).toMatchObject({
      channels: {
        telegram: {
          botToken: "telegram-secret-value",
        },
      },
    });
  });
});
