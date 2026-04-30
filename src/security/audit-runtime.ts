import type { ArgentConfig } from "../config/config.js";
import type { GatewayServiceRuntime } from "../daemon/service-runtime.js";
import type { GatewayProbeAuth, GatewayProbeResult } from "../gateway/probe.js";
import type { PortUsage } from "../infra/ports.js";
import { resolveGatewayPort } from "../config/config.js";
import {
  auditGatewayServiceConfig,
  SERVICE_AUDIT_CODES,
  type GatewayServiceCommand,
  type ServiceConfigIssue,
} from "../daemon/service-audit.js";
import { resolveGatewayService } from "../daemon/service.js";
import { buildGatewayConnectionDetails } from "../gateway/call.js";
import { probeGateway } from "../gateway/probe.js";
import { inspectPortUsage } from "../infra/ports.js";

export type RuntimeSecurityAuditSeverity = "info" | "warn" | "critical";

export type RuntimeSecurityAuditFinding = {
  checkId: string;
  severity: RuntimeSecurityAuditSeverity;
  title: string;
  detail: string;
  remediation?: string;
};

export type RuntimeAuditServiceReader = {
  label?: string;
  isLoaded: (args: { env?: Record<string, string | undefined> }) => Promise<boolean>;
  readCommand: (env: Record<string, string | undefined>) => Promise<GatewayServiceCommand>;
  readRuntime?: (
    env: Record<string, string | undefined>,
  ) => Promise<GatewayServiceRuntime | null | undefined>;
};

export type RuntimeAuditGatewayProbeResult = Pick<GatewayProbeResult, "ok" | "url" | "error"> & {
  close?: GatewayProbeResult["close"];
};

export type RuntimeSecurityAuditOptions = {
  config?: ArgentConfig;
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  service?: RuntimeAuditServiceReader | null;
  serviceLoaded?: boolean;
  serviceCommand?: GatewayServiceCommand;
  serviceRuntime?: GatewayServiceRuntime | null;
  portUsage?: PortUsage | null;
  gatewayProbeResult?: RuntimeAuditGatewayProbeResult | null;
  includeService?: boolean;
  includePort?: boolean;
  includeGatewayProbe?: boolean;
  deepTimeoutMs?: number;
  inspectPortUsageFn?: (port: number) => Promise<PortUsage>;
  probeGatewayFn?: (opts: {
    url: string;
    auth?: GatewayProbeAuth;
    timeoutMs: number;
  }) => Promise<GatewayProbeResult>;
};

type ServiceEvidence = {
  loaded: boolean | null;
  command: GatewayServiceCommand;
  runtime: GatewayServiceRuntime | null;
  label: string;
};

function issueCheckId(issue: ServiceConfigIssue): string {
  return `service.${issue.code.replaceAll("-", "_")}`;
}

function serviceIssueTitle(issue: ServiceConfigIssue): string {
  if (
    issue.code === SERVICE_AUDIT_CODES.gatewayRuntimeBun ||
    issue.code === SERVICE_AUDIT_CODES.gatewayRuntimeNodeVersionManager
  ) {
    return "Gateway service uses a brittle runtime";
  }
  if (issue.code === SERVICE_AUDIT_CODES.gatewayRuntimeNodeSystemMissing) {
    return "System Node runtime is missing";
  }
  return "Gateway service posture issue";
}

function serviceIssueToFinding(issue: ServiceConfigIssue): RuntimeSecurityAuditFinding {
  const detail = issue.detail ? `${issue.message} (${issue.detail})` : issue.message;
  return {
    checkId: issueCheckId(issue),
    severity: "warn",
    title: serviceIssueTitle(issue),
    detail,
    remediation: "Run argent doctor or reinstall the gateway service after fixing the runtime.",
  };
}

