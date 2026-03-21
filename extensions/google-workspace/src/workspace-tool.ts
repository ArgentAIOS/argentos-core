import { Type } from "@sinclair/typebox";
import type { ArgentPluginApi } from "../../../src/plugins/types.js";
import type {
  PluginConfig,
  EmailUsageReport,
  GmailActivityEvent,
  WorkspaceUser,
  EmailSummary,
} from "./types.js";
import {
  formatEmailStats,
  formatUserInfo,
  formatUserList,
  formatEmailSummary,
  formatActivityEvents,
} from "./formatters.js";
import { getApiClients, testConnectivity } from "./google-auth.js";

// ============================================================================
// Schema
// ============================================================================

const GWorkspaceSchema = Type.Object({
  action: Type.Union([
    Type.Literal("user_email_stats"),
    Type.Literal("email_activity"),
    Type.Literal("user_lookup"),
    Type.Literal("user_list"),
    Type.Literal("email_summary"),
    Type.Literal("setup"),
  ]),
  user: Type.Optional(
    Type.String({ description: "Email address or 'all' for domain-wide queries." }),
  ),
  start_date: Type.Optional(Type.String({ description: "Start date in YYYY-MM-DD format." })),
  end_date: Type.Optional(Type.String({ description: "End date in YYYY-MM-DD format." })),
  event_type: Type.Optional(
    Type.String({ description: "Gmail event filter: send, receive, etc." }),
  ),
  org_unit: Type.Optional(
    Type.String({ description: "Organizational unit path (e.g. /Engineering)." }),
  ),
  query: Type.Optional(Type.String({ description: "Search query for user_list action." })),
  max_results: Type.Optional(
    Type.Number({ description: "Maximum results to return. Default: 50." }),
  ),
  top_n: Type.Optional(
    Type.Number({ description: "Number of top senders/receivers for email_summary. Default: 10." }),
  ),
});

// ============================================================================
// Helpers
// ============================================================================

