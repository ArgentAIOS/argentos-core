import { AlertTriangle, CheckCircle, KeyRound, Package, RefreshCw, Wrench } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DashboardSurfaceProfile } from "../lib/configSurfaceProfile";
import { ConnectorBuilderPanel } from "./ConnectorBuilderPanel";

type GatewayRequestFn = <T = unknown>(
  method: string,
  params?: Record<string, unknown>,
) => Promise<T>;

type ConnectorCatalogCommand = {
  id: string;
  summary?: string;
  requiredMode?: string;
  supportsJson?: boolean;
  resource?: string;
  actionClass?: string;
};

type ConnectorCatalogEntry = {
  tool: string;
  label: string;
  description?: string;
  backend?: string;
  version?: string;
  manifestSchemaVersion?: string;
  category?: string;
  categories: string[];
  resources: string[];
  modes: string[];
  commands: ConnectorCatalogCommand[];
  installState: "ready" | "needs-setup" | "repo-only" | "error";
  status: {
    ok: boolean;
    label: string;
    detail?: string;
  };
  discovery?: {
    binaryPath?: string;
    repoDir?: string;
    harnessDir?: string;
    requiresPython?: string;
    sources?: Array<"path" | "repo">;
  };
  auth?: {
    kind?: string;
    required?: boolean;
    serviceKeys?: string[];
    interactiveSetup?: string[];
  };
};

type ConnectorCatalogResponse = {
  total?: number;
  connectors?: ConnectorCatalogEntry[];
};

type ToolStatusEntry = {
  name: string;
  label?: string;
  description?: string;
  source: "core" | "plugin" | "connector";
  pluginId?: string;
  optional?: boolean;
  connectorTool?: string;
  connectorCommandId?: string;
  governance?: {
    mode?: "allow" | "ask";
    approvalBacked?: boolean;
    source?: "global" | "department" | "agent";
    note?: string;
  };
};

type ToolStatusResponse = {
  agentId?: string;
  total?: number;
  tools?: ToolStatusEntry[];
};

type AosGooglePreflightCheck = {
  name: string;
  ok: boolean;
  details?: Record<string, unknown>;
};

type AosGooglePreflightResponse = {
  ok?: boolean;
  error?: string;
  details?: string;
  next_steps?: string[];
  checks?: AosGooglePreflightCheck[];
};

type AosGoogleLaunchResponse = {
  ok?: boolean;
  action?: string;
  message?: string;
  error?: string;
  details?: string;
  path?: string;
  url?: string;
  command?: string;
  cwd?: string;
};