function parsePort(raw: unknown): number | null {
  if (raw === undefined || raw === null) {
    return null;
  }
  const value =
    typeof raw === "string"
      ? raw
      : typeof raw === "number" || typeof raw === "bigint"
        ? raw.toString()
        : null;
  if (value === null) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parsePortFromArgs(programArguments: string[] | undefined): number | null {
  if (!programArguments?.length) {
    return null;
  }
  for (let i = 0; i < programArguments.length; i += 1) {
    const arg = programArguments[i];
    if (arg === "--port") {
      const parsed = parsePort(programArguments[i + 1]);
      if (parsed) {
        return parsed;
      }
    }
    if (arg?.startsWith("--port=")) {
      const parsed = parsePort(arg.split("=", 2)[1]);
      if (parsed) {
        return parsed;
      }
    }
  }
  return null;
}

function mergeServiceEnv(
  env: Record<string, string | undefined>,
  command: GatewayServiceCommand,
): Record<string, string | undefined> {
  return {
    ...env,
    ...command?.environment,
  };
}

function resolveServicePort(params: {
  config?: ArgentConfig;
  env: Record<string, string | undefined>;
  command: GatewayServiceCommand;
}): number {
  const argPort = parsePortFromArgs(params.command?.programArguments);
  if (argPort) {
    return argPort;
  }
  return resolveGatewayPort(params.config, mergeServiceEnv(params.env, params.command));
}

function listenerSummary(portUsage: PortUsage): string {
  if (portUsage.listeners.length === 0) {
    return `port ${portUsage.port} status=${portUsage.status}`;
  }
  return portUsage.listeners
    .map((listener) => {
      const pid = listener.pid ? `pid=${listener.pid}` : "pid=?";
      const command = listener.commandLine ?? listener.command ?? "unknown command";
      const address = listener.address ? ` ${listener.address}` : "";
      return `${pid}${address} ${command}`;
    })
    .join("; ");
}

function listenerLooksLikeGateway(listener: PortUsage["listeners"][number]): boolean {
  const text = [listener.command, listener.commandLine].filter(Boolean).join(" ").toLowerCase();
  return (
    text.includes("argent") ||
    text.includes("argentos") ||
    text.includes("gateway") ||
    text.includes("clawdbot")
  );
}

async function readServiceEvidence(params: {
  env: Record<string, string | undefined>;
  service: RuntimeAuditServiceReader | null | undefined;
  serviceLoaded?: boolean;
  serviceCommand?: GatewayServiceCommand;
  serviceRuntime?: GatewayServiceRuntime | null;
  findings: RuntimeSecurityAuditFinding[];
}): Promise<ServiceEvidence> {
  let service = params.service;
  if (service === undefined) {
    try {
      service = resolveGatewayService();
    } catch (err) {
      params.findings.push({
        checkId: "service.inspect_unavailable",
        severity: "info",
        title: "Gateway service inspection is unavailable",
        detail: String(err),
      });
      service = null;
    }
  }

  let loaded = params.serviceLoaded ?? null;
  let command = params.serviceCommand ?? null;
  let runtime = params.serviceRuntime ?? null;
  const label = service?.label ?? "gateway service";

  if (service && loaded === null) {
    try {
      loaded = await service.isLoaded({ env: params.env });
    } catch (err) {
      params.findings.push({
        checkId: "service.loaded_status_unavailable",
        severity: "info",
        title: "Gateway service loaded status is unavailable",
        detail: String(err),
      });
    }
  }

  if (service && command === null) {
    try {
      command = await service.readCommand(params.env);
    } catch (err) {
      params.findings.push({
        checkId: "service.command_unavailable",
        severity: "warn",
        title: "Gateway service command is unavailable",
        detail: String(err),
      });
    }
  }

  if (service?.readRuntime && runtime === null) {
    try {
      runtime = (await service.readRuntime(params.env)) ?? null;
    } catch (err) {
      params.findings.push({
        checkId: "service.runtime_unavailable",
        severity: "info",
        title: "Gateway service runtime status is unavailable",
        detail: String(err),
      });
    }
  }

  return { loaded, command, runtime, label };
}

async function collectServiceFindings(params: {
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
  evidence: ServiceEvidence;
}): Promise<RuntimeSecurityAuditFinding[]> {
  const findings: RuntimeSecurityAuditFinding[] = [];
  if (params.evidence.loaded === false) {
    findings.push({
      checkId: "service.not_loaded",
      severity: "info",
      title: "Gateway service is not loaded",
      detail: `${params.evidence.label} is not installed, enabled, or loaded for this user.`,
    });
  }

  if (params.evidence.runtime?.status === "stopped") {
    findings.push({
      checkId: "service.runtime_stopped",
      severity: "warn",
      title: "Gateway service runtime is stopped",
      detail: params.evidence.runtime.detail ?? "Service runtime reported status=stopped.",
      remediation: "Restart the gateway service and re-run argent security audit --deep.",
    });
  } else if (params.evidence.runtime?.status === "unknown") {
    findings.push({
      checkId: "service.runtime_unknown",
      severity: "info",
      title: "Gateway service runtime status is unknown",
      detail: params.evidence.runtime.detail ?? "Service runtime status could not be determined.",
    });
  }

  if (!params.evidence.command) {
    return findings;
  }

  const audit = await auditGatewayServiceConfig({
    env: params.env,
    command: params.evidence.command,
    platform: params.platform,
  }).catch((err) => {
    findings.push({
      checkId: "service.config_audit_failed",
      severity: "warn",
      title: "Gateway service config audit failed",
      detail: String(err),
    });
    return null;
  });

  if (audit) {
    findings.push(...audit.issues.map(serviceIssueToFinding));
  }

  return findings;
}

function collectPortFindings(params: {
  config?: ArgentConfig;
  env: Record<string, string | undefined>;
  evidence: ServiceEvidence;
  portUsage: PortUsage;
}): RuntimeSecurityAuditFinding[] {
  const findings: RuntimeSecurityAuditFinding[] = [];
  const cliPort = resolveGatewayPort(params.config, params.env);
  const servicePort = resolveServicePort({
    config: params.config,
    env: params.env,
    command: params.evidence.command,
  });

  if (servicePort !== cliPort) {
    findings.push({
      checkId: "runtime.gateway_port_mismatch",
      severity: "warn",
      title: "Gateway service port differs from current config",
      detail: `Service resolves port ${servicePort}, but current config/env resolves port ${cliPort}.`,
      remediation: "Reinstall or restart the gateway service for the current config scope.",
    });
  }

  const runtimePid = params.evidence.runtime?.pid;
  const listenerPids = params.portUsage.listeners
    .map((listener) => listener.pid)
    .filter((pid): pid is number => typeof pid === "number" && Number.isFinite(pid));

  if (
    params.evidence.loaded === true &&
    params.evidence.runtime?.status === "running" &&
    params.portUsage.status !== "busy"
  ) {
    findings.push({
      checkId: "runtime.gateway_port_not_listening",
      severity: "warn",
      title: "Gateway service is running but the port is not listening",
      detail: `Expected gateway on port ${servicePort}; local port evidence: ${listenerSummary(params.portUsage)}.`,
      remediation: "Check the gateway service logs, then restart the service.",
    });
  }

  if (
    runtimePid &&
    listenerPids.length > 0 &&
    !listenerPids.includes(runtimePid) &&
    params.portUsage.status === "busy"
  ) {
    findings.push({
      checkId: "runtime.gateway_pid_mismatch",
      severity: "warn",
      title: "Gateway service PID does not own the gateway port",
      detail: `Service PID is ${runtimePid}, but port ${servicePort} is owned by ${listenerSummary(params.portUsage)}.`,
      remediation: "Stop the stale listener or restart the gateway service.",
    });
  } else if (
    params.portUsage.status === "busy" &&
    params.portUsage.listeners.length > 0 &&
    !params.portUsage.listeners.some(listenerLooksLikeGateway)
  ) {
    findings.push({
      checkId: "runtime.gateway_port_process_mismatch",
      severity: "warn",
      title: "Gateway port is owned by an unexpected process",
      detail: `Port ${servicePort} listener evidence: ${listenerSummary(params.portUsage)}.`,
      remediation:
        "Stop the unexpected process or configure Argent to use a different gateway port.",
    });
  }

  if (params.portUsage.status === "unknown") {
    findings.push({
      checkId: "runtime.gateway_port_unknown",
      severity: "info",
      title: "Gateway port ownership is unknown",
      detail:
        params.portUsage.errors?.join("; ") ??
        `Port ${servicePort} ownership could not be determined.`,
    });
  }

  return findings;
}

function resolveProbeAuth(params: {
  config?: ArgentConfig;
  env: Record<string, string | undefined>;
}): GatewayProbeAuth {
  const cfg = params.config;
  const isRemote = cfg?.gateway?.mode === "remote";
  const remoteUrl =
    typeof cfg?.gateway?.remote?.url === "string" && cfg.gateway.remote.url.trim().length > 0;
  const remote = isRemote && remoteUrl ? cfg?.gateway?.remote : undefined;
  const token =
    remote && typeof remote.token === "string" && remote.token.trim()
      ? remote.token.trim()
      : params.env.ARGENT_GATEWAY_TOKEN?.trim() ||
        (typeof cfg?.gateway?.auth?.token === "string" && cfg.gateway.auth.token.trim()
          ? cfg.gateway.auth.token.trim()
          : undefined);
  const password =
    params.env.ARGENT_GATEWAY_PASSWORD?.trim() ||
    (remote && typeof remote.password === "string" && remote.password.trim()
      ? remote.password.trim()
      : typeof cfg?.gateway?.auth?.password === "string" && cfg.gateway.auth.password.trim()
        ? cfg.gateway.auth.password.trim()
        : undefined);
  return { token, password };
}

async function resolveGatewayProbe(params: {
  config?: ArgentConfig;
  env: Record<string, string | undefined>;
  timeoutMs: number;
  probeGatewayFn: NonNullable<RuntimeSecurityAuditOptions["probeGatewayFn"]>;
}): Promise<RuntimeAuditGatewayProbeResult> {
  const connection = buildGatewayConnectionDetails({ config: params.config });
  const auth = resolveProbeAuth({ config: params.config, env: params.env });
  return params
    .probeGatewayFn({ url: connection.url, auth, timeoutMs: params.timeoutMs })
    .catch((err) => ({
      ok: false,
      url: connection.url,
      error: String(err),
      close: null,
    }));
}

function collectProbeFindings(
  probe: RuntimeAuditGatewayProbeResult,
): RuntimeSecurityAuditFinding[] {
  if (probe.ok) {
    return [];
  }
  const closeDetail = probe.close
    ? ` close=${probe.close.code}${probe.close.reason ? ` ${probe.close.reason}` : ""}`
    : "";
  return [
    {
      checkId: "runtime.gateway_unreachable",
      severity: "warn",
      title: "Gateway is unreachable during runtime audit",
      detail: `${probe.url}: ${probe.error ?? "gateway unreachable"}${closeDetail}`,
      remediation:
        "Check gateway service status, auth, and port ownership, then re-run the deep audit.",
    },
  ];
}

export async function collectRuntimeSecurityAuditFindings(
  options: RuntimeSecurityAuditOptions = {},
): Promise<RuntimeSecurityAuditFinding[]> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const findings: RuntimeSecurityAuditFinding[] = [];
  const includeService = options.includeService !== false;
  const includePort = options.includePort !== false;
  const evidence = includeService
    ? await readServiceEvidence({
        env,
        service: options.service,
        serviceLoaded: options.serviceLoaded,
        serviceCommand: options.serviceCommand,
        serviceRuntime: options.serviceRuntime,
        findings,
      })
    : {
        loaded: options.serviceLoaded ?? null,
        command: options.serviceCommand ?? null,
        runtime: options.serviceRuntime ?? null,
        label: "gateway service",
      };

  if (includeService) {
    findings.push(...(await collectServiceFindings({ env, platform, evidence })));
  }

  const servicePort = resolveServicePort({
    config: options.config,
    env,
    command: evidence.command,
  });
  const inspectPortUsageFn = options.inspectPortUsageFn ?? inspectPortUsage;
  const portUsage =
    options.portUsage ??
    (includePort
      ? await inspectPortUsageFn(servicePort).catch((err) => {
          findings.push({
            checkId: "runtime.gateway_port_inspect_failed",
            severity: "info",
            title: "Gateway port inspection failed",
            detail: String(err),
          });
          return null;
        })
      : null);

  if (includePort && portUsage) {
    findings.push(...collectPortFindings({ config: options.config, env, evidence, portUsage }));
  }

  let gatewayProbe = options.gatewayProbeResult ?? null;
  if (!gatewayProbe && options.includeGatewayProbe === true) {
    gatewayProbe = await resolveGatewayProbe({
      config: options.config,
      env,
      timeoutMs: Math.max(250, options.deepTimeoutMs ?? 5000),
      probeGatewayFn: options.probeGatewayFn ?? probeGateway,
    });
  }
  if (gatewayProbe) {
    findings.push(...collectProbeFindings(gatewayProbe));
  }

  return findings;
}
