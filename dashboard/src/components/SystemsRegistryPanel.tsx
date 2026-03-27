import { KeyRound, RefreshCw, Wrench } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DashboardSurfaceProfile } from "../lib/configSurfaceProfile";
import {
  fetchConnectorSetupStatus,
  launchConnectorSetupAction,
  runConnectorSetupCheck,
  type ConnectorSetupStatus,
} from "../lib/connectorSetup";
import { ConnectorBuilderPanel } from "./ConnectorBuilderPanel";
import { ConnectorSetupCard } from "./ConnectorSetupCard";

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

export function SystemsRegistryPanel(props: SystemsRegistryPanelProps) {
  const { defaultAgentId, gatewayRequest, surfaceProfile, onOpenTab } = props;
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [connectors, setConnectors] = useState<ConnectorCatalogEntry[]>([]);
  const [tools, setTools] = useState<ToolStatusEntry[]>([]);
  const [toolAgentId, setToolAgentId] = useState(defaultAgentId || "main");
  const [toolQuery, setToolQuery] = useState("");
  const [connectorQuery, setConnectorQuery] = useState("");
  const [connectorSetupByTool, setConnectorSetupByTool] = useState<
    Record<string, ConnectorSetupStatus | null>
  >({});
  const [connectorSetupLoadingByTool, setConnectorSetupLoadingByTool] = useState<
    Record<string, boolean>
  >({});
  const [connectorSetupLaunchActionByTool, setConnectorSetupLaunchActionByTool] = useState<
    Record<string, string | null>
  >({});
  const [connectorSetupAutoRefreshUntilByTool, setConnectorSetupAutoRefreshUntilByTool] = useState<
    Record<string, number | null>
  >({});

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

  const loadConnectorSetupStatus = useCallback(
    async (
      tool: string,
      options: { manual?: boolean; installMissing?: boolean } = {},
    ): Promise<ConnectorSetupStatus | null> => {
      try {
        setConnectorSetupLoadingByTool((prev) => ({ ...prev, [tool]: true }));
        if (options.manual) {
          setMessage(null);
        }
        const payload = options.manual
          ? await runConnectorSetupCheck(tool, {
              installMissing: options.installMissing === true,
              requireAuth: true,
            })
          : await fetchConnectorSetupStatus(tool);
        setConnectorSetupByTool((prev) => ({ ...prev, [tool]: payload }));
        if (options.manual) {
          if (payload?.ok) {
            setConnectorSetupAutoRefreshUntilByTool((prev) => ({ ...prev, [tool]: null }));
            setMessage({
              type: "success",
              text: `${tool} is ready. Connector actions can now be granted to workers.`,
            });
          } else {
            setMessage({
              type: "error",
              text: payload?.summary || `${tool} still needs operator setup.`,
            });
          }
        }
        await loadRegistry();
        return payload;
      } catch (error) {
        if (options.manual) {
          setMessage({
            type: "error",
            text: error instanceof Error ? error.message : `Failed to check ${tool} setup.`,
          });
        }
        return null;
      } finally {
        setConnectorSetupLoadingByTool((prev) => ({ ...prev, [tool]: false }));
      }
    },
    [loadRegistry],
  );

  const launchConnectorSetup = useCallback(
    async (tool: string, action: string) => {
      try {
        setConnectorSetupLaunchActionByTool((prev) => ({ ...prev, [tool]: action }));
        setMessage(null);
        const payload = await launchConnectorSetupAction(tool, action);
        if (payload.watchForChanges) {
          setConnectorSetupAutoRefreshUntilByTool((prev) => ({
            ...prev,
            [tool]: Date.now() + 2 * 60 * 1000,
          }));
          globalThis.setTimeout(() => {
            void loadConnectorSetupStatus(tool, { manual: false, installMissing: false });
          }, 1500);
        }
        setMessage({
          type: "success",
          text: payload.watchForChanges
            ? `${payload.message || `Launched ${tool} setup action.`} Watching for readiness changes now.`
            : payload.message || `Launched ${tool} setup action.`,
        });
      } catch (error) {
        setMessage({
          type: "error",
          text: error instanceof Error ? error.message : `Failed to launch ${tool} setup action.`,
        });
      } finally {
        setConnectorSetupLaunchActionByTool((prev) => ({ ...prev, [tool]: null }));
      }
    },
    [loadConnectorSetupStatus],
  );

  useEffect(() => {
    const activeTools = Object.entries(connectorSetupAutoRefreshUntilByTool)
      .filter(([, until]) => typeof until === "number" && until > Date.now())
      .map(([tool]) => tool);
    if (activeTools.length === 0) return;
    const interval = globalThis.setInterval(() => {
      const now = Date.now();
      for (const tool of activeTools) {
        const until = connectorSetupAutoRefreshUntilByTool[tool];
        if (!until || now >= until) {
          setConnectorSetupAutoRefreshUntilByTool((prev) => ({ ...prev, [tool]: null }));
          continue;
        }
        if (!connectorSetupLoadingByTool[tool]) {
          void loadConnectorSetupStatus(tool, { manual: false, installMissing: false });
        }
      }
    }, 5000);
    return () => globalThis.clearInterval(interval);
  }, [connectorSetupAutoRefreshUntilByTool, connectorSetupLoadingByTool, loadConnectorSetupStatus]);

  useEffect(() => {
    for (const connector of connectors) {
      if (
        connector.installState === "ready" ||
        Object.prototype.hasOwnProperty.call(connectorSetupByTool, connector.tool)
      ) {
        continue;
      }
      void loadConnectorSetupStatus(connector.tool, { manual: false, installMissing: false });
    }
  }, [connectorSetupByTool, connectors, loadConnectorSetupStatus]);

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
                const connectorSetup = Object.prototype.hasOwnProperty.call(
                  connectorSetupByTool,
                  connector.tool,
                )
                  ? connectorSetupByTool[connector.tool]
                  : undefined;
                const connectorSetupLoading = connectorSetupLoadingByTool[connector.tool] === true;
                const connectorSetupLaunchAction =
                  connectorSetupLaunchActionByTool[connector.tool] ?? null;
                const connectorSetupAutoRefreshUntil =
                  connectorSetupAutoRefreshUntilByTool[connector.tool];
                const connectorSetupAutoRefreshing =
                  typeof connectorSetupAutoRefreshUntil === "number" &&
                  connectorSetupAutoRefreshUntil > Date.now();
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

                    {connector.installState !== "ready" ? (
                      <ConnectorSetupCard
                        connector={connector}
                        setupStatus={connectorSetup}
                        loading={connectorSetupLoading}
                        launchingAction={connectorSetupLaunchAction}
                        autoRefreshing={connectorSetupAutoRefreshing}
                        disabled={isPublicCoreSurface}
                        onOpenApiKeys={() => onOpenTab?.("apikeys")}
                        onCheck={(installMissing) =>
                          void loadConnectorSetupStatus(connector.tool, {
                            manual: true,
                            installMissing,
                          })
                        }
                        onLaunch={(action) => void launchConnectorSetup(connector.tool, action)}
                      />
                    ) : null}
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