type SystemsRegistryPanelProps = {
  defaultAgentId: string;
  gatewayRequest?: GatewayRequestFn;
  surfaceProfile: DashboardSurfaceProfile;
  onOpenTab?: (tabId: "apikeys" | "capabilities") => void;
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function statusChipClasses(state: ConnectorCatalogEntry["installState"]) {
  switch (state) {
    case "ready":
      return "border-emerald-500/20 bg-emerald-500/10 text-emerald-300";
    case "needs-setup":
      return "border-amber-500/20 bg-amber-500/10 text-amber-200";
    case "repo-only":
      return "border-cyan-500/20 bg-cyan-500/10 text-cyan-200";
    default:
      return "border-red-500/20 bg-red-500/10 text-red-300";
  }
}

function toolSourceChipClasses(source: ToolStatusEntry["source"]) {
  switch (source) {
    case "connector":
      return "border-cyan-500/20 bg-cyan-500/10 text-cyan-200";
    case "plugin":
      return "border-fuchsia-500/20 bg-fuchsia-500/10 text-fuchsia-200";
    default:
      return "border-white/10 bg-white/5 text-white/70";
  }
}

function formatGoogleCheckLabel(name: string): string {
  switch (name) {
    case "gws_binary":
      return "Google Workspace CLI installed";
    case "gws_version":
      return "Google Workspace CLI responds";
    case "gcloud_cli":
      return "Google Cloud SDK available";
    case "oauth_client_config":
      return "OAuth client configured";
    case "gws_auth":
      return "Google account login completed";
    case "model_armor_config":
      return "Model Armor sanitize defaults";
    default:
      return name.replace(/_/g, " ");
  }
}

function isOptionalGoogleCheck(name: string): boolean {
  return name === "gcloud_cli" || name === "model_armor_config";
}

function summarizeGoogleCheck(check: AosGooglePreflightCheck): string {
  const details = check.details ?? {};
  switch (check.name) {
    case "gws_binary":
      return typeof details.resolved_path === "string" && details.resolved_path
        ? `Resolved at ${details.resolved_path}`
        : "Install with npm install -g @googleworkspace/cli";
    case "gws_version":
      return typeof details.stdout === "string" && details.stdout
        ? details.stdout
        : "Version check did not return output.";
    case "gcloud_cli":
      return typeof details.resolved_path === "string" && details.resolved_path
        ? `Resolved at ${details.resolved_path}`
        : "Needed only for guided OAuth client setup via gws auth setup --login.";
    case "oauth_client_config":
      if (details.client_secret_present === true) {
        return `Using client_secret.json at ${String(details.client_secret_path || "")}`;
      }
      if (details.env_client_id_present === true && details.env_client_secret_present === true) {
        return "Using GOOGLE_WORKSPACE_CLI_CLIENT_ID and GOOGLE_WORKSPACE_CLI_CLIENT_SECRET.";
      }
      return "Missing OAuth client. Configure via gws auth setup --login, client_secret.json, or env vars.";
    case "gws_auth": {
      const status = details.status;
      if (status && typeof status === "object") {
        const typed = status as Record<string, unknown>;
        const email = typeof typed.email === "string" ? typed.email : "";
        if (email) return `Authenticated as ${email}`;
      }
      if (typeof details.stderr === "string" && details.stderr) {
        return details.stderr;
      }
      return "Run gws auth login after the OAuth client is configured.";
    }
    case "model_armor_config":
      return details.sanitize_template_configured === true
        ? "Sanitize-by-default is configured."
        : "Optional. Only needed if you want sanitize-by-default behavior.";
    default:
      return "";
  }
}

export function SystemsRegistryPanel(props: SystemsRegistryPanelProps) {
  const { defaultAgentId, gatewayRequest, surfaceProfile, onOpenTab } = props;
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [connectors, setConnectors] = useState<ConnectorCatalogEntry[]>([]);
  const [tools, setTools] = useState<ToolStatusEntry[]>([]);
  const [toolAgentId, setToolAgentId] = useState(defaultAgentId || "main");
  const [toolQuery, setToolQuery] = useState("");
  const [connectorQuery, setConnectorQuery] = useState("");
  const [aosGoogleLoading, setAosGoogleLoading] = useState(false);
  const [aosGoogleLaunchAction, setAosGoogleLaunchAction] = useState<string | null>(null);
  const [aosGoogleAutoRefreshUntil, setAosGoogleAutoRefreshUntil] = useState<number | null>(null);
  const [aosGooglePreflight, setAosGooglePreflight] = useState<AosGooglePreflightResponse | null>(
    null,
  );

  const loadRegistry = useCallback(async () => {
    if (!gatewayRequest) {
      setMessage({
        type: "error",
        text: "Gateway is not connected. Systems registry needs the live gateway session.",
      });
      return;
    }
    try {
      setLoading(true);
      setMessage(null);
      const targetAgentId = toolAgentId.trim() || defaultAgentId.trim() || "main";
      const [connectorsPayload, toolsPayload] = await Promise.all([
        gatewayRequest<ConnectorCatalogResponse>("connectors.catalog"),
        gatewayRequest<ToolStatusResponse>("tools.status", { agentId: targetAgentId }),
      ]);
      setConnectors(
        Array.isArray(connectorsPayload?.connectors) ? connectorsPayload.connectors : [],
      );
      setTools(Array.isArray(toolsPayload?.tools) ? toolsPayload.tools : []);
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to load systems registry.",
      });
    } finally {
      setLoading(false);
    }
  }, [defaultAgentId, gatewayRequest, toolAgentId]);

  useEffect(() => {
    void loadRegistry();
  }, [loadRegistry]);

  const runAosGooglePreflight = useCallback(
    async (installMissing: boolean) => {
      try {
        setAosGoogleLoading(true);
        setMessage(null);
        const response = await fetch("/api/settings/aos-google/preflight", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ installMissing, requireAuth: true }),
        });
        const payload = (await response.json().catch(() => ({}))) as AosGooglePreflightResponse;
        setAosGooglePreflight(payload);
        if (payload.ok === true) {
          setAosGoogleAutoRefreshUntil(null);
          setMessage({
            type: "success",
            text: "aos-google is ready. Connector actions can now be granted to workers.",
          });
        } else {
          setMessage({
            type: "error",
            text: payload.error || payload.details || "aos-google still needs operator setup.",
          });
        }
        await loadRegistry();
      } catch (error) {
        setMessage({
          type: "error",
          text: error instanceof Error ? error.message : "Failed to run aos-google setup.",
        });
      } finally {
        setAosGoogleLoading(false);
      }
    },
    [loadRegistry],
  );

  const launchAosGoogleAction = useCallback(
    async (action: string) => {
      try {
        setAosGoogleLaunchAction(action);
        setMessage(null);
        const response = await fetch("/api/settings/aos-google/launch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        const payload = (await response.json().catch(() => ({}))) as AosGoogleLaunchResponse;
        if (!response.ok || payload.ok === false) {
          throw new Error(payload.details || payload.error || `HTTP ${response.status}`);
        }
        const shouldWatch = action === "launch-auth-setup" || action === "launch-auth-login";
        if (shouldWatch) {
          setAosGoogleAutoRefreshUntil(Date.now() + 2 * 60 * 1000);
          globalThis.setTimeout(() => {
            void runAosGooglePreflight(false);
          }, 1500);
        }
        setMessage({
          type: "success",
          text: shouldWatch
            ? `${payload.message || "Launched Google Workspace setup action."} Watching for readiness changes now.`
            : payload.message ||
              "Launched local Google Workspace setup action. Finish the flow, then click Check setup.",
        });
      } catch (error) {
        setMessage({
          type: "error",
          text:
            error instanceof Error
              ? error.message
              : "Failed to launch Google Workspace setup action.",
        });
      } finally {
        setAosGoogleLaunchAction(null);
      }
    },
    [runAosGooglePreflight],
  );

  useEffect(() => {
    if (!aosGoogleAutoRefreshUntil) return;
    const interval = globalThis.setInterval(() => {
      if (Date.now() >= aosGoogleAutoRefreshUntil) {
        setAosGoogleAutoRefreshUntil(null);
        return;
      }
      if (!aosGoogleLoading) {
        void runAosGooglePreflight(false);
      }
    }, 5000);
    return () => globalThis.clearInterval(interval);
  }, [aosGoogleAutoRefreshUntil, aosGoogleLoading, runAosGooglePreflight]);

  const filteredConnectors = useMemo(() => {
    const query = connectorQuery.trim().toLowerCase();
    if (!query) return connectors;
    return connectors.filter((entry) => {
      const haystack = [
        entry.tool,
        entry.label,
        entry.description,
        entry.backend,
        ...(entry.categories ?? []),
        ...(entry.resources ?? []),
        ...(entry.commands ?? []).map((command) => command.id),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [connectorQuery, connectors]);

  const filteredTools = useMemo(() => {
    const query = toolQuery.trim().toLowerCase();
    if (!query) return tools;
    return tools.filter((tool) => {
      const haystack = [
        tool.name,
        tool.label,
        tool.description,
        tool.pluginId,
        tool.connectorTool,
        tool.connectorCommandId,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [toolQuery, tools]);

  const connectorCounts = useMemo(() => {
    const summary = {
      total: connectors.length,
      ready: 0,
      needsSetup: 0,
      repoOnly: 0,
      error: 0,
    };
    for (const connector of connectors) {
      if (connector.installState === "ready") summary.ready += 1;
      else if (connector.installState === "needs-setup") summary.needsSetup += 1;
      else if (connector.installState === "repo-only") summary.repoOnly += 1;
      else summary.error += 1;
    }
    return summary;
  }, [connectors]);

  const toolCounts = useMemo(() => {
    const summary = { total: tools.length, core: 0, plugin: 0, connector: 0 };
    for (const tool of tools) {
      if (tool.source === "plugin") summary.plugin += 1;
      else if (tool.source === "connector") summary.connector += 1;
      else summary.core += 1;
    }
    return summary;
  }, [tools]);

  const isPublicCoreSurface = surfaceProfile === "public-core";
  const aosGoogleChecks = useMemo(() => {
    const checks = new Map<string, AosGooglePreflightCheck>();
    for (const check of aosGooglePreflight?.checks ?? []) {
      checks.set(check.name, check);
    }
    return checks;
  }, [aosGooglePreflight]);
  const aosGoogleAutoRefreshing = aosGoogleAutoRefreshUntil !== null;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-white font-medium">Systems Registry</div>
            <div className="text-white/50 text-sm max-w-3xl">
              This is the operator-facing surface for installed connectors, runtime tools, and setup
              state. Use it to understand what is available, what still needs auth or install work,
              and what the agent can actually call today.
            </div>
          </div>
          <button
            onClick={() => void loadRegistry()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-gray-900/40 px-3 py-2 text-sm text-white/80 hover:bg-gray-900/60 disabled:opacity-50"
          >
            <RefreshCw className={cx("w-4 h-4", loading && "animate-spin")} />
            {loading ? "Refreshing..." : "Refresh registry"}
          </button>
        </div>

        {message && (
          <div
            className={cx(
              "rounded-lg border px-3 py-2 text-sm",
              message.type === "success"
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
                : "border-red-500/20 bg-red-500/10 text-red-200",
            )}
          >
            {message.text}
          </div>
        )}

        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <div className="rounded-lg border border-white/10 bg-gray-900/30 px-3 py-3">
            <div className="text-white/40 text-xs">Connectors</div>
            <div className="mt-1 text-white text-lg font-medium">{connectorCounts.total}</div>
            <div className="text-white/35 text-[11px]">
              {connectorCounts.ready} ready · {connectorCounts.needsSetup} need setup
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-gray-900/30 px-3 py-3">
            <div className="text-white/40 text-xs">Runtime Tools</div>
            <div className="mt-1 text-white text-lg font-medium">{toolCounts.total}</div>
            <div className="text-white/35 text-[11px]">
              {toolCounts.connector} connector · {toolCounts.plugin} plugin
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-gray-900/30 px-3 py-3">
            <div className="text-white/40 text-xs">Current Surface</div>
            <div className="mt-1 text-white text-lg font-medium capitalize">{surfaceProfile}</div>
            <div className="text-white/35 text-[11px]">
              Setup actions may be restricted in Public Core.
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-gray-900/30 px-3 py-3">
            <div className="text-white/40 text-xs">Tool Scope</div>
            <div className="mt-1 text-white text-lg font-medium">
              {toolAgentId || defaultAgentId || "main"}
            </div>
            <div className="text-white/35 text-[11px]">Runtime view for one agent at a time.</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3 xl:col-span-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-white/90 font-medium">Connectors</div>
              <div className="text-white/45 text-xs">
                Connectors are external systems like Google Workspace, QuickBooks, Slack, or
                internal APIs. Once runnable, their actions become real tools automatically.
              </div>
            </div>
            <input
              value={connectorQuery}
              onChange={(event) => setConnectorQuery(event.target.value)}
              placeholder="Filter connectors"
              className="w-full sm:w-64 rounded-lg border border-white/10 bg-gray-900/40 px-3 py-2 text-sm text-white/85 focus:outline-none focus:border-cyan-500/40"
            />
          </div>

          <div className="space-y-3 max-h-[36rem] overflow-auto pr-1">
            {filteredConnectors.length === 0 ? (
              <div className="rounded-lg border border-dashed border-white/10 bg-black/10 px-4 py-6 text-sm text-white/45">
                No connectors match this filter.
              </div>
            ) : (
              filteredConnectors.map((connector) => {
                const isGoogle = connector.tool === "aos-google";
                const googleGwsInstalled = aosGoogleChecks.get("gws_binary")?.ok === true;
                const googleGcloudAvailable = aosGoogleChecks.get("gcloud_cli")?.ok === true;
                const googleOauthConfigured =
                  aosGoogleChecks.get("oauth_client_config")?.ok === true;
                const googleAuthReady = aosGoogleChecks.get("gws_auth")?.ok === true;
                return (
                  <div
                    key={connector.tool}
                    className="rounded-lg border border-white/10 bg-gray-900/30 p-4 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-white/90 font-medium">{connector.label}</span>
                          <span
                            className={cx(
                              "rounded-full border px-2 py-0.5 text-[11px]",
                              statusChipClasses(connector.installState),
                            )}
                          >
                            {connector.status.label}
                          </span>
                          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-white/45">
                            {connector.tool}
                          </span>
                        </div>
                        {connector.description && (
                          <div className="text-white/50 text-xs max-w-3xl">
                            {connector.description}
                          </div>
                        )}
                      </div>
                      {isGoogle && (
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            onClick={() => void runAosGooglePreflight(false)}
                            disabled={aosGoogleLoading || isPublicCoreSurface}
                            className="inline-flex items-center gap-2 rounded-lg border border-fuchsia-500/20 bg-fuchsia-500/10 px-3 py-2 text-xs text-fuchsia-200 hover:bg-fuchsia-500/15 disabled:opacity-50"
                          >
                            <Wrench className="w-3.5 h-3.5" />
                            {aosGoogleLoading ? "Checking..." : "Check setup"}
                          </button>
                          <button
                            onClick={() => void runAosGooglePreflight(true)}
                            disabled={aosGoogleLoading || isPublicCoreSurface}
                            className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10 disabled:opacity-50"
                          >
                            <Package className="w-3.5 h-3.5" />
                            {aosGoogleLoading ? "Checking..." : "Install gws"}
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px] text-white/50">
                      <div>
                        <div className="text-white/35 uppercase tracking-wide">Capabilities</div>
                        <div className="mt-1 text-white/75">
                          {(connector.commands ?? []).length} commands ·{" "}
                          {(connector.resources ?? []).length} resources
                        </div>
                        <div>
                          {(connector.categories ?? []).join(", ") ||
                            connector.category ||
                            "uncategorized"}
                        </div>
                      </div>
                      <div>
                        <div className="text-white/35 uppercase tracking-wide">Auth</div>
                        <div className="mt-1 text-white/75">
                          {connector.auth?.required
                            ? connector.auth.kind || "required"
                            : "not declared"}
                        </div>
                        <div>
                          {connector.auth?.serviceKeys?.length
                            ? `Keys: ${connector.auth.serviceKeys.join(", ")}`
                            : connector.auth?.interactiveSetup?.length
                              ? `Interactive: ${connector.auth.interactiveSetup.join(", ")}`
                              : "No service keys declared"}
                        </div>
                      </div>
                      <div>
                        <div className="text-white/35 uppercase tracking-wide">Runtime</div>
                        <div className="mt-1 text-white/75">
                          {connector.status.detail || "No detail"}
                        </div>
                        <div>
                          {connector.discovery?.binaryPath
                            ? `Binary: ${connector.discovery.binaryPath}`
                            : connector.discovery?.harnessDir
                              ? `Harness: ${connector.discovery.harnessDir}`
                              : connector.discovery?.repoDir
                                ? `Repo: ${connector.discovery.repoDir}`
                                : "No install path yet"}
                        </div>
                      </div>
                    </div>

                    {isGoogle && aosGooglePreflight && (
                      <div className="rounded-lg border border-white/10 bg-black/10 px-3 py-3 space-y-2 text-xs text-white/70">
                        <div className="flex items-center gap-2">
                          {aosGooglePreflight.ok ? (
                            <CheckCircle className="w-4 h-4 text-emerald-400" />
                          ) : (
                            <AlertTriangle className="w-4 h-4 text-amber-400" />
                          )}
                          <span>
                            {aosGooglePreflight.ok
                              ? "aos-google passed readiness checks"
                              : "aos-google still needs operator action"}
                          </span>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-white/60">
                          Dashboard setup currently handles dependency install and readiness checks.
                          OAuth client setup and Google login may still require terminal steps until
                          the connector flow is fully in-product.
                        </div>
                        <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-3 space-y-2">
                          <div className="text-white/80 font-medium">Guided Setup</div>
                          <div className="text-white/45">
                            Use these actions in order. Each one opens the exact local path or
                            terminal command needed.
                          </div>
                          {aosGoogleAutoRefreshing && (
                            <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-[11px] text-cyan-100">
                              Watching for Google setup changes. Finish the browser or terminal
                              flow, then this card will re-check automatically for up to two
                              minutes.
                            </div>
                          )}
                          <div className="flex items-center gap-2 flex-wrap">
                            <button
                              onClick={() => void launchAosGoogleAction("open-config-folder")}
                              disabled={isPublicCoreSurface || aosGoogleLaunchAction !== null}
                              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-gray-900/40 px-3 py-2 text-xs text-white/80 hover:bg-gray-900/60 disabled:opacity-50"
                            >
                              <Package className="w-3.5 h-3.5" />
                              {aosGoogleLaunchAction === "open-config-folder"
                                ? "Opening..."
                                : "Open config folder"}
                            </button>
                            {!googleGcloudAvailable && (
                              <button
                                onClick={() =>
                                  void launchAosGoogleAction("open-gcloud-install-docs")
                                }
                                disabled={isPublicCoreSurface || aosGoogleLaunchAction !== null}
                                className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-gray-900/40 px-3 py-2 text-xs text-white/80 hover:bg-gray-900/60 disabled:opacity-50"
                              >
                                <Wrench className="w-3.5 h-3.5" />
                                {aosGoogleLaunchAction === "open-gcloud-install-docs"
                                  ? "Opening..."
                                  : "Open gcloud install docs"}
                              </button>
                            )}
                            {googleGwsInstalled &&
                              !googleOauthConfigured &&
                              googleGcloudAvailable && (
                                <button
                                  onClick={() => void launchAosGoogleAction("launch-auth-setup")}
                                  disabled={isPublicCoreSurface || aosGoogleLaunchAction !== null}
                                  className="inline-flex items-center gap-2 rounded-lg border border-fuchsia-500/20 bg-fuchsia-500/10 px-3 py-2 text-xs text-fuchsia-200 hover:bg-fuchsia-500/15 disabled:opacity-50"
                                >
                                  <Wrench className="w-3.5 h-3.5" />
                                  {aosGoogleLaunchAction === "launch-auth-setup"
                                    ? "Launching..."
                                    : "Run gws auth setup"}
                                </button>
                              )}
                            {googleGwsInstalled && googleOauthConfigured && !googleAuthReady && (
                              <button
                                onClick={() => void launchAosGoogleAction("launch-auth-login")}
                                disabled={isPublicCoreSurface || aosGoogleLaunchAction !== null}
                                className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200 hover:bg-emerald-500/15 disabled:opacity-50"
                              >
                                <CheckCircle className="w-3.5 h-3.5" />
                                {aosGoogleLaunchAction === "launch-auth-login"
                                  ? "Launching..."
                                  : "Run gws auth login"}
                              </button>
                            )}
                          </div>
                          <div className="text-[11px] text-white/45 space-y-1">
                            <div>
                              Config folder: <code className="text-cyan-300">~/.config/gws</code>
                            </div>
                            {!googleOauthConfigured && (
                              <div>
                                OAuth client can come from{" "}
                                <code className="text-cyan-300">client_secret.json</code> or env
                                vars{" "}
                                <code className="text-cyan-300">
                                  GOOGLE_WORKSPACE_CLI_CLIENT_ID
                                </code>{" "}
                                and{" "}
                                <code className="text-cyan-300">
                                  GOOGLE_WORKSPACE_CLI_CLIENT_SECRET
                                </code>
                                .
                              </div>
                            )}
                            {googleOauthConfigured && !googleAuthReady && (
                              <div>
                                OAuth client is configured. Finish browser login, then come back and
                                click <span className="text-white/75">Check setup</span>.
                              </div>
                            )}
                          </div>
                        </div>
                        {Array.isArray(aosGooglePreflight.checks) &&
                          aosGooglePreflight.checks.length > 0 && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                              {aosGooglePreflight.checks.map((check) => (
                                <div
                                  key={check.name}
                                  className="rounded border border-white/10 bg-white/5 px-2 py-1.5"
                                >
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span
                                      className={
                                        check.ok
                                          ? "text-emerald-300"
                                          : isOptionalGoogleCheck(check.name)
                                            ? "text-sky-200"
                                            : "text-amber-200"
                                      }
                                    >
                                      {check.ok
                                        ? "PASS"
                                        : isOptionalGoogleCheck(check.name)
                                          ? "OPTIONAL"
                                          : "WAIT"}
                                    </span>
                                    <span className="text-white/85">
                                      {formatGoogleCheckLabel(check.name)}
                                    </span>
                                    {isOptionalGoogleCheck(check.name) && (
                                      <span className="rounded-full border border-white/10 bg-black/10 px-1.5 py-0.5 text-[10px] text-white/40">
                                        optional
                                      </span>
                                    )}
                                  </div>
                                  <div className="mt-1 text-white/45">
                                    {summarizeGoogleCheck(check)}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        {Array.isArray(aosGooglePreflight.next_steps) &&
                          aosGooglePreflight.next_steps.length > 0 && (
                            <div className="space-y-1">
                              <div className="text-white/45 uppercase tracking-wide text-[10px]">
                                Next steps
                              </div>
                              {aosGooglePreflight.next_steps.map((step) => (
                                <div key={step}>• {step}</div>
                              ))}
                            </div>
                          )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
            <div className="text-white/90 font-medium">Operator Actions</div>
            <div className="text-white/50 text-xs">
              Setup lives here. Access policy still lives in Capabilities, and secrets still live in
              API Keys.
            </div>
            <div className="space-y-2">
              <button
                onClick={() => onOpenTab?.("apikeys")}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-gray-900/40 px-3 py-2 text-sm text-white/80 hover:bg-gray-900/60"
              >
                <KeyRound className="w-4 h-4" />
                Open API Keys
              </button>
              <button
                onClick={() => onOpenTab?.("capabilities")}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-gray-900/40 px-3 py-2 text-sm text-white/80 hover:bg-gray-900/60"
              >
                <Wrench className="w-4 h-4" />
                Open Capabilities
              </button>
            </div>
            {isPublicCoreSurface && (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                Public Core hides higher-trust setup paths. Inspect status here, but do install and
                admin setup in the full surface.
              </div>
            )}
          </div>

          <ConnectorBuilderPanel
            disabled={isPublicCoreSurface}
            onBuilt={() => {
              void loadRegistry();
            }}
          />
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-white/90 font-medium">Runtime Tools</div>
            <div className="text-white/45 text-xs">
              This shows the actual callable tool surface for one agent after connectors, plugins,
              and governance are resolved.
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              value={toolAgentId}
              onChange={(event) => setToolAgentId(event.target.value)}
              placeholder="Agent ID"
              className="w-32 rounded-lg border border-white/10 bg-gray-900/40 px-3 py-2 text-sm text-white/85 focus:outline-none focus:border-cyan-500/40"
            />
            <input
              value={toolQuery}
              onChange={(event) => setToolQuery(event.target.value)}
              placeholder="Filter tools"
              className="w-48 rounded-lg border border-white/10 bg-gray-900/40 px-3 py-2 text-sm text-white/85 focus:outline-none focus:border-cyan-500/40"
            />
            <button
              onClick={() => void loadRegistry()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-gray-900/40 px-3 py-2 text-sm text-white/80 hover:bg-gray-900/60 disabled:opacity-50"
            >
              <RefreshCw className={cx("w-4 h-4", loading && "animate-spin")} />
              Reload
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-white/60">
          <div className="rounded-lg border border-white/10 bg-gray-900/30 px-3 py-2">
            Core: {toolCounts.core}
          </div>
          <div className="rounded-lg border border-white/10 bg-gray-900/30 px-3 py-2">
            Plugin: {toolCounts.plugin}
          </div>
          <div className="rounded-lg border border-white/10 bg-gray-900/30 px-3 py-2">
            Connector: {toolCounts.connector}
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-gray-900/30 max-h-[32rem] overflow-auto divide-y divide-white/5">
          {filteredTools.length === 0 ? (
            <div className="px-4 py-6 text-sm text-white/45">No tools match this filter.</div>
          ) : (
            filteredTools.map((tool) => (
              <div key={tool.name} className="px-4 py-3 space-y-1.5">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span className="text-white/85 font-medium break-all">{tool.name}</span>
                    <span
                      className={cx(
                        "rounded-full border px-2 py-0.5 text-[11px]",
                        toolSourceChipClasses(tool.source),
                      )}
                    >
                      {tool.source}
                    </span>
                    {tool.governance?.mode === "ask" && (
                      <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-200">
                        approval
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-white/35">
                    {tool.connectorTool && tool.connectorCommandId
                      ? `${tool.connectorTool} → ${tool.connectorCommandId}`
                      : tool.pluginId
                        ? `plugin: ${tool.pluginId}`
                        : "core tool"}
                  </div>
                </div>
                {(tool.label || tool.description) && (
                  <div className="text-white/50 text-xs">
                    {tool.label && tool.label !== tool.name ? `${tool.label} — ` : ""}
                    {tool.description || "No description"}
                  </div>
                )}
                {tool.governance?.note && (
                  <div className="text-[11px] text-white/35">{tool.governance.note}</div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
