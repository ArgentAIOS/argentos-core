import type { ArgentConfig } from "../config/config.js";
import type { ResolvedTelegramAccount } from "../telegram/accounts.js";
import type { TelegramProbe } from "../telegram/probe.js";
import type { SecurityAuditFinding } from "./audit.js";
import { listEnabledTelegramAccounts } from "../telegram/accounts.js";
import { probeTelegram } from "../telegram/probe.js";
import { redactSensitiveText } from "../utils/redact.js";

export type TelegramAuditProbeEvidence = TelegramProbe & {
  method?: "getMe" | "getUpdates" | "getWebhookInfo";
};

export type ChannelDeepProbeDependencies = {
  telegram?: {
    listAccounts?: (cfg: ArgentConfig) => ResolvedTelegramAccount[];
    probe?: (
      token: string,
      timeoutMs: number,
      proxyUrl?: string,
    ) => Promise<TelegramAuditProbeEvidence>;
  };
};

export type ChannelDeepProbeOptions = {
  cfg: ArgentConfig;
  live: boolean;
  timeoutMs: number;
  deps?: ChannelDeepProbeDependencies;
};

export async function collectChannelDeepProbeFindings(
  opts: ChannelDeepProbeOptions,
): Promise<SecurityAuditFinding[]> {
  if (!opts.live) {
    return [];
  }
  return collectTelegramDeepProbeFindings(opts);
}

async function collectTelegramDeepProbeFindings(
  opts: ChannelDeepProbeOptions,
): Promise<SecurityAuditFinding[]> {
  const findings: SecurityAuditFinding[] = [];
  const listAccounts = opts.deps?.telegram?.listAccounts ?? listEnabledTelegramAccounts;
  const probe = opts.deps?.telegram?.probe ?? probeTelegram;
  const accounts = listAccounts(opts.cfg).filter((account) => account.token.trim());

  for (const account of accounts) {
    const evidence = await probe(account.token, opts.timeoutMs, account.config.proxy).catch(
      (err): TelegramAuditProbeEvidence => ({
        ok: false,
        status: null,
        error: err instanceof Error ? err.message : String(err),
        elapsedMs: 0,
      }),
    );
    const secrets = collectTelegramSecrets(account);
    findings.push(...evaluateTelegramProbeEvidence(account, evidence, secrets));
  }

  return findings;
}

function evaluateTelegramProbeEvidence(
  account: ResolvedTelegramAccount,
  evidence: TelegramAuditProbeEvidence,
  secrets: string[],
): SecurityAuditFinding[] {
  const findings: SecurityAuditFinding[] = [];
  const error = sanitizeProbeText(evidence.error ?? "", secrets);
  const accountLabel = sanitizeProbeText(account.accountId, secrets);
  const errorLower = error.toLowerCase();
  const method = evidence.method ?? inferTelegramMethod(error);
  const pollingConflict =
    evidence.status === 409 &&
    (method === "getUpdates" ||
      (errorLower.includes("getupdates") &&
        (errorLower.includes("conflict") || errorLower.includes("webhook"))));

  if (pollingConflict) {
    findings.push({
      checkId: "channels.telegram.deep.polling_conflict",
      severity: "warn",
      title: "Telegram polling conflict detected",
      detail:
        `Telegram Bot API reported a getUpdates conflict for account ${accountLabel}.` +
        (error ? ` ${error}` : ""),
      proof: compactProof([
        `account=${accountLabel}`,
        "provider=telegram",
        "method=getUpdates",
        "status=409",
      ]),
      remediation:
        "Stop the other bot poller, or remove the Telegram webhook before using polling mode.",
    });
  }

  if (!evidence.ok && !pollingConflict) {
    findings.push({
      checkId: "channels.telegram.deep.probe_failed",
      severity: "warn",
      title: "Telegram deep probe failed",
      detail:
        `Telegram Bot API probe failed for account ${accountLabel}.` +
        (evidence.status ? ` status=${evidence.status}.` : "") +
        (error ? ` ${error}` : ""),
      proof: compactProof([
        `account=${accountLabel}`,
        "provider=telegram",
        evidence.status ? `status=${evidence.status}` : null,
      ]),
      remediation:
        "Verify the Telegram bot token and network path, then re-run argent security audit --deep.",
    });
  }

  const remoteWebhookConfigured = Boolean(evidence.webhook?.url?.trim());
  const localUsesWebhook = Boolean(account.config.webhookUrl?.trim());
  if (evidence.ok && remoteWebhookConfigured && !localUsesWebhook) {
    findings.push({
      checkId: "channels.telegram.deep.webhook_polling_conflict",
      severity: "warn",
      title: "Telegram webhook conflicts with polling mode",
      detail:
        `Telegram has a webhook configured for account ${accountLabel}, but Argent is configured for polling. ` +
        "Telegram will reject getUpdates until the webhook is removed.",
      proof: compactProof([
        `account=${accountLabel}`,
        "provider=telegram",
        "remoteWebhookConfigured=true",
        "localMode=polling",
      ]),
      remediation:
        "Run Telegram deleteWebhook for this bot, or configure channels.telegram.webhookUrl/webhookSecret and run webhook mode intentionally.",
    });
  }

  if (evidence.ok && findings.length === 0) {
    findings.push({
      checkId: "channels.telegram.deep.probe_ok",
      severity: "info",
      title: "Telegram deep probe completed",
      detail: `Telegram account ${accountLabel} reached the Bot API successfully.`,
      proof: compactProof([
        `account=${accountLabel}`,
        "provider=telegram",
        `tokenSource=${account.tokenSource}`,
      ]),
    });
  }

  return findings;
}

function inferTelegramMethod(error: string): TelegramAuditProbeEvidence["method"] | undefined {
  const lower = error.toLowerCase();
  if (lower.includes("getupdates")) {
    return "getUpdates";
  }
  if (lower.includes("getwebhookinfo")) {
    return "getWebhookInfo";
  }
  if (lower.includes("getme")) {
    return "getMe";
  }
  return undefined;
}

function collectTelegramSecrets(account: ResolvedTelegramAccount): string[] {
  return [
    account.token,
    account.config.botToken,
    account.config.webhookSecret,
    account.config.webhookUrl,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
}

function sanitizeProbeText(text: string, secrets: string[]): string {
  let sanitized = redactSensitiveText(text);
  for (const secret of secrets) {
    sanitized = sanitized.split(secret).join("[redacted]");
  }
  return sanitized;
}

function compactProof(items: Array<string | null | undefined | false>): string[] {
  return items.filter((item): item is string => typeof item === "string" && item.length > 0);
}
