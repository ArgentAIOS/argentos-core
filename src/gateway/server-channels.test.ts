import { describe, expect, it, vi } from "vitest";
import type { ChannelId, ChannelPlugin } from "../channels/plugins/types.js";
import type { ArgentConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";

const hoisted = vi.hoisted(() => ({
  plugins: [] as ChannelPlugin[],
  resetDirectoryCache: vi.fn(),
}));

vi.mock("../channels/plugins/index.js", () => ({
  listChannelPlugins: () => hoisted.plugins,
  getChannelPlugin: (id: ChannelId) => hoisted.plugins.find((plugin) => plugin.id === id),
}));

vi.mock("../infra/outbound/target-resolver.js", () => ({
  resetDirectoryCache: hoisted.resetDirectoryCache,
}));

import { createChannelManager } from "./server-channels.js";

function createLog() {
  return {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
}

function createGatewayPlugin(params: {
  id: ChannelId;
  accountIds?: string[];
  listAccountIds?: () => string[];
  resolveAccount?: (cfg: ArgentConfig, accountId?: string | null) => unknown;
  startAccount?: ChannelPlugin["gateway"] extends infer Gateway
    ? Gateway extends { startAccount?: infer StartAccount }
      ? StartAccount
      : never
    : never;
}): ChannelPlugin {
  const id = params.id;
  return {
    id,
    meta: {
      id,
      label: String(id),
      selectionLabel: String(id),
      docsPath: `/channels/${id}`,
      blurb: "test channel",
    },
    capabilities: { chatTypes: ["direct"] },
    config: {
      listAccountIds: params.listAccountIds ?? (() => params.accountIds ?? ["default"]),
      resolveAccount: params.resolveAccount ?? ((_cfg, accountId) => ({ accountId })),
    },
    gateway: {
      startAccount: params.startAccount ?? vi.fn(async () => new Promise(() => {})),
    },
  } as ChannelPlugin;
}

describe("createChannelManager", () => {
  it("isolates synchronous channel startup failures and starts remaining channels", async () => {
    const badLog = createLog();
    const goodLog = createLog();
    const goodStart = vi.fn(async () => new Promise(() => {}));
    hoisted.plugins = [
      createGatewayPlugin({
        id: "discord",
        startAccount: vi.fn(() => {
          throw new Error("failed to resolve app identity");
        }),
      }),
      createGatewayPlugin({ id: "telegram", startAccount: goodStart }),
    ];

    const manager = createChannelManager({
      loadConfig: () => ({ channels: {} }) as ArgentConfig,
      channelLogs: { discord: badLog, telegram: goodLog } as never,
      channelRuntimeEnvs: { discord: {}, telegram: {} } as Record<ChannelId, RuntimeEnv>,
    });

    await expect(manager.startChannels()).resolves.toBeUndefined();

    const snapshot = manager.getRuntimeSnapshot();
    expect(snapshot.channels.discord).toMatchObject({
      accountId: "default",
      running: false,
      lastError: "failed to resolve app identity",
    });
    expect(snapshot.channels.telegram).toMatchObject({
      accountId: "default",
      running: true,
      lastError: null,
    });
    expect(goodStart).toHaveBeenCalledTimes(1);
    expect(badLog.error).toHaveBeenCalledWith(
      "[default] channel startup failed: failed to resolve app identity",
    );
  });

  it("keeps channel status responsive when account config resolution throws", async () => {
    const badLog = createLog();
    hoisted.plugins = [
      createGatewayPlugin({
        id: "telegram",
        listAccountIds: () => {
          throw new Error("invalid account config");
        },
      }),
    ];

    const manager = createChannelManager({
      loadConfig: () => ({ channels: {} }) as ArgentConfig,
      channelLogs: { telegram: badLog } as never,
      channelRuntimeEnvs: { telegram: {} } as Record<ChannelId, RuntimeEnv>,
    });

    await expect(manager.startChannels()).resolves.toBeUndefined();
    const snapshot = manager.getRuntimeSnapshot();

    expect(snapshot.channels.telegram).toMatchObject({
      accountId: "default",
      running: false,
      lastError: "invalid account config",
    });
    expect(badLog.error).toHaveBeenCalledWith(
      "[default] channel startup skipped: invalid account config",
    );
    expect(badLog.error).toHaveBeenCalledWith(
      "[default] channel status failed: invalid account config",
    );
  });
});
