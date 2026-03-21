/**
 * Atera Advanced Integration Tools — built on MSP Tool Framework.
 *
 * Provides three new tools beyond the base Atera plugin:
 *
 * 1. atera_endpoint_diagnostics — Deep device health diagnostics
 *    (hardware inventory, disk analysis, uptime, alert correlation, network info)
 *
 * 2. atera_remote_action — Remote action dispatch layer
 *    (ticket-linked actions: restart monitoring, create alert, update custom fields,
 *     generate diagnostic reports — actions constrained to API-safe operations)
 *
 * 3. atera_patch_status — Patch compliance and OS version tracking
 *    (OS version inventory, stale agent detection, compliance scoring,
 *     customer-level patch posture reports)
 *
 * All tools use the MSP Tool Framework for auth, retry, error handling, and audit.
 * Rate limiting: in-memory token bucket, default 30 req/min per Atera's documented limit.
 */

import type { AgentToolResult } from "../../agent-core/core.js";
import type { AnyAgentTool } from "./common.js";
import {
  createMSPTool,
  mspFetch,
  MSPApiError,
  resolveServiceApiKey,
  type MSPToolConfig,
  type MSPActionHandler,
  type RetryPolicy,
} from "./msp-tool-framework.js";

// ────────────────────────────────────────────────────────────────
// Atera-specific Config
// ────────────────────────────────────────────────────────────────

const ATERA_BASE = "https://app.atera.com/api/v3";

interface AteraToolConfig extends MSPToolConfig {
  technicianId?: number;
}

function resolveAteraConfig(): AteraToolConfig {
  const apiKey = resolveServiceApiKey("ATERA_API_KEY") ?? "";
  // Read technician ID from plugin config
  let techId: number | undefined;
  try {
    const fs = require("node:fs");
    const path = require("node:path");
    const cfgPath = path.join(process.env.HOME ?? "/tmp", ".argentos", "argent.json");
    const raw = fs.readFileSync(cfgPath, "utf-8");
    const cfg = JSON.parse(raw);
    techId = cfg?.plugins?.entries?.atera?.config?.technicianId;
  } catch {
    /* ignore */
  }
  return { apiKey, serviceName: "Atera", technicianId: techId };
}

// ────────────────────────────────────────────────────────────────
// Rate Limiter — Token Bucket
// ────────────────────────────────────────────────────────────────

class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  constructor(
    private maxTokens: number,
    private refillRatePerSec: number,
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  consume(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRatePerSec);
    this.lastRefill = now;
  }

  get available(): number {
    this.refill();
    return Math.floor(this.tokens);
  }
}

// 30 requests/minute = 0.5/sec, burst up to 30 (full minute's worth)
const rateLimiter = new TokenBucket(30, 0.5);

/** Reset rate limiter and cache (exposed for testing). */
export function _resetRateLimiter(): void {
  Object.assign(rateLimiter, new TokenBucket(30, 0.5));
  agentCache.clear();
}

// ────────────────────────────────────────────────────────────────
// Response Cache — TTL-based
// ────────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  cachedAt: number;
}

class ResponseCache<T> {
  private cache = new Map<string, CacheEntry<T>>();

  get(key: string, ttlMs: number): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.cachedAt > ttlMs) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.data;
  }

  set(key: string, data: T): void {
    this.cache.set(key, { data, cachedAt: Date.now() });
    // Evict old entries
    if (this.cache.size > 200) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
  }

  clear(): void {
    this.cache.clear();
  }
}

const agentCache = new ResponseCache<unknown>();
const CACHE_TTL_MS = 60_000; // 1 minute

// ────────────────────────────────────────────────────────────────
// Atera API Helpers (rate-limited + cached)
// ────────────────────────────────────────────────────────────────

const ATERA_RETRY: RetryPolicy = {
  maxRetries: 2,
  baseDelayMs: 1000,
  maxDelayMs: 8000,
  jitterFactor: 0.3,
  retryableStatusCodes: [429, 500, 502, 503, 504],
};

