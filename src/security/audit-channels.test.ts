import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArgentConfig } from "../config/config.js";
import type { ResolvedTelegramAccount } from "../telegram/accounts.js";
import {
  collectChannelDeepProbeFindings,
  type TelegramAuditProbeEvidence,
} from "./audit-channels.js";
import { runSecurityAudit } from "./audit.js";

const TELEGRAM_TOKEN = "12345678:abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN";

function makeTelegramAccount(
  overrides: Partial<ResolvedTelegramAccount> = {},
): ResolvedTelegramAccount {
  const config = {
    botToken: TELEGRAM_TOKEN,
    ...overrides.config,
  };
  return {
    accountId: "default",
    enabled: true,
    name: undefined,
    token: TELEGRAM_TOKEN,
    tokenSource: "config",
    ...overrides,
    config,
  };
}

function expectFindingHasNoSecret(value: unknown, secret = TELEGRAM_TOKEN) {
  expect(JSON.stringify(value)).not.toContain(secret);
}

describe("channel deep security probes", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not treat service_keys as Telegram channel configuration", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    const cfg = {
      service_keys: { TELEGRAM_BOT_TOKEN: TELEGRAM_TOKEN },
    } as unknown as ArgentConfig;
    const probe = vi.fn(
      async (): Promise<TelegramAuditProbeEvidence> => ({
        ok: true,
        elapsedMs: 1,
      }),
    );

    const findings = await collectChannelDeepProbeFindings({
      cfg,
      live: true,
      timeoutMs: 25,
      deps: { telegram: { probe } },
    });

    expect(probe).not.toHaveBeenCalled();
    expect(findings).toEqual([]);
  });

  it("recognizes Telegram channel config as configured and probes it", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    const cfg = {
      service_keys: { TELEGRAM_BOT_TOKEN: "ignored-service-key" },
      channels: { telegram: { botToken: TELEGRAM_TOKEN } },
    } as unknown as ArgentConfig;
    const probe = vi.fn(
      async (): Promise<TelegramAuditProbeEvidence> => ({
        ok: true,
        elapsedMs: 1,
      }),
    );

    const findings = await collectChannelDeepProbeFindings({
      cfg,
      live: true,
      timeoutMs: 25,
      deps: { telegram: { probe } },
    });

    expect(probe).toHaveBeenCalledWith(TELEGRAM_TOKEN, 25, undefined);
    expect(findings).toEqual([
      expect.objectContaining({
        checkId: "channels.telegram.deep.probe_ok",
        severity: "info",
      }),
    ]);
    expectFindingHasNoSecret(findings);
  });

  it("surfaces injected Telegram getUpdates conflicts without printing the bot token", async () => {
    const probe = vi.fn(
      async (): Promise<TelegramAuditProbeEvidence> => ({
        ok: false,
        status: 409,
        method: "getUpdates",
        error: `Conflict: terminated by other getUpdates request for bot ${TELEGRAM_TOKEN}`,
        elapsedMs: 1,
      }),
    );

    const findings = await collectChannelDeepProbeFindings({
      cfg: {},
      live: true,
      timeoutMs: 25,
      deps: {
        telegram: {
          listAccounts: () => [makeTelegramAccount()],
          probe,
        },
      },
    });

    expect(findings).toEqual([
      expect.objectContaining({
        checkId: "channels.telegram.deep.polling_conflict",
        severity: "warn",
        proof: expect.arrayContaining(["method=getUpdates", "status=409"]),
      }),
    ]);
    expectFindingHasNoSecret(findings);
  });

  it("surfaces webhook-vs-polling conflicts from injected probe evidence", async () => {
    const probe = vi.fn(
      async (): Promise<TelegramAuditProbeEvidence> => ({
        ok: true,
        elapsedMs: 1,
        webhook: { url: `https://example.invalid/telegram/${TELEGRAM_TOKEN}` },
      }),
    );

    const findings = await collectChannelDeepProbeFindings({
      cfg: {},
      live: true,
      timeoutMs: 25,
      deps: {
        telegram: {
          listAccounts: () => [makeTelegramAccount()],
          probe,
        },
      },
    });

    expect(findings).toEqual([
      expect.objectContaining({
        checkId: "channels.telegram.deep.webhook_polling_conflict",
        severity: "warn",
        proof: expect.arrayContaining(["remoteWebhookConfigured=true", "localMode=polling"]),
      }),
    ]);
    expectFindingHasNoSecret(findings);
  });

  it("keeps channel probes behind deep audit mode in runSecurityAudit", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    const cfg: ArgentConfig = { channels: { telegram: { botToken: TELEGRAM_TOKEN } } };
    const probe = vi.fn(
      async (): Promise<TelegramAuditProbeEvidence> => ({
        ok: true,
        elapsedMs: 1,
      }),
    );

    await runSecurityAudit({
      config: cfg,
      domains: ["channels"],
      includeFilesystem: false,
      plugins: [],
      deep: false,
      channelDeepProbeDeps: { telegram: { probe } },
    });
    expect(probe).not.toHaveBeenCalled();

    const res = await runSecurityAudit({
      config: cfg,
      domains: ["channels"],
      includeFilesystem: false,
      plugins: [],
      deep: true,
      deepTimeoutMs: 25,
      channelDeepProbeDeps: { telegram: { probe } },
    });

    expect(probe).toHaveBeenCalledWith(TELEGRAM_TOKEN, 250, undefined);
    expect(res.findings).toEqual([
      expect.objectContaining({
        checkId: "channels.telegram.deep.probe_ok",
        domain: "channels",
      }),
    ]);
  });
});
