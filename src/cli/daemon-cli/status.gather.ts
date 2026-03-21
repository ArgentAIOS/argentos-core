import type { GatewayBindMode, GatewayControlUiConfig } from "../../config/types.js";
import type { FindExtraGatewayServicesOptions } from "../../daemon/inspect.js";
import type { ServiceConfigAudit } from "../../daemon/service-audit.js";
import type { GatewayRpcOpts } from "./types.js";
import {
  createConfigIO,
  resolveConfigPath,
  resolveGatewayPort,
  resolveStateDir,
} from "../../config/config.js";
import { readLastGatewayErrorLine } from "../../daemon/diagnostics.js";
import { findExtraGatewayServices } from "../../daemon/inspect.js";
import { auditGatewayServiceConfig } from "../../daemon/service-audit.js";
import { resolveGatewayService } from "../../daemon/service.js";
import { resolveGatewayBindHost } from "../../gateway/net.js";
import {
  formatPortDiagnostics,
  inspectPortUsage,
  type PortListener,
  type PortUsageStatus,
} from "../../infra/ports.js";
import { pickPrimaryTailnetIPv4 } from "../../infra/tailnet.js";
import { probeGatewayStatus } from "./probe.js";
import { normalizeListenerAddress, parsePortFromArgs, pickProbeHostForBind } from "./shared.js";

type ConfigSummary = {
  path: string;
  exists: boolean;
  valid: boolean;
  gatewayAuthMode?: "token" | "password" | null;
  gatewayAuthTokenConfigured?: boolean;
  gatewayAuthPasswordConfigured?: boolean;
  issues?: Array<{ path: string; message: string }>;
  controlUi?: GatewayControlUiConfig;
};

type GatewayStatusSummary = {
  bindMode: GatewayBindMode;
  bindHost: string;
  customBindHost?: string;
  port: number;
  portSource: "service args" | "env/config";
  probeUrl: string;
  probeNote?: string;
};

export type DaemonStatus = {
  service: {
    label: string;
    loaded: boolean;
    loadedText: string;
    notLoadedText: string;
    command?: {
      programArguments: string[];
      workingDirectory?: string;
      environment?: Record<string, string>;
      sourcePath?: string;
    } | null;
    runtime?: {
      status?: string;
      state?: string;
      subState?: string;
      pid?: number;
      lastExitStatus?: number;
      lastExitReason?: string;
      lastRunResult?: string;
      lastRunTime?: string;
      detail?: string;
      cachedLabel?: boolean;
      missingUnit?: boolean;
    };
    configAudit?: ServiceConfigAudit;
  };
  config?: {
    cli: ConfigSummary;
    daemon?: ConfigSummary;
    mismatch?: boolean;
  };
  gateway?: GatewayStatusSummary;
  port?: {
    port: number;
    status: PortUsageStatus;
    listeners: PortListener[];
    hints: string[];
  };
  portCli?: {
    port: number;
    status: PortUsageStatus;
    listeners: PortListener[];
    hints: string[];
  };
  lastError?: string;
  rpc?: {
    ok: boolean;
    error?: string;
    url?: string;
    diagnosis?:
      | "gateway-down-or-crashed"
      | "auth-misconfiguration"
      | "token-mismatch-unauthorized"
      | "rpc-unreachable";
    diagnosisMessage?: string;
  };
  extraServices: Array<{ label: string; detail: string; scope: string }>;
};

function resolveAuthMisconfiguration(config?: ConfigSummary): string | null {
  if (!config) {
    return null;
  }
  if (config.gatewayAuthMode === "token" && config.gatewayAuthTokenConfigured !== true) {
    return 'gateway.auth.mode is "token" but gateway.auth.token is empty.';
  }
  if (config.gatewayAuthMode === "password" && config.gatewayAuthPasswordConfigured !== true) {
    return 'gateway.auth.mode is "password" but gateway.auth.password is empty.';
  }
  return null;
}

export function resolveRpcDiagnosis(params: {
  rpcError?: string;
  serviceLoaded: boolean;
  runtimeStatus?: string;
  portBusy?: boolean;
  authMisconfiguration: string | null;
}): Pick<NonNullable<DaemonStatus["rpc"]>, "diagnosis" | "diagnosisMessage"> {
  if (params.authMisconfiguration) {
    return {
      diagnosis: "auth-misconfiguration",
      diagnosisMessage: `${params.authMisconfiguration} Fix config and retry restart.`,
    };
  }

  const err = String(params.rpcError ?? "").toLowerCase();
  if (
    err.includes("unauthorized") &&
    (err.includes("token mismatch") || err.includes("mismatch"))
  ) {
    return {
      diagnosis: "token-mismatch-unauthorized",
      diagnosisMessage:
        "Token mismatch unauthorized. Ensure client token matches gateway.auth.token.",
    };
  }

  if (
    params.serviceLoaded &&
    (params.runtimeStatus === "stopped" ||
      (params.runtimeStatus === "running" && params.portBusy === false))
  ) {
    return {
      diagnosis: "gateway-down-or-crashed",
      diagnosisMessage:
        "Gateway service is loaded but down/crashed (not accepting RPC connections).",
    };
  }

  return {
    diagnosis: "rpc-unreachable",
    diagnosisMessage: "Gateway RPC is unreachable.",
  };
}