async function ateraGet(
  endpoint: string,
  config: AteraToolConfig,
  params?: Record<string, string | number>,
): Promise<unknown> {
  if (!rateLimiter.consume()) {
    throw new MSPApiError({
      service: "Atera",
      endpoint,
      statusCode: 429,
      statusText: "Rate Limited (local)",
      body: `Local rate limiter: ${rateLimiter.available} tokens remaining. Wait a few seconds.`,
    });
  }

  const url = new URL(`${ATERA_BASE}${endpoint}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v));
    }
  }

  const cacheKey = url.toString();
  const cached = agentCache.get(cacheKey, CACHE_TTL_MS);
  if (cached) return cached;

  const result = await mspFetch({
    url: url.toString(),
    service: "Atera",
    apiKey: config.apiKey,
    retryPolicy: ATERA_RETRY,
  });

  agentCache.set(cacheKey, result);
  return result;
}

async function ateraGetAll(
  endpoint: string,
  config: AteraToolConfig,
  extraParams?: Record<string, string | number>,
  maxPages = 5,
): Promise<unknown[]> {
  const items: unknown[] = [];
  const pageSize = 50;
  for (let page = 1; page <= maxPages; page++) {
    const data = (await ateraGet(endpoint, config, {
      ...extraParams,
      page,
      itemsInPage: pageSize,
    })) as { items?: unknown[] };
    const pageItems = data?.items ?? [];
    items.push(...pageItems);
    if (pageItems.length < pageSize) break;
  }
  return items;
}

// ────────────────────────────────────────────────────────────────
// Status / Priority Maps
// ────────────────────────────────────────────────────────────────

const STATUS_MAP: Record<number, string> = {
  1: "Open",
  2: "In Progress",
  3: "Resolved",
  4: "Closed",
  5: "Waiting for Customer",
  6: "Waiting for Third Party",
};

// ────────────────────────────────────────────────────────────────
// Tool 1: atera_endpoint_diagnostics
// ────────────────────────────────────────────────────────────────

type Agent = Record<string, unknown>;

function formatDiagnostics(agent: Agent, alerts: unknown[]): string {
  const lines: string[] = [];
  const name = (agent.MachineName ?? agent.AgentName ?? "Unknown") as string;
  const online = agent.Online === true;
  const lastSeen = agent.LastSeen ? new Date(agent.LastSeen as string).toLocaleString() : "?";

  lines.push(`## Endpoint Diagnostics: ${name}`);
  lines.push(`Status: ${online ? "🟢 Online" : "🔴 Offline"} | Last Seen: ${lastSeen}`);
  lines.push("");

  // ── Hardware Inventory
  lines.push("### Hardware");
  lines.push(`  Processor: ${agent.Processor ?? "Unknown"}`);
  lines.push(`  Cores: ${agent.ProcessorCoresCount ?? "?"}`);
  const memGB = agent.Memory ? Math.round((agent.Memory as number) / 1024) : "?";
  lines.push(`  Memory: ${memGB} GB`);
  lines.push(`  Vendor: ${agent.Vendor ?? "?"} | Model: ${agent.MachineModel ?? "?"}`);
  lines.push(`  Serial: ${agent.SerialNumber ?? "?"}`);

  // ── OS Info
  lines.push("");
  lines.push("### Operating System");
  lines.push(`  OS: ${agent.OS ?? agent.OSType ?? "Unknown"}`);
  lines.push(`  Version: ${agent.OSVersion ?? "?"} | Build: ${agent.OSBuildNumber ?? "?"}`);
  lines.push(`  Architecture: ${agent.OSArchitecture ?? "?"}`);
  lines.push(`  Domain: ${agent.DomainName ?? "?"}`);
  lines.push(`  Last Login: ${agent.LastLoginUser ?? agent.CurrentLoggedUsers ?? "?"}`);

  // ── Disk Info
  lines.push("");
  lines.push("### Storage");
  const disks = (agent.HardwareDisks ?? agent.Disks ?? []) as Record<string, unknown>[];
  if (Array.isArray(disks) && disks.length > 0) {
    for (const disk of disks) {
      const letter = disk.Drive ?? disk.Letter ?? "?";
      const totalGB = disk.Total ? Math.round((disk.Total as number) / (1024 * 1024 * 1024)) : 0;
      const freeGB = disk.Free ? Math.round((disk.Free as number) / (1024 * 1024 * 1024)) : 0;
      const usedPct = totalGB > 0 ? Math.round(((totalGB - freeGB) / totalGB) * 100) : 0;
      const warn = usedPct >= 90 ? " ⚠️ CRITICAL" : usedPct >= 80 ? " ⚠️ HIGH" : "";
      lines.push(`  ${letter}: ${freeGB}GB free / ${totalGB}GB total (${usedPct}% used)${warn}`);
    }
  } else {
    // Fallback to top-level disk fields
    const freeSpace = agent.FreeSpaceInGB ?? agent.FreeSpace;
    if (freeSpace != null) {
      lines.push(`  Free Space: ${freeSpace} GB`);
    } else {
      lines.push("  Disk data not available via API");
    }
  }

  // ── Network
  lines.push("");
  lines.push("### Network");
  const ips = (agent.IpAddresses ?? []) as string[];
  lines.push(`  IP Addresses: ${ips.length > 0 ? ips.join(", ") : "?"}`);
  lines.push(`  MAC Addresses: ${(agent.MacAddresses as string[])?.join(", ") ?? "?"}`);
  lines.push(`  External IP: ${agent.ReportedFromIP ?? "?"}`);

  // ── Agent Info
  lines.push("");
  lines.push("### Agent Info");
  lines.push(`  Agent ID: ${agent.AgentID ?? "?"}`);
  lines.push(`  Agent Version: ${agent.AgentVersion ?? "?"}`);
  lines.push(`  Customer: ${agent.CustomerName ?? agent.CustomerID ?? "?"}`);
  lines.push(`  Monitored: ${agent.Monitored ? "Yes" : "No"}`);
  const created = agent.CreatedOn ? new Date(agent.CreatedOn as string).toLocaleString() : "?";
  lines.push(`  Installed: ${created}`);

  // ── Active Alerts
  if (alerts.length > 0) {
    lines.push("");
    lines.push(`### Active Alerts (${alerts.length})`);
    for (const a of alerts as Record<string, unknown>[]) {
      const severity = a.Severity ?? a.AlertSeverity ?? "?";
      const title = a.Title ?? a.AlertMessage ?? "Untitled";
      const created = a.Created ? new Date(a.Created as string).toLocaleString() : "?";
      lines.push(`  ⚠ [${severity}] ${title} (${created})`);
    }
  } else {
    lines.push("");
    lines.push("### Alerts: None active ✓");
  }

  // ── Health Score
  lines.push("");
  lines.push("### Health Score");
  let score = 100;
  const issues: string[] = [];
  if (!online) {
    score -= 40;
    issues.push("Device offline (-40)");
  }
  if (alerts.length > 0) {
    score -= Math.min(alerts.length * 10, 30);
    issues.push(`${alerts.length} active alert(s) (-${Math.min(alerts.length * 10, 30)})`);
  }
  // Check disk if available
  if (Array.isArray(disks)) {
    for (const disk of disks) {
      const total = disk.Total as number;
      const free = disk.Free as number;
      if (total && free) {
        const usedPct = ((total - free) / total) * 100;
        if (usedPct >= 90) {
          score -= 20;
          issues.push(`Disk ${disk.Drive ?? "?"} at ${Math.round(usedPct)}% (-20)`);
        } else if (usedPct >= 80) {
          score -= 10;
          issues.push(`Disk ${disk.Drive ?? "?"} at ${Math.round(usedPct)}% (-10)`);
        }
      }
    }
  }
  score = Math.max(0, score);
  const grade = score >= 90 ? "A" : score >= 70 ? "B" : score >= 50 ? "C" : score >= 30 ? "D" : "F";
  lines.push(`  Score: ${score}/100 (Grade: ${grade})`);
  if (issues.length > 0) {
    issues.forEach((i) => lines.push(`  - ${i}`));
  }

  return lines.join("\n");
}

function textResult(text: string): AgentToolResult<unknown> {
  return { content: [{ type: "text" as const, text }] };
}

const diagnosticsActions: Record<string, MSPActionHandler<AteraToolConfig>> = {
  // Single device diagnostics
  async device(params, config) {
    const agentId = params.agent_id as number | undefined;
    const machineName = params.machine_name as string | undefined;

    if (!agentId && !machineName) {
      return textResult("Error: Provide agent_id or machine_name to run diagnostics.");
    }

    let agent: Agent;
    if (agentId) {
      agent = (await ateraGet(`/agents/${agentId}`, config)) as Agent;
    } else {
      const data = (await ateraGet(
        `/agents/machine/${encodeURIComponent(machineName!)}`,
        config,
      )) as { items?: Agent[] };
      const items = data?.items ?? ([data] as Agent[]);
      if (items.length === 0) return textResult(`No agent found with machine name: ${machineName}`);
      agent = items[0]!;
    }

    // Fetch alerts for this device
    const allAlerts = (await ateraGetAll("/alerts", config, undefined, 2)) as Record<
      string,
      unknown
    >[];
    const deviceAlerts = allAlerts.filter(
      (a) => a.DeviceName === agent.MachineName || a.AgentID === agent.AgentID,
    );

    return textResult(formatDiagnostics(agent, deviceAlerts));
  },

  // Customer-wide device health scan
  async customer_scan(params, config) {
    const customerId = params.customer_id as number | undefined;
    if (!customerId) return textResult("Error: customer_id is required for customer_scan.");

    const agents = (await ateraGetAll(`/agents/customer/${customerId}`, config)) as Agent[];
    const allAlerts = (await ateraGetAll("/alerts", config, undefined, 2)) as Record<
      string,
      unknown
    >[];

    if (agents.length === 0) return textResult(`No devices found for customer ${customerId}.`);

    const lines: string[] = [`## Customer Device Health Scan (${agents.length} devices)\n`];
    let onlineCount = 0;
    let offlineCount = 0;
    let criticalCount = 0;

    for (const agent of agents) {
      const online = agent.Online === true;
      if (online) onlineCount++;
      else offlineCount++;

      const name = (agent.MachineName ?? agent.AgentName ?? "?") as string;
      const deviceAlerts = allAlerts.filter(
        (a) => a.DeviceName === agent.MachineName || a.AgentID === agent.AgentID,
      );

      const status = online ? "🟢" : "🔴";
      const alertStr = deviceAlerts.length > 0 ? ` ⚠ ${deviceAlerts.length} alert(s)` : "";
      const os = (agent.OS ?? agent.OSType ?? "?") as string;
      const memGB = agent.Memory ? Math.round((agent.Memory as number) / 1024) : "?";
      const lastSeen = agent.LastSeen ? new Date(agent.LastSeen as string).toLocaleString() : "?";

      if (!online || deviceAlerts.length > 0) criticalCount++;

      lines.push(`${status} **${name}** — ${os} | ${memGB}GB RAM | Last: ${lastSeen}${alertStr}`);
    }

    lines.unshift(
      `Summary: ${onlineCount} online, ${offlineCount} offline, ${criticalCount} need attention\n`,
    );

    return textResult(lines.join("\n"));
  },

  // Fleet-wide health summary
  async fleet_health(params, config) {
    const agents = (await ateraGetAll("/agents", config, undefined, 5)) as Agent[];
    const allAlerts = (await ateraGetAll("/alerts", config, undefined, 2)) as Record<
      string,
      unknown
    >[];

    const lines: string[] = ["## Fleet Health Overview\n"];

    const online = agents.filter((a) => a.Online === true);
    const offline = agents.filter((a) => a.Online !== true);
    lines.push(`Total Devices: ${agents.length}`);
    lines.push(`Online: ${online.length} | Offline: ${offline.length}`);
    lines.push(`Active Alerts: ${allAlerts.length}`);
    lines.push("");

    // Group by customer
    const byCustomer = new Map<string, { total: number; online: number; alerts: number }>();
    for (const a of agents) {
      const cname = (a.CustomerName ?? "Unknown") as string;
      const entry = byCustomer.get(cname) ?? { total: 0, online: 0, alerts: 0 };
      entry.total++;
      if (a.Online === true) entry.online++;
      byCustomer.set(cname, entry);
    }
    for (const alert of allAlerts as Record<string, unknown>[]) {
      const cname = (alert.CustomerName ?? "Unknown") as string;
      const entry = byCustomer.get(cname);
      if (entry) entry.alerts++;
    }

    lines.push("### By Customer");
    const sorted = [...byCustomer.entries()].sort((a, b) => b[1].total - a[1].total);
    for (const [name, stats] of sorted) {
      const healthPct = stats.total > 0 ? Math.round((stats.online / stats.total) * 100) : 0;
      const alertStr = stats.alerts > 0 ? ` ⚠${stats.alerts}` : "";
      lines.push(`  ${name}: ${stats.online}/${stats.total} online (${healthPct}%)${alertStr}`);
    }

    // OS distribution
    lines.push("");
    lines.push("### OS Distribution");
    const osCounts = new Map<string, number>();
    for (const a of agents) {
      const os = (a.OS ?? a.OSType ?? "Unknown") as string;
      // Normalize to major version
      const normalized = os.replace(/\s+(Pro|Enterprise|Home|Standard|Datacenter)\b/gi, "").trim();
      osCounts.set(normalized, (osCounts.get(normalized) ?? 0) + 1);
    }
    const osSorted = [...osCounts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [os, count] of osSorted.slice(0, 10)) {
      lines.push(`  ${os}: ${count} device(s)`);
    }

    if (offline.length > 0) {
      lines.push("");
      lines.push(`### Offline Devices (${offline.length})`);
      for (const a of offline.slice(0, 15)) {
        const name = (a.MachineName ?? a.AgentName ?? "?") as string;
        const cname = (a.CustomerName ?? "?") as string;
        const lastSeen = a.LastSeen ? new Date(a.LastSeen as string).toLocaleString() : "?";
        lines.push(`  🔴 ${name} (${cname}) — Last seen: ${lastSeen}`);
      }
      if (offline.length > 15) lines.push(`  ... and ${offline.length - 15} more`);
    }

    return textResult(lines.join("\n"));
  },
};

// ────────────────────────────────────────────────────────────────
// Tool 2: atera_remote_action
// ────────────────────────────────────────────────────────────────

const remoteActions: Record<string, MSPActionHandler<AteraToolConfig>> = {
  // Create an alert on a device (API-safe)
  async create_alert(params, config) {
    const title = params.title as string;
    const severity = (params.severity as string) ?? "Warning";
    const deviceName = params.device_name as string;
    const customerId = params.customer_id as number;

    if (!title) return textResult("Error: title is required.");

    const body: Record<string, unknown> = {
      DeviceName: deviceName,
      Title: title,
      Severity: severity,
      AlertCategoryID: "General",
    };
    if (customerId) body.CustomerID = customerId;

    if (!rateLimiter.consume()) {
      return textResult("Rate limited. Wait a few seconds and try again.");
    }

    const result = await mspFetch({
      url: `${ATERA_BASE}/alerts`,
      service: "Atera",
      apiKey: config.apiKey,
      method: "POST",
      body,
      retryPolicy: ATERA_RETRY,
    });

    return textResult(
      `Alert created successfully.\n\nTitle: ${title}\nSeverity: ${severity}\nDevice: ${deviceName ?? "N/A"}`,
    );
  },

  // Dismiss/delete an alert
  async dismiss_alert(params, config) {
    const alertId = params.alert_id as number;
    if (!alertId) return textResult("Error: alert_id is required.");

    if (!rateLimiter.consume()) {
      return textResult("Rate limited. Wait a few seconds and try again.");
    }

    const url = `${ATERA_BASE}/alerts/${alertId}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: {
        Accept: "application/json",
        "X-API-KEY": config.apiKey,
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return textResult(
        `Failed to dismiss alert ${alertId}: ${res.status} ${res.statusText} — ${body.slice(0, 200)}`,
      );
    }

    return textResult(`Alert #${alertId} dismissed successfully.`);
  },

  // Set a custom field on an agent (useful for tracking state)
  async set_custom_field(params, config) {
    const agentId = params.agent_id as number;
    const fieldName = params.field_name as string;
    const value = params.value as string;

    if (!agentId || !fieldName || value === undefined) {
      return textResult("Error: agent_id, field_name, and value are required.");
    }

    if (!rateLimiter.consume()) {
      return textResult("Rate limited. Wait a few seconds and try again.");
    }

    await mspFetch({
      url: `${ATERA_BASE}/customvalues/agentfield/${agentId}/${encodeURIComponent(fieldName)}/${encodeURIComponent(value)}`,
      service: "Atera",
      apiKey: config.apiKey,
      method: "PUT",
      retryPolicy: ATERA_RETRY,
    });

    return textResult(`Custom field "${fieldName}" set to "${value}" on agent ${agentId}.`);
  },

  // Get custom field value for an agent
  async get_custom_field(params, config) {
    const agentId = params.agent_id as number;
    const fieldName = params.field_name as string;

    if (!agentId || !fieldName) {
      return textResult("Error: agent_id and field_name are required.");
    }

    const result = (await ateraGet(
      `/customvalues/agentfield/${agentId}/${encodeURIComponent(fieldName)}`,
      config,
    )) as Record<string, unknown>;

    return textResult(
      `Custom field "${fieldName}" for agent ${agentId}:\n  Value: ${JSON.stringify(result.ValueAsString ?? result.Value ?? result)}`,
    );
  },

  // Create a ticket linked to a device (diagnostic-triggered action)
  async create_diagnostic_ticket(params, config) {
    const agentId = params.agent_id as number;
    const title = params.title as string;
    const description = params.description as string;
    const customerId = params.customer_id as number;
    const priority = (params.priority as string) ?? "Medium";

    if (!title || !customerId) {
      return textResult("Error: title and customer_id are required.");
    }

    if (!rateLimiter.consume()) {
      return textResult("Rate limited. Wait a few seconds and try again.");
    }

    const body: Record<string, unknown> = {
      TicketTitle: title,
      Description:
        description ?? `Auto-generated diagnostic ticket for agent ${agentId ?? "unknown"}.`,
      CustomerID: customerId,
      TicketPriority: priority,
    };
    if (config.technicianId) body.TechnicianContactID = config.technicianId;

    const result = (await mspFetch({
      url: `${ATERA_BASE}/tickets`,
      service: "Atera",
      apiKey: config.apiKey,
      method: "POST",
      body,
      retryPolicy: ATERA_RETRY,
    })) as Record<string, unknown>;

    return textResult(
      `Diagnostic ticket created!\n\n` +
        `  ID: #${result.TicketID ?? "?"}\n` +
        `  Title: ${title}\n` +
        `  Customer: ${customerId}\n` +
        `  Priority: ${priority}\n` +
        `  Agent: ${agentId ?? "N/A"}`,
    );
  },

  // List available actions
  async list(_params) {
    return textResult(
      `## Available Remote Actions\n\n` +
        `  create_alert         — Create a monitoring alert on a device\n` +
        `  dismiss_alert        — Dismiss/delete an active alert\n` +
        `  set_custom_field     — Set a custom field on an agent\n` +
        `  get_custom_field     — Read a custom field from an agent\n` +
        `  create_diagnostic_ticket — Create a ticket linked to diagnostics\n\n` +
        `Note: Atera's REST API does not expose remote command execution (PowerShell/bash).\n` +
        `Remote scripts must be triggered via the Atera portal UI or Atera's IT automation engine.\n` +
        `These actions are the API-safe subset available for programmatic use.`,
    );
  },
};

// ────────────────────────────────────────────────────────────────
// Tool 3: atera_patch_status
// ────────────────────────────────────────────────────────────────

interface PatchPosture {
  totalDevices: number;
  osBreakdown: Map<string, number>;
  staleAgents: Agent[];
  offlineDevices: Agent[];
  complianceScore: number;
}

function computePatchPosture(agents: Agent[]): PatchPosture {
  const osBreakdown = new Map<string, number>();
  const staleAgents: Agent[] = [];
  const offlineDevices: Agent[] = [];
  const now = Date.now();
  const staleDays = 30; // Agent not seen in 30 days = stale

  for (const a of agents) {
    // OS tracking
    const os = (a.OS ?? a.OSType ?? "Unknown") as string;
    osBreakdown.set(os, (osBreakdown.get(os) ?? 0) + 1);

    // Stale detection
    if (a.LastSeen) {
      const lastSeen = new Date(a.LastSeen as string).getTime();
      const daysSince = (now - lastSeen) / (1000 * 60 * 60 * 24);
      if (daysSince > staleDays) staleAgents.push(a);
    }

    // Offline detection
    if (a.Online !== true) offlineDevices.push(a);
  }

  // Compliance score: 100 - penalties
  let score = 100;
  if (agents.length > 0) {
    const offlinePct = (offlineDevices.length / agents.length) * 100;
    const stalePct = (staleAgents.length / agents.length) * 100;
    score -= Math.min(offlinePct * 0.5, 30); // Offline penalty
    score -= Math.min(stalePct * 0.8, 40); // Stale penalty
  }

  return {
    totalDevices: agents.length,
    osBreakdown,
    staleAgents,
    offlineDevices,
    complianceScore: Math.max(0, Math.round(score)),
  };
}

const patchActions: Record<string, MSPActionHandler<AteraToolConfig>> = {
  // OS version inventory across fleet
  async os_inventory(_params, config) {
    const agents = (await ateraGetAll("/agents", config, undefined, 5)) as Agent[];
    const posture = computePatchPosture(agents);

    const lines: string[] = ["## OS Version Inventory\n"];
    lines.push(`Total Devices: ${posture.totalDevices}`);
    lines.push(`Compliance Score: ${posture.complianceScore}/100`);
    lines.push("");

    lines.push("### OS Distribution");
    const sorted = [...posture.osBreakdown.entries()].sort((a, b) => b[1] - a[1]);
    for (const [os, count] of sorted) {
      const pct = Math.round((count / posture.totalDevices) * 100);
      lines.push(`  ${os}: ${count} (${pct}%)`);
    }

    // Flag outdated OS versions
    lines.push("");
    lines.push("### Outdated OS Detection");
    const outdatedPatterns = [
      { pattern: /windows\s*(7|8|8\.1|xp|vista)/i, label: "End-of-life Windows" },
      { pattern: /windows\s*server\s*(2008|2012)/i, label: "End-of-life Windows Server" },
      { pattern: /ubuntu\s*(16|18)\./i, label: "Old Ubuntu LTS" },
      { pattern: /macos\s*(10\.(1[0-4])|mojave|catalina)/i, label: "Old macOS" },
    ];

    let outdatedCount = 0;
    for (const a of agents) {
      const os = (a.OS ?? "") as string;
      for (const check of outdatedPatterns) {
        if (check.pattern.test(os)) {
          outdatedCount++;
          lines.push(
            `  ⚠ ${a.MachineName ?? "?"} (${a.CustomerName ?? "?"}): ${os} — ${check.label}`,
          );
          break;
        }
      }
    }
    if (outdatedCount === 0) lines.push("  No outdated OS versions detected ✓");

    return textResult(lines.join("\n"));
  },

  // Stale agent detection
  async stale_agents(params, config) {
    const customerId = params.customer_id as number | undefined;
    const threshold = (params.threshold_days as number) ?? 30;

    const agents = customerId
      ? ((await ateraGetAll(`/agents/customer/${customerId}`, config)) as Agent[])
      : ((await ateraGetAll("/agents", config, undefined, 5)) as Agent[]);

    const now = Date.now();
    const stale = agents.filter((a) => {
      if (!a.LastSeen) return true;
      const daysSince = (now - new Date(a.LastSeen as string).getTime()) / (1000 * 60 * 60 * 24);
      return daysSince > threshold;
    });

    const lines: string[] = [`## Stale Agents (>${threshold} days since last seen)\n`];
    lines.push(`Total: ${stale.length} of ${agents.length} agents\n`);

    if (stale.length === 0) {
      lines.push("No stale agents detected ✓");
    } else {
      stale.sort((a, b) => {
        const aTime = a.LastSeen ? new Date(a.LastSeen as string).getTime() : 0;
        const bTime = b.LastSeen ? new Date(b.LastSeen as string).getTime() : 0;
        return aTime - bTime; // oldest first
      });

      for (const a of stale.slice(0, 25)) {
        const name = (a.MachineName ?? a.AgentName ?? "?") as string;
        const customer = (a.CustomerName ?? "?") as string;
        const lastSeen = a.LastSeen ? new Date(a.LastSeen as string).toLocaleString() : "Never";
        const daysSince = a.LastSeen
          ? Math.round((now - new Date(a.LastSeen as string).getTime()) / (1000 * 60 * 60 * 24))
          : "∞";
        lines.push(`  🔴 ${name} (${customer}) — Last seen: ${lastSeen} (${daysSince} days ago)`);
      }
      if (stale.length > 25) lines.push(`  ... and ${stale.length - 25} more`);
    }

    return textResult(lines.join("\n"));
  },

  // Customer patch posture report
  async customer_posture(params, config) {
    const customerId = params.customer_id as number;
    if (!customerId) return textResult("Error: customer_id is required.");

    const agents = (await ateraGetAll(`/agents/customer/${customerId}`, config)) as Agent[];
    if (agents.length === 0) return textResult(`No devices found for customer ${customerId}.`);

    const posture = computePatchPosture(agents);
    const customerName = (agents[0]?.CustomerName ?? `Customer ${customerId}`) as string;

    const lines: string[] = [`## Patch Posture: ${customerName}\n`];
    lines.push(`Total Devices: ${posture.totalDevices}`);
    lines.push(
      `Online: ${posture.totalDevices - posture.offlineDevices.length} | Offline: ${posture.offlineDevices.length}`,
    );
    lines.push(`Stale (>30 days): ${posture.staleAgents.length}`);

    const grade =
      posture.complianceScore >= 90
        ? "A"
        : posture.complianceScore >= 70
          ? "B"
          : posture.complianceScore >= 50
            ? "C"
            : posture.complianceScore >= 30
              ? "D"
              : "F";
    lines.push(`Compliance Score: ${posture.complianceScore}/100 (Grade: ${grade})`);
    lines.push("");

    lines.push("### OS Versions");
    for (const [os, count] of posture.osBreakdown.entries()) {
      lines.push(`  ${os}: ${count}`);
    }

    if (posture.offlineDevices.length > 0) {
      lines.push("");
      lines.push(`### Offline (${posture.offlineDevices.length})`);
      for (const a of posture.offlineDevices.slice(0, 10)) {
        const lastSeen = a.LastSeen ? new Date(a.LastSeen as string).toLocaleString() : "?";
        lines.push(`  🔴 ${a.MachineName ?? "?"} — Last: ${lastSeen}`);
      }
    }

    if (posture.staleAgents.length > 0) {
      lines.push("");
      lines.push(`### Stale Agents (${posture.staleAgents.length})`);
      for (const a of posture.staleAgents.slice(0, 10)) {
        const lastSeen = a.LastSeen ? new Date(a.LastSeen as string).toLocaleString() : "?";
        lines.push(`  ⚠ ${a.MachineName ?? "?"} — Last: ${lastSeen}`);
      }
    }

    return textResult(lines.join("\n"));
  },

  // Fleet-wide compliance dashboard
  async fleet_compliance(_params, config) {
    const agents = (await ateraGetAll("/agents", config, undefined, 5)) as Agent[];
    const posture = computePatchPosture(agents);

    // Per-customer breakdown
    const byCustomer = new Map<string, Agent[]>();
    for (const a of agents) {
      const cname = (a.CustomerName ?? "Unknown") as string;
      const list = byCustomer.get(cname) ?? [];
      list.push(a);
      byCustomer.set(cname, list);
    }

    const lines: string[] = ["## Fleet Patch Compliance Dashboard\n"];
    lines.push(`Total Devices: ${posture.totalDevices}`);
    lines.push(`Fleet Compliance: ${posture.complianceScore}/100`);
    lines.push(`Stale Agents: ${posture.staleAgents.length}`);
    lines.push(`Offline: ${posture.offlineDevices.length}`);
    lines.push("");

    lines.push("### Per-Customer Compliance");
    const customerScores: { name: string; score: number; total: number }[] = [];
    for (const [name, customerAgents] of byCustomer.entries()) {
      const cPosture = computePatchPosture(customerAgents);
      customerScores.push({ name, score: cPosture.complianceScore, total: customerAgents.length });
    }
    customerScores.sort((a, b) => a.score - b.score); // worst first
    for (const cs of customerScores) {
      const grade =
        cs.score >= 90
          ? "A"
          : cs.score >= 70
            ? "B"
            : cs.score >= 50
              ? "C"
              : cs.score >= 30
                ? "D"
                : "F";
      const bar =
        "█".repeat(Math.round(cs.score / 10)) + "░".repeat(10 - Math.round(cs.score / 10));
      lines.push(`  ${bar} ${cs.score}% (${grade}) — ${cs.name} (${cs.total} devices)`);
    }

    return textResult(lines.join("\n"));
  },
};

// ────────────────────────────────────────────────────────────────
// Tool Factory — Export all three tools
// ────────────────────────────────────────────────────────────────

export function createAteraEndpointDiagnosticsTool(): AnyAgentTool {
  return createMSPTool<AteraToolConfig>({
    name: "atera_endpoint_diagnostics",
    label: "Atera Endpoint Diagnostics",
    description: `Deep device health diagnostics from Atera RMM data.

Actions:
  device          — Full diagnostics for a single device (requires agent_id or machine_name)
  customer_scan   — Health scan of all devices for a customer (requires customer_id)
  fleet_health    — Fleet-wide health overview with OS distribution and offline tracking

Returns: hardware inventory, OS info, disk status, network info, alert correlation, health score.`,
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["device", "customer_scan", "fleet_health"],
          default: "device",
        },
        agent_id: { type: "number", description: "Atera agent ID" },
        machine_name: { type: "string", description: "Device machine name" },
        customer_id: { type: "number", description: "Customer ID for customer_scan" },
      },
    },
    resolveConfig: resolveAteraConfig,
    actions: diagnosticsActions,
    defaultAction: "device",
  });
}