function readStr(params: Record<string, unknown>, key: string): string | undefined {
  const v = params[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function readNum(params: Record<string, unknown>, key: string, fallback: number): number {
  const v = params[key];
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.trunc(v);
  if (typeof v === "string") {
    const n = Number.parseInt(v, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return fallback;
}

function jsonResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

/** Generate array of YYYY-MM-DD strings from start to end (inclusive). */
function dateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  while (d <= endDate) {
    dates.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
}

/** Chunk a date range into 30-day windows for the Activities API. */
function chunkDateRange(start: string, end: string): Array<{ start: string; end: string }> {
  const chunks: Array<{ start: string; end: string }> = [];
  const d = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  while (d <= endDate) {
    const chunkEnd = new Date(d);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + 29);
    if (chunkEnd > endDate) chunkEnd.setTime(endDate.getTime());
    chunks.push({
      start: d.toISOString().slice(0, 10),
      end: chunkEnd.toISOString().slice(0, 10),
    });
    d.setUTCDate(d.getUTCDate() + 30);
  }
  return chunks;
}

function getDefaultDateRange(): { start: string; end: string } {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 2); // 2-day report lag
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6); // 7-day window
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

// ============================================================================
// Actions
// ============================================================================

async function actionSetup(config: PluginConfig): Promise<unknown> {
  try {
    const status = await testConnectivity(config);
    return {
      text: `Google Workspace Admin — Setup OK\n\n${status}\nAdmin: ${config.adminEmail}\nKey: ${config.serviceAccountKeyPath.replace(/.*\//, ".../")}`,
      status: "connected",
      domain: config.domain,
      adminEmail: config.adminEmail,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      text: `Google Workspace Admin — Connection FAILED\n\nError: ${msg}\n\nCheck:\n1. Service account key file exists at configured path\n2. Domain-wide delegation is enabled in Google Admin Console\n3. Required scopes are authorized\n4. Admin email is a super admin of the domain`,
      status: "error",
      error: msg,
    };
  }
}

async function actionUserEmailStats(
  config: PluginConfig,
  params: Record<string, unknown>,
): Promise<unknown> {
  const user = readStr(params, "user");
  if (!user) return { text: "Error: 'user' parameter required (email address).", error: true };

  const defaults = getDefaultDateRange();
  const startDate = readStr(params, "start_date") ?? defaults.start;
  const endDate = readStr(params, "end_date") ?? defaults.end;
  const { reports: reportsApi } = getApiClients(config);

  const reports: EmailUsageReport[] = [];
  const dates = dateRange(startDate, endDate);

  for (const date of dates) {
    try {
      const res = await reportsApi.userUsageReport.get({
        userKey: user === "all" ? "all" : user,
        date,
        parameters:
          "accounts:gmail_timestamp_last_access,gmail:num_emails_sent,gmail:num_emails_received,gmail:num_spam_emails_received",
      });

      const usageReports = res.data.usageReports ?? [];
      for (const report of usageReports) {
        const email = report.entity?.userEmail ?? user;
        let sent = 0;
        let received = 0;
        let spam = 0;

        for (const param of report.parameters ?? []) {
          if (param.name === "gmail:num_emails_sent") {
            sent = Number(param.intValue ?? 0);
          } else if (param.name === "gmail:num_emails_received") {
            received = Number(param.intValue ?? 0);
          } else if (param.name === "gmail:num_spam_emails_received") {
            spam = Number(param.intValue ?? 0);
          }
        }

        reports.push({ date, email, sent, received, spam });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Data for dates later than")) {
        reports.push({ date, email: user, sent: 0, received: 0, spam: 0 });
      } else {
        throw err;
      }
    }
  }

  return {
    text: formatEmailStats(reports),
    user,
    startDate,
    endDate,
    reports,
  };
}

async function actionEmailActivity(
  config: PluginConfig,
  params: Record<string, unknown>,
): Promise<unknown> {
  const defaults = getDefaultDateRange();
  const startDate = readStr(params, "start_date") ?? defaults.start;
  const endDate = readStr(params, "end_date") ?? defaults.end;
  const user = readStr(params, "user");
  const eventType = readStr(params, "event_type");
  const maxResults = readNum(params, "max_results", 50);
  const { reports: reportsApi } = getApiClients(config);

  const chunks = chunkDateRange(startDate, endDate);
  const events: GmailActivityEvent[] = [];

  for (const chunk of chunks) {
    if (events.length >= maxResults) break;

    let pageToken: string | undefined;
    do {
      const res = await reportsApi.activities.list({
        userKey: user === "all" || !user ? "all" : user,
        applicationName: "gmail",
        startTime: `${chunk.start}T00:00:00.000Z`,
        endTime: `${chunk.end}T23:59:59.999Z`,
        maxResults: Math.min(maxResults - events.length, 1000),
        pageToken,
        eventName: eventType,
      });

      for (const item of res.data.items ?? []) {
        if (events.length >= maxResults) break;

        const actor = item.actor?.email ?? "unknown";
        for (const evt of item.events ?? []) {
          if (events.length >= maxResults) break;

          const event: GmailActivityEvent = {
            timestamp: item.id?.time ?? "",
            actor,
            eventType: evt.name ?? "unknown",
          };

          for (const p of evt.parameters ?? []) {
            if (p.name === "subject") event.subject = p.value;
            if (p.name === "destination_recipient_address") event.recipient = p.value;
            if (p.name === "message_id") event.messageId = p.value;
          }

          events.push(event);
        }
      }

      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken && events.length < maxResults);
  }

  return {
    text: formatActivityEvents(events),
    startDate,
    endDate,
    eventType: eventType ?? "all",
    count: events.length,
    events,
  };
}

async function actionUserLookup(
  config: PluginConfig,
  params: Record<string, unknown>,
): Promise<unknown> {
  const user = readStr(params, "user");
  if (!user) return { text: "Error: 'user' parameter required (email address).", error: true };

  const { directory } = getApiClients(config);
  const res = await directory.users.get({
    userKey: user,
    projection: "full",
  });

  const u = res.data;
  const wsUser: WorkspaceUser = {
    email: u.primaryEmail ?? user,
    name:
      typeof u.name === "object"
        ? `${u.name.givenName ?? ""} ${u.name.familyName ?? ""}`.trim()
        : user,
    orgUnit: (u.orgUnitPath as string) ?? "/",
    lastLogin: (u.lastLoginTime as string) ?? "never",
    suspended: u.suspended === true,
    isAdmin: u.isAdmin === true,
    creationTime: (u.creationTime as string) ?? "unknown",
  };

  return {
    text: formatUserInfo(wsUser),
    user: wsUser,
  };
}

async function actionUserList(
  config: PluginConfig,
  params: Record<string, unknown>,
): Promise<unknown> {
  const orgUnit = readStr(params, "org_unit");
  const query = readStr(params, "query");
  const maxResults = readNum(params, "max_results", 50);
  const { directory } = getApiClients(config);

  const users: WorkspaceUser[] = [];
  let pageToken: string | undefined;

  do {
    const listParams: Record<string, unknown> = {
      domain: config.domain,
      maxResults: Math.min(maxResults - users.length, 500),
      projection: "basic",
      orderBy: "email",
      pageToken,
    };
    if (orgUnit) listParams.orgUnitPath = orgUnit;
    if (query) listParams.query = query;

    // oxlint-disable-next-line typescript/no-explicit-any
    const res = await directory.users.list(listParams as any);

    for (const u of res.data.users ?? []) {
      if (users.length >= maxResults) break;
      users.push({
        email: u.primaryEmail ?? "",
        name:
          typeof u.name === "object"
            ? `${u.name.givenName ?? ""} ${u.name.familyName ?? ""}`.trim()
            : "",
        orgUnit: (u.orgUnitPath as string) ?? "/",
        lastLogin: (u.lastLoginTime as string) ?? "never",
        suspended: u.suspended === true,
        isAdmin: u.isAdmin === true,
        creationTime: (u.creationTime as string) ?? "unknown",
      });
    }

    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken && users.length < maxResults);

  return {
    text: formatUserList(users),
    count: users.length,
    users,
  };
}

async function actionEmailSummary(
  config: PluginConfig,
  params: Record<string, unknown>,
): Promise<unknown> {
  const defaults = getDefaultDateRange();
  const startDate = readStr(params, "start_date") ?? defaults.start;
  const endDate = readStr(params, "end_date") ?? defaults.end;
  const topN = readNum(params, "top_n", 10);
  const { reports: reportsApi } = getApiClients(config);

  // Aggregate per-user totals across the date range
  const userTotals = new Map<string, { sent: number; received: number; spam: number }>();
  const dates = dateRange(startDate, endDate);

  for (const date of dates) {
    try {
      let pageToken: string | undefined;
      do {
        const res = await reportsApi.userUsageReport.get({
          userKey: "all",
          date,
          parameters:
            "gmail:num_emails_sent,gmail:num_emails_received,gmail:num_spam_emails_received",
          pageToken,
        });

        for (const report of res.data.usageReports ?? []) {
          const email = report.entity?.userEmail ?? "unknown";
          const existing = userTotals.get(email) ?? { sent: 0, received: 0, spam: 0 };

          for (const param of report.parameters ?? []) {
            if (param.name === "gmail:num_emails_sent") {
              existing.sent += Number(param.intValue ?? 0);
            } else if (param.name === "gmail:num_emails_received") {
              existing.received += Number(param.intValue ?? 0);
            } else if (param.name === "gmail:num_spam_emails_received") {
              existing.spam += Number(param.intValue ?? 0);
            }
          }

          userTotals.set(email, existing);
        }

        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("Data for dates later than")) throw err;
      // Skip dates with no data yet (report lag)
    }
  }

  let totalSent = 0;
  let totalReceived = 0;
  let totalSpam = 0;
  for (const t of userTotals.values()) {
    totalSent += t.sent;
    totalReceived += t.received;
    totalSpam += t.spam;
  }

  const byEmail = [...userTotals.entries()].map(([email, t]) => ({ email, ...t }));
  const topSenders = byEmail
    .sort((a, b) => b.sent - a.sent)
    .slice(0, topN)
    .map(({ email, sent }) => ({ email, sent }));
  const topReceivers = byEmail
    .sort((a, b) => b.received - a.received)
    .slice(0, topN)
    .map(({ email, received }) => ({ email, received }));

  const summary: EmailSummary = {
    startDate,
    endDate,
    totalSent,
    totalReceived,
    totalSpam,
    userCount: userTotals.size,
    topSenders,
    topReceivers,
  };

  return {
    text: formatEmailSummary(summary),
    summary,
  };
}

// ============================================================================
// Tool Factory
// ============================================================================

export function createGWorkspaceTool(api: ArgentPluginApi) {
  return {
    name: "gworkspace",
    label: "Google Workspace Admin",
    description: [
      "Google Workspace administration tool. Management-level access to email reports, activity logs, and user directory.",
      "",
      "Actions:",
      "  user_email_stats — Daily sent/received/spam counts per user over a date range",
      "  email_activity   — Granular Gmail events (send/receive) with timestamps (30-day max per window, auto-chunked)",
      "  user_lookup      — Single user info (name, email, org unit, last login, status)",
      "  user_list        — List/search users in domain, optional org unit filter",
      "  email_summary    — Management overview: total org email volume, top senders/receivers",
      "  setup            — Test connectivity and show config status",
      "",
      "Note: Reports API data has ~2 day lag. Very recent dates may return no data.",
    ].join("\n"),
    parameters: GWorkspaceSchema,

    async execute(_id: string, params: Record<string, unknown>) {
      const action = readStr(params, "action");
      if (!action) return jsonResult({ text: "Error: 'action' parameter required.", error: true });

      const pluginCfg = (api.pluginConfig ?? {}) as PluginConfig;
      if (!pluginCfg.serviceAccountKeyPath || !pluginCfg.adminEmail || !pluginCfg.domain) {
        return jsonResult({
          text: "Error: Google Workspace extension not configured. Set serviceAccountKeyPath, adminEmail, and domain in plugin config.",
          error: true,
        });
      }

      try {
        switch (action) {
          case "setup":
            return jsonResult(await actionSetup(pluginCfg));
          case "user_email_stats":
            return jsonResult(await actionUserEmailStats(pluginCfg, params));
          case "email_activity":
            return jsonResult(await actionEmailActivity(pluginCfg, params));
          case "user_lookup":
            return jsonResult(await actionUserLookup(pluginCfg, params));
          case "user_list":
            return jsonResult(await actionUserList(pluginCfg, params));
          case "email_summary":
            return jsonResult(await actionEmailSummary(pluginCfg, params));
          default:
            return jsonResult({
              text: `Unknown action: ${action}. Valid: user_email_stats, email_activity, user_lookup, user_list, email_summary, setup`,
              error: true,
            });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonResult({ text: `Google Workspace API error: ${msg}`, error: true });
      }
    },
  };
}