function shouldReportPortUsage(status: PortUsageStatus | undefined, rpcOk?: boolean) {
  if (status !== "busy") {
    return false;
  }
  if (rpcOk === true) {
    return false;
  }
  return true;
}

export async function gatherDaemonStatus(
  opts: {
    rpc: GatewayRpcOpts;
    probe: boolean;
    deep?: boolean;
  } & FindExtraGatewayServicesOptions,
): Promise<DaemonStatus> {
  const service = resolveGatewayService();
  const [loaded, command, runtime] = await Promise.all([
    service.isLoaded({ env: process.env }).catch(() => false),
    service.readCommand(process.env).catch(() => null),
    service.readRuntime(process.env).catch((err) => ({ status: "unknown", detail: String(err) })),
  ]);
  const configAudit = await auditGatewayServiceConfig({
    env: process.env,
    command,
  });

  const serviceEnv = command?.environment ?? undefined;
  const mergedDaemonEnv = {
    ...(process.env as Record<string, string | undefined>),
    ...(serviceEnv ?? undefined),
  } satisfies Record<string, string | undefined>;

  const cliConfigPath = resolveConfigPath(process.env, resolveStateDir(process.env));
  const daemonConfigPath = resolveConfigPath(
    mergedDaemonEnv as NodeJS.ProcessEnv,
    resolveStateDir(mergedDaemonEnv as NodeJS.ProcessEnv),
  );

  const cliIO = createConfigIO({ env: process.env, configPath: cliConfigPath });
  const daemonIO = createConfigIO({
    env: mergedDaemonEnv,
    configPath: daemonConfigPath,
  });

  const [cliSnapshot, daemonSnapshot] = await Promise.all([
    cliIO.readConfigFileSnapshot().catch(() => null),
    daemonIO.readConfigFileSnapshot().catch(() => null),
  ]);
  const cliCfg = cliIO.loadConfig();
  const daemonCfg = daemonIO.loadConfig();

  const cliConfigSummary: ConfigSummary = {
    path: cliSnapshot?.path ?? cliConfigPath,
    exists: cliSnapshot?.exists ?? false,
    valid: cliSnapshot?.valid ?? true,
    ...(cliSnapshot?.issues?.length ? { issues: cliSnapshot.issues } : {}),
    controlUi: cliCfg.gateway?.controlUi,
    gatewayAuthMode:
      cliCfg.gateway?.auth?.mode === "token" || cliCfg.gateway?.auth?.mode === "password"
        ? cliCfg.gateway.auth.mode
        : null,
    gatewayAuthTokenConfigured:
      typeof cliCfg.gateway?.auth?.token === "string" &&
      cliCfg.gateway.auth.token.trim().length > 0,
    gatewayAuthPasswordConfigured:
      typeof cliCfg.gateway?.auth?.password === "string" &&
      cliCfg.gateway.auth.password.trim().length > 0,
  };
  const daemonConfigSummary: ConfigSummary = {
    path: daemonSnapshot?.path ?? daemonConfigPath,
    exists: daemonSnapshot?.exists ?? false,
    valid: daemonSnapshot?.valid ?? true,
    ...(daemonSnapshot?.issues?.length ? { issues: daemonSnapshot.issues } : {}),
    controlUi: daemonCfg.gateway?.controlUi,
    gatewayAuthMode:
      daemonCfg.gateway?.auth?.mode === "token" || daemonCfg.gateway?.auth?.mode === "password"
        ? daemonCfg.gateway.auth.mode
        : null,
    gatewayAuthTokenConfigured:
      typeof daemonCfg.gateway?.auth?.token === "string" &&
      daemonCfg.gateway.auth.token.trim().length > 0,
    gatewayAuthPasswordConfigured:
      typeof daemonCfg.gateway?.auth?.password === "string" &&
      daemonCfg.gateway.auth.password.trim().length > 0,
  };
  const configMismatch = cliConfigSummary.path !== daemonConfigSummary.path;

  const portFromArgs = parsePortFromArgs(command?.programArguments);
  const daemonPort = portFromArgs ?? resolveGatewayPort(daemonCfg, mergedDaemonEnv);
  const portSource: GatewayStatusSummary["portSource"] = portFromArgs
    ? "service args"
    : "env/config";

  const bindMode = (daemonCfg.gateway?.bind ?? "loopback") as
    | "auto"
    | "lan"
    | "loopback"
    | "custom"
    | "tailnet";
  const customBindHost = daemonCfg.gateway?.customBindHost;
  const bindHost = await resolveGatewayBindHost(bindMode, customBindHost);
  const tailnetIPv4 = pickPrimaryTailnetIPv4();
  const probeHost = pickProbeHostForBind(bindMode, tailnetIPv4, customBindHost);
  const probeUrlOverride =
    typeof opts.rpc.url === "string" && opts.rpc.url.trim().length > 0 ? opts.rpc.url.trim() : null;
  const probeUrl = probeUrlOverride ?? `ws://${probeHost}:${daemonPort}`;
  const probeNote =
    !probeUrlOverride && bindMode === "lan"
      ? "Local probe uses loopback (127.0.0.1). bind=lan listens on 0.0.0.0 (all interfaces); use a LAN IP for remote clients."
      : !probeUrlOverride && bindMode === "loopback"
        ? "Loopback-only gateway; only local clients can connect."
        : undefined;

  const cliPort = resolveGatewayPort(cliCfg, process.env);
  const [portDiagnostics, portCliDiagnostics] = await Promise.all([
    inspectPortUsage(daemonPort).catch(() => null),
    cliPort !== daemonPort ? inspectPortUsage(cliPort).catch(() => null) : null,
  ]);
  const portStatus: DaemonStatus["port"] | undefined = portDiagnostics
    ? {
        port: portDiagnostics.port,
        status: portDiagnostics.status,
        listeners: portDiagnostics.listeners,
        hints: portDiagnostics.hints,
      }
    : undefined;
  const portCliStatus: DaemonStatus["portCli"] | undefined = portCliDiagnostics
    ? {
        port: portCliDiagnostics.port,
        status: portCliDiagnostics.status,
        listeners: portCliDiagnostics.listeners,
        hints: portCliDiagnostics.hints,
      }
    : undefined;

  const extraServices = await findExtraGatewayServices(
    process.env as Record<string, string | undefined>,
    { deep: Boolean(opts.deep) },
  ).catch(() => []);

  const timeoutMsRaw = Number.parseInt(String(opts.rpc.timeout ?? "10000"), 10);
  const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? timeoutMsRaw : 10_000;

  const rpc = opts.probe
    ? await probeGatewayStatus({
        url: probeUrl,
        token:
          opts.rpc.token || mergedDaemonEnv.ARGENT_GATEWAY_TOKEN || daemonCfg.gateway?.auth?.token,
        password:
          opts.rpc.password ||
          mergedDaemonEnv.ARGENT_GATEWAY_PASSWORD ||
          daemonCfg.gateway?.auth?.password,
        timeoutMs,
        json: opts.rpc.json,
        configPath: daemonConfigSummary.path,
      })
    : undefined;

  const authMisconfiguration = resolveAuthMisconfiguration(daemonConfigSummary);

  let lastError: string | undefined;
  if (loaded && runtime?.status === "running" && portStatus && portStatus.status !== "busy") {
    lastError = (await readLastGatewayErrorLine(mergedDaemonEnv as NodeJS.ProcessEnv)) ?? undefined;
  }

  return {
    service: {
      label: service.label,
      loaded,
      loadedText: service.loadedText,
      notLoadedText: service.notLoadedText,
      command,
      runtime,
      configAudit,
    },
    config: {
      cli: cliConfigSummary,
      daemon: daemonConfigSummary,
      ...(configMismatch ? { mismatch: true } : {}),
    },
    gateway: {
      bindMode,
      bindHost,
      customBindHost,
      port: daemonPort,
      portSource,
      probeUrl,
      ...(probeNote ? { probeNote } : {}),
    },
    port: portStatus,
    ...(portCliStatus ? { portCli: portCliStatus } : {}),
    lastError,
    ...(rpc && !rpc.ok
      ? {
          rpc: {
            ...rpc,
            url: probeUrl,
            ...resolveRpcDiagnosis({
              rpcError: rpc.error,
              serviceLoaded: loaded,
              runtimeStatus: runtime?.status,
              portBusy: portStatus?.status === "busy",
              authMisconfiguration,
            }),
          },
        }
      : rpc
        ? { rpc: { ...rpc, url: probeUrl } }
        : {}),
    extraServices,
  };
}

export function renderPortDiagnosticsForCli(status: DaemonStatus, rpcOk?: boolean): string[] {
  if (!status.port || !shouldReportPortUsage(status.port.status, rpcOk)) {
    return [];
  }
  return formatPortDiagnostics({
    port: status.port.port,
    status: status.port.status,
    listeners: status.port.listeners,
    hints: status.port.hints,
  });
}

export function resolvePortListeningAddresses(status: DaemonStatus): string[] {
  const addrs = Array.from(
    new Set(
      status.port?.listeners
        ?.map((l) => (l.address ? normalizeListenerAddress(l.address) : ""))
        .filter((v): v is string => Boolean(v)) ?? [],
    ),
  );
  return addrs;
}