export function createAteraRemoteActionTool(): AnyAgentTool {
  return createMSPTool<AteraToolConfig>({
    name: "atera_remote_action",
    label: "Atera Remote Action",
    description: `Dispatch API-safe remote actions on Atera-managed devices.

Actions:
  list                    — Show available actions
  create_alert            — Create a monitoring alert (title, severity, device_name)
  dismiss_alert           — Dismiss an alert by ID (alert_id)
  set_custom_field        — Set custom field on agent (agent_id, field_name, value)
  get_custom_field        — Read custom field from agent (agent_id, field_name)
  create_diagnostic_ticket — Create a ticket from diagnostics (title, customer_id)

Note: Atera REST API does not expose remote script execution. Use Atera portal for PowerShell/bash scripts.`,
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "list",
            "create_alert",
            "dismiss_alert",
            "set_custom_field",
            "get_custom_field",
            "create_diagnostic_ticket",
          ],
          default: "list",
        },
        agent_id: { type: "number" },
        alert_id: { type: "number" },
        title: { type: "string" },
        description: { type: "string" },
        severity: { type: "string", enum: ["Information", "Warning", "Critical"] },
        device_name: { type: "string" },
        customer_id: { type: "number" },
        field_name: { type: "string" },
        value: { type: "string" },
        priority: { type: "string", enum: ["Low", "Medium", "High", "Critical"] },
      },
    },
    resolveConfig: resolveAteraConfig,
    actions: remoteActions,
    defaultAction: "list",
  });
}

export function createAteraPatchStatusTool(): AnyAgentTool {
  return createMSPTool<AteraToolConfig>({
    name: "atera_patch_status",
    label: "Atera Patch Status",
    description: `Patch compliance and OS version tracking for Atera-managed fleet.

Actions:
  os_inventory      — OS version distribution across all devices
  stale_agents      — Find agents not seen in N days (default 30; optional customer_id, threshold_days)
  customer_posture  — Patch posture report for a customer (requires customer_id)
  fleet_compliance  — Fleet-wide compliance dashboard with per-customer grades

Returns: OS breakdown, outdated OS detection, stale agent lists, compliance scoring (0-100).`,
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["os_inventory", "stale_agents", "customer_posture", "fleet_compliance"],
          default: "os_inventory",
        },
        customer_id: { type: "number" },
        threshold_days: {
          type: "number",
          description: "Days threshold for stale detection (default: 30)",
        },
      },
    },
    resolveConfig: resolveAteraConfig,
    actions: patchActions,
    defaultAction: "os_inventory",
  });
}
