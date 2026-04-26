import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ArgentConfig } from "../../config/config.js";
import { buildWorkflowOutputChannels } from "./workflows.js";

const mocks = vi.hoisted(() => ({
  config: {} as ArgentConfig,
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

describe("buildWorkflowOutputChannels", () => {
  beforeEach(() => {
    mocks.config = {};
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
});
