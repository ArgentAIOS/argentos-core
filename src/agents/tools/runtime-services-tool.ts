import { Type } from "@sinclair/typebox";
import type { ArgentConfig } from "../../config/types.js";
import type { AnyAgentTool } from "./common.js";
import { loadConfig, resolveGatewayPort } from "../../config/config.js";
import {
  DEFAULT_CANVAS_HOST_PORT,
  deriveDefaultBrowserControlPort,
  deriveDefaultCanvasHostPort,
} from "../../config/port-defaults.js";
import { jsonResult, readStringParam } from "./common.js";

const RuntimeServicesToolSchema = Type.Object({
  service: Type.Optional(
    Type.String({
      description:
        "Optional service name or alias to resolve (for example: gateway, dashboard-api, browser-control, browser-relay, canvas-host). If omitted, list all runtime services.",
    }),
  ),
});

type RuntimeServiceRecord = {
  name: string;
  aliases: string[];
  purpose: string;
  port: number;
  healthCheck: string;
  transport: string;
  sourceOfTruth: string;
};

function resolveDashboardApiPort(): number {
  const raw = process.env.ARGENT_DASHBOARD_API?.trim();
  if (raw) {
    try {
      const parsed = new URL(raw);
      const explicitPort = parsed.port ? Number.parseInt(parsed.port, 10) : undefined;
      if (explicitPort && Number.isFinite(explicitPort) && explicitPort > 0) {
        return explicitPort;
      }
      if (parsed.protocol === "https:") {
        return 443;
      }
      if (parsed.protocol === "http:") {
        return 80;
      }
    } catch {
      // Ignore invalid env override and fall back to the canonical local default.
    }
  }
  return 9242;
}

function buildRuntimeServiceMap(cfg: ArgentConfig): RuntimeServiceRecord[] {
  const gatewayPort = resolveGatewayPort(cfg);
  const dashboardApiPort = resolveDashboardApiPort();
  const browserControlPort = deriveDefaultBrowserControlPort(gatewayPort);
  const browserRelayPort = browserControlPort + 1;
  const canvasHostPort = deriveDefaultCanvasHostPort(gatewayPort);

  return [
    {
      name: "gateway",
      aliases: ["gateway", "argent-gateway", "ws-gateway", "control-plane"],
      purpose:
        "Primary ArgentOS control plane for WebSocket RPC and HTTP-multiplexed gateway surfaces.",
      port: gatewayPort,
      healthCheck:
        'Use WebSocket RPC method "health" on the gateway itself; do not use dashboard-api /api/health for gateway status.',
      transport: "ws/http multiplex",
      sourceOfTruth: "resolveGatewayPort(config)",
    },
    {
      name: "dashboard-api",
      aliases: ["dashboard-api", "api", "local-api", "argent-api"],
      purpose: "Local dashboard API used by dashboard surfaces and proxy routes.",
      port: dashboardApiPort,
      healthCheck: "HTTP GET /api/health",
      transport: "http",
      sourceOfTruth: "ARGENT_DASHBOARD_API env or local default 9242",
    },
    {
      name: "browser-control",
      aliases: ["browser-control", "browser", "browser-server", "control"],
      purpose: "Browser control service for local browser orchestration.",
      port: browserControlPort,
      healthCheck:
        "Derived browser control port; validate service/process availability rather than assuming the gateway port.",
      transport: "http/ws",
      sourceOfTruth: "gateway.port + 2",
    },
    {
      name: "browser-relay",
      aliases: ["browser-relay", "relay", "extension-relay", "chrome-relay"],
      purpose: "Chrome extension relay for browser/CDP access.",
      port: browserRelayPort,
      healthCheck:
        "Relay endpoint on derived browser relay port; do not confuse with gateway or browser-control.",
      transport: "http/ws",
      sourceOfTruth: "browser-control port + 1",
    },
    {
      name: "canvas-host",
      aliases: ["canvas-host", "canvas", "a2ui", "canvas-server"],
      purpose: "Canvas/A2UI host service mounted off the gateway runtime.",
      port: canvasHostPort || DEFAULT_CANVAS_HOST_PORT,
      healthCheck:
        "Canvas host URL derived from gateway runtime; validate mounted canvas host rather than dashboard-api.",
      transport: "http/ws",
      sourceOfTruth: "gateway.port + 4",
    },
  ];
}

function normalizeServiceQuery(value: string | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : undefined;
}

function selectRuntimeService(
  services: RuntimeServiceRecord[],
  query: string | undefined,
): RuntimeServiceRecord | null {
  const normalized = normalizeServiceQuery(query);
  if (!normalized) {
    return null;
  }
  return (
    services.find(
      (service) =>
        service.name === normalized ||
        service.aliases.some((alias) => alias.toLowerCase() === normalized),
    ) ?? null
  );
}

function formatService(service: RuntimeServiceRecord): string {
  return [
    `${service.name}`,
    `  port: ${service.port}`,
    `  transport: ${service.transport}`,
    `  purpose: ${service.purpose}`,
    `  health check: ${service.healthCheck}`,
    `  source of truth: ${service.sourceOfTruth}`,
    `  aliases: ${service.aliases.join(", ")}`,
  ].join("\n");
}

function formatServiceList(services: RuntimeServiceRecord[]): string {
  return ["Runtime Service Map", "", ...services.map((service) => formatService(service))].join(
    "\n\n",
  );
}

export function createRuntimeServicesTool(opts?: { config?: ArgentConfig }): AnyAgentTool {
  return {
    label: "Runtime Services",
    name: "runtime_services",
    description:
      "Resolve canonical ArgentOS runtime service identities, ports, and health surfaces. Use this before verifying whether a service is healthy so you check the right target.",
    parameters: RuntimeServicesToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const cfg = opts?.config ?? loadConfig();
      const services = buildRuntimeServiceMap(cfg);
      const serviceQuery = readStringParam(params, "service");
      const selected = selectRuntimeService(services, serviceQuery);
      if (serviceQuery && !selected) {
        throw new Error(`Unknown runtime service "${serviceQuery}"`);
      }
      if (selected) {
        return jsonResult({
          ok: true,
          service: selected,
        });
      }
      return {
        content: [{ type: "text", text: formatServiceList(services) }],
        details: {
          ok: true,
          services,
        },
      };
    },
  };
}
