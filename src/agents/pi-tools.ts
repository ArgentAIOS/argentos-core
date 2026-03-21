import type { ArgentConfig } from "../config/config.js";
import type { ModelAuthMode } from "./model-auth.js";
import type { AnyAgentTool } from "./pi-tools.types.js";
import type { SandboxContext } from "./sandbox.js";
import {
  codingTools,
  createEditTool,
  createReadTool,
  createWriteTool,
  readTool,
} from "../agent-core/coding.js";
import { emitAgentEvent } from "../infra/agent-events.js";
import { logWarn } from "../logger.js";
import { getPluginToolMeta } from "../plugins/tools.js";
import { isSubagentSessionKey } from "../routing/session-key.js";
import { resolveGatewayMessageChannel } from "../utils/message-channel.js";
import { createApplyPatchTool } from "./apply-patch.js";
import { createArgentTools } from "./argent-tools.js";
import {
  createExecTool,
  createProcessTool,
  type ExecToolDefaults,
  type ProcessToolDefaults,
} from "./bash-tools.js";
import { listChannelAgentTools } from "./channel-tools.js";
import { wrapToolWithAbortSignal } from "./pi-tools.abort.js";
import { wrapToolWithBeforeToolCallHook } from "./pi-tools.before-tool-call.js";
import { wrapToolWithLoopDetection } from "./pi-tools.loop-detect.js";
import {
  filterToolsByPolicy,
  isToolMatchedByPolicyList,
  isToolAllowedByPolicies,
  resolveEffectiveToolPolicy,
  resolveGroupToolPolicy,
  resolveSubagentToolPolicy,
} from "./pi-tools.policy.js";
import {
  assertRequiredParams,
  CLAUDE_PARAM_GROUPS,
  createArgentReadTool,
  createSandboxedEditTool,
  createSandboxedReadTool,
  createSandboxedWriteTool,
  normalizeToolParams,
  patchToolSchemaForClaudeCompatibility,
  wrapToolParamNormalization,
} from "./pi-tools.read.js";
import { cleanToolSchemaForGemini, normalizeToolParameters } from "./pi-tools.schema.js";
import { wrapToolWithApprovalPolicy } from "./tool-approval.js";
import { ToolLoopDetector } from "./tool-loop-detector.js";
import {
  applyOwnerOnlyToolPolicy,
  buildPluginToolGroups,
  collectExplicitAllowlist,
  expandPolicyWithPluginGroups,
  normalizeToolName,
  resolveToolProfilePolicy,
  stripPluginOnlyAllowlist,
} from "./tool-policy.js";
import {
  CORE_TOOL_NAMES,
  SUBSYSTEM_CORE_TOOLS,
  ToolSearchRegistry,
  detectSubsystem,
  type BackgroundSubsystem,
} from "./tool-search-registry.js";

function isOpenAIProvider(provider?: string) {
  const normalized = provider?.trim().toLowerCase();
  return normalized === "openai" || normalized === "openai-codex";
}

function isApplyPatchAllowedForModel(params: {
  modelProvider?: string;
  modelId?: string;
  allowModels?: string[];
}) {
  const allowModels = Array.isArray(params.allowModels) ? params.allowModels : [];
  if (allowModels.length === 0) {
    return true;
  }
  const modelId = params.modelId?.trim();
  if (!modelId) {
    return false;
  }
  const normalizedModelId = modelId.toLowerCase();
  const provider = params.modelProvider?.trim().toLowerCase();
  const normalizedFull =
    provider && !normalizedModelId.includes("/")
      ? `${provider}/${normalizedModelId}`
      : normalizedModelId;
  return allowModels.some((entry) => {
    const normalized = entry.trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    return normalized === normalizedModelId || normalized === normalizedFull;
  });
}

function resolveExecConfig(cfg: ArgentConfig | undefined) {
  const globalExec = cfg?.tools?.exec;
  return {
    host: globalExec?.host,
    security: globalExec?.security,
    ask: globalExec?.ask,
    node: globalExec?.node,
    pathPrepend: globalExec?.pathPrepend,
    safeBins: globalExec?.safeBins,
    backgroundMs: globalExec?.backgroundMs,
    timeoutSec: globalExec?.timeoutSec,
    approvalRunningNoticeMs: globalExec?.approvalRunningNoticeMs,
    cleanupMs: globalExec?.cleanupMs,
    notifyOnExit: globalExec?.notifyOnExit,
    applyPatch: globalExec?.applyPatch,
  };
}

export const __testing = {
  cleanToolSchemaForGemini,
  normalizeToolParams,
  patchToolSchemaForClaudeCompatibility,
  wrapToolParamNormalization,
  assertRequiredParams,
} as const;

export function createArgentCodingTools(options?: {
  exec?: ExecToolDefaults & ProcessToolDefaults;
  messageProvider?: string;
  agentAccountId?: string;
  messageTo?: string;
  messageThreadId?: string | number;
  sandbox?: SandboxContext | null;
  sessionKey?: string;
  agentDir?: string;
  workspaceDir?: string;
  config?: ArgentConfig;
  abortSignal?: AbortSignal;
  /**
   * Provider of the currently selected model (used for provider-specific tool quirks).
   * Example: "anthropic", "openai", "google", "openai-codex".
   */
  modelProvider?: string;
  /** Model id for the current provider (used for model-specific tool gating). */
  modelId?: string;
  /**
   * Auth mode for the current provider. We only need this for Anthropic OAuth
   * tool-name blocking quirks.
   */
  modelAuthMode?: ModelAuthMode;
  /** Current channel ID for auto-threading (Slack). */
  currentChannelId?: string;
  /** Current thread timestamp for auto-threading (Slack). */
  currentThreadTs?: string;
  /** Group id for channel-level tool policy resolution. */
  groupId?: string | null;
  /** Group channel label (e.g. #general) for channel-level tool policy resolution. */
  groupChannel?: string | null;
  /** Group space label (e.g. guild/team id) for channel-level tool policy resolution. */
  groupSpace?: string | null;
  /** Parent session key for subagent group policy inheritance. */
  spawnedBy?: string | null;
  senderId?: string | null;
  senderName?: string | null;
  senderUsername?: string | null;
  senderE164?: string | null;
  /** Reply-to mode for Slack auto-threading. */
  replyToMode?: "off" | "first" | "all";
  /** Mutable ref to track if a reply was sent (for "first" mode). */
  hasRepliedRef?: { value: boolean };
  /** If true, the model has native vision capability */
  modelHasVision?: boolean;
  /** If true, the current run has inbound user images. */
  hasInboundImages?: boolean;
  /** Require explicit message targets (no implicit last-route sends). */
  requireExplicitMessageTarget?: boolean;
  /** If true, omit the message tool from the tool list. */
  disableMessageTool?: boolean;
  /** Whether the sender is an owner (required for owner-only tools). */
  senderIsOwner?: boolean;
  /** Run ID for agent event emission (used by tool loop detection). */
  runId?: string;
  /** Previously discovered deferred tool names (from session state). */
  discoveredTools?: Set<string>;
  /** Mutable ref: tool_search writes discovered names here for session persistence. */
  discoveredToolsRef?: { names: Set<string> };
  /** Whether this is a heartbeat run (for subsystem core set detection). */
  isHeartbeat?: boolean;
}): AnyAgentTool[] {
  const execToolName = "exec";
  const sandbox = options?.sandbox?.enabled ? options.sandbox : undefined;
  const {
    agentId,
    departmentId,
    globalPolicy,
    globalAsk,
    departmentPolicy,
    departmentAsk,
    globalProviderPolicy,
    agentPolicy,
    agentAsk,
    agentProviderPolicy,
    sessionPolicy,
    profile,
    providerProfile,
    profileAlsoAllow,
    providerProfileAlsoAllow,
  } = resolveEffectiveToolPolicy({
    config: options?.config,
    sessionKey: options?.sessionKey,
    modelProvider: options?.modelProvider,
    modelId: options?.modelId,
  });
  const groupPolicy = resolveGroupToolPolicy({
    config: options?.config,
    sessionKey: options?.sessionKey,
    spawnedBy: options?.spawnedBy,
    messageProvider: options?.messageProvider,
    groupId: options?.groupId,
    groupChannel: options?.groupChannel,
    groupSpace: options?.groupSpace,
    accountId: options?.agentAccountId,
    senderId: options?.senderId,
    senderName: options?.senderName,
    senderUsername: options?.senderUsername,
    senderE164: options?.senderE164,
  });
  const profilePolicy = resolveToolProfilePolicy(profile);
  const providerProfilePolicy = resolveToolProfilePolicy(providerProfile);

  const mergeAlsoAllow = (policy: typeof profilePolicy, alsoAllow?: string[]) => {
    if (!policy?.allow || !Array.isArray(alsoAllow) || alsoAllow.length === 0) {
      return policy;
    }
    return { ...policy, allow: Array.from(new Set([...policy.allow, ...alsoAllow])) };
  };

  const profilePolicyWithAlsoAllow = mergeAlsoAllow(profilePolicy, profileAlsoAllow);
  const providerProfilePolicyWithAlsoAllow = mergeAlsoAllow(
    providerProfilePolicy,
    providerProfileAlsoAllow,
  );
  const scopeKey = options?.exec?.scopeKey ?? (agentId ? `agent:${agentId}` : undefined);
  const subagentPolicy =
    isSubagentSessionKey(options?.sessionKey) && options?.sessionKey
      ? resolveSubagentToolPolicy(options.config)
      : undefined;
  const allowBackground = isToolAllowedByPolicies("process", [
    profilePolicyWithAlsoAllow,
    providerProfilePolicyWithAlsoAllow,
    globalPolicy,
    departmentPolicy,
    globalProviderPolicy,
    agentPolicy,
    agentProviderPolicy,
    sessionPolicy,
    groupPolicy,
    sandbox?.tools,
    subagentPolicy,
  ]);
  const execConfig = resolveExecConfig(options?.config);
  const execForcedApproval =
    isToolMatchedByPolicyList(execToolName, departmentAsk) ||
    isToolMatchedByPolicyList(execToolName, agentAsk) ||
    isToolMatchedByPolicyList(execToolName, globalAsk);
  const sandboxRoot = sandbox?.workspaceDir;
  const allowWorkspaceWrites = sandbox?.workspaceAccess !== "ro";
  const workspaceRoot = options?.workspaceDir ?? process.cwd();
  const applyPatchConfig = options?.config?.tools?.exec?.applyPatch;
  const applyPatchEnabled =
    !!applyPatchConfig?.enabled &&
    isOpenAIProvider(options?.modelProvider) &&
    isApplyPatchAllowedForModel({
      modelProvider: options?.modelProvider,
      modelId: options?.modelId,
      allowModels: applyPatchConfig?.allowModels,
    });

  const base = (codingTools as unknown as AnyAgentTool[]).flatMap((tool) => {
    if (tool.name === readTool.name) {
      if (sandboxRoot) {
        return [createSandboxedReadTool(sandboxRoot)];
      }
      const freshReadTool = createReadTool(workspaceRoot);
      return [createArgentReadTool(freshReadTool, { workspaceDir: workspaceRoot })];
    }
    if (tool.name === "bash" || tool.name === execToolName) {
      return [];
    }
    if (tool.name === "write") {
      if (sandboxRoot) {
        return [];
      }
      // Wrap with param normalization for Claude Code compatibility
      return [
        wrapToolParamNormalization(createWriteTool(workspaceRoot), CLAUDE_PARAM_GROUPS.write),
      ];
    }
    if (tool.name === "edit") {
      if (sandboxRoot) {
        return [];
      }
      // Wrap with param normalization for Claude Code compatibility
      return [wrapToolParamNormalization(createEditTool(workspaceRoot), CLAUDE_PARAM_GROUPS.edit)];
    }
    return [tool];
  });
  const { cleanupMs: cleanupMsOverride, ...execDefaults } = options?.exec ?? {};
  const execTool = createExecTool({
    ...execDefaults,
    host: options?.exec?.host ?? execConfig.host,
    security: options?.exec?.security ?? execConfig.security,
    ask: execForcedApproval ? "always" : (options?.exec?.ask ?? execConfig.ask),
    node: options?.exec?.node ?? execConfig.node,
    pathPrepend: options?.exec?.pathPrepend ?? execConfig.pathPrepend,
    safeBins: options?.exec?.safeBins ?? execConfig.safeBins,
    agentId,
    cwd: options?.workspaceDir,
    allowBackground,
    scopeKey,
    sessionKey: options?.sessionKey,
    messageProvider: options?.messageProvider,
    backgroundMs: options?.exec?.backgroundMs ?? execConfig.backgroundMs,
    timeoutSec: options?.exec?.timeoutSec ?? execConfig.timeoutSec,
    approvalRunningNoticeMs:
      options?.exec?.approvalRunningNoticeMs ?? execConfig.approvalRunningNoticeMs,
    notifyOnExit: options?.exec?.notifyOnExit ?? execConfig.notifyOnExit,
    sandbox: sandbox
      ? {
          containerName: sandbox.containerName,
          workspaceDir: sandbox.workspaceDir,
          containerWorkdir: sandbox.containerWorkdir,
          env: sandbox.docker.env,
        }
      : undefined,
  });
  const processTool = createProcessTool({
    cleanupMs: cleanupMsOverride ?? execConfig.cleanupMs,
    scopeKey,
  });
  const applyPatchTool =
    !applyPatchEnabled || (sandboxRoot && !allowWorkspaceWrites)
      ? null
      : createApplyPatchTool({
          cwd: sandboxRoot ?? workspaceRoot,
          sandboxRoot: sandboxRoot && allowWorkspaceWrites ? sandboxRoot : undefined,
        });
  const tools: AnyAgentTool[] = [
    ...base,
    ...(sandboxRoot
      ? allowWorkspaceWrites
        ? [createSandboxedEditTool(sandboxRoot), createSandboxedWriteTool(sandboxRoot)]
        : []
      : []),
    ...(applyPatchTool ? [applyPatchTool as unknown as AnyAgentTool] : []),
    execTool as unknown as AnyAgentTool,
    processTool as unknown as AnyAgentTool,
    // Channel docking: include channel-defined agent tools (login, etc.).
    ...listChannelAgentTools({ cfg: options?.config }),
    ...createArgentTools({
      sandboxBrowserBridgeUrl: sandbox?.browser?.bridgeUrl,
      allowHostBrowserControl: sandbox ? sandbox.browserAllowHostControl : true,
      agentSessionKey: options?.sessionKey,
      agentChannel: resolveGatewayMessageChannel(options?.messageProvider),
      agentAccountId: options?.agentAccountId,
      agentTo: options?.messageTo,
      agentThreadId: options?.messageThreadId,
      agentGroupId: options?.groupId ?? null,
      agentGroupChannel: options?.groupChannel ?? null,
      agentGroupSpace: options?.groupSpace ?? null,
      agentDir: options?.agentDir,
      sandboxRoot,
      workspaceDir: options?.workspaceDir,
      extraAllowedPaths: options?.config?.agents?.defaults?.extraAllowedPaths as
        | string[]
        | undefined,
      sandboxed: !!sandbox,
      config: options?.config,
      pluginToolAllowlist: collectExplicitAllowlist([
        profilePolicy,
        providerProfilePolicy,
        globalPolicy,
        departmentPolicy,
        globalProviderPolicy,
        agentPolicy,
        agentProviderPolicy,
        sessionPolicy,
        groupPolicy,
        sandbox?.tools,
        subagentPolicy,
      ]),
      currentChannelId: options?.currentChannelId,
      currentThreadTs: options?.currentThreadTs,
      replyToMode: options?.replyToMode,
      hasRepliedRef: options?.hasRepliedRef,
      modelHasVision: options?.modelHasVision,
      disableImageTool: options?.hasInboundImages === true,
      disableImageGenerationTool: options?.hasInboundImages === true,
      requireExplicitMessageTarget: options?.requireExplicitMessageTarget,
      disableMessageTool: options?.disableMessageTool,
      requesterAgentIdOverride: agentId,
    }),
  ];
  // Security: treat unknown/undefined as unauthorized (opt-in, not opt-out)
  const senderIsOwner = options?.senderIsOwner === true;
  const toolsByAuthorization = applyOwnerOnlyToolPolicy(tools, senderIsOwner);
  const coreToolNames = new Set(
    toolsByAuthorization
      .filter((tool) => !getPluginToolMeta(tool))
      .map((tool) => normalizeToolName(tool.name))
      .filter(Boolean),
  );
  const pluginGroups = buildPluginToolGroups({
    tools: toolsByAuthorization,
    toolMeta: (tool) => getPluginToolMeta(tool),
  });
  const resolvePolicy = (policy: typeof profilePolicy, label: string) => {
    const resolved = stripPluginOnlyAllowlist(policy, pluginGroups, coreToolNames);
    if (resolved.unknownAllowlist.length > 0) {
      const entries = resolved.unknownAllowlist.join(", ");
      const suffix = resolved.strippedAllowlist
        ? "Ignoring allowlist so core tools remain available. Use tools.alsoAllow for additive plugin tool enablement."
        : "These entries won't match any tool unless the plugin is enabled.";
      logWarn(`tools: ${label} allowlist contains unknown entries (${entries}). ${suffix}`);
    }
    return expandPolicyWithPluginGroups(resolved.policy, pluginGroups);
  };
  const profilePolicyExpanded = resolvePolicy(
    profilePolicyWithAlsoAllow,
    profile ? `tools.profile (${profile})` : "tools.profile",
  );
  const providerProfileExpanded = resolvePolicy(
    providerProfilePolicyWithAlsoAllow,
    providerProfile ? `tools.byProvider.profile (${providerProfile})` : "tools.byProvider.profile",
  );
  const globalPolicyExpanded = resolvePolicy(globalPolicy, "tools.allow");
  const departmentPolicyExpanded = resolvePolicy(
    departmentPolicy,
    departmentId ? `tools.departments.${departmentId}.allow` : "tools.departments.allow",
  );
  const globalProviderExpanded = resolvePolicy(globalProviderPolicy, "tools.byProvider.allow");
  const agentPolicyExpanded = resolvePolicy(
    agentPolicy,
    agentId ? `agents.${agentId}.tools.allow` : "agent tools.allow",
  );
  const agentProviderExpanded = resolvePolicy(
    agentProviderPolicy,
    agentId ? `agents.${agentId}.tools.byProvider.allow` : "agent tools.byProvider.allow",
  );
  const sessionPolicyExpanded = resolvePolicy(sessionPolicy, "sessions.toolsAllow");
  const groupPolicyExpanded = resolvePolicy(groupPolicy, "group tools.allow");
  const sandboxPolicyExpanded = expandPolicyWithPluginGroups(sandbox?.tools, pluginGroups);
  const subagentPolicyExpanded = expandPolicyWithPluginGroups(subagentPolicy, pluginGroups);

  const toolsFiltered = profilePolicyExpanded
    ? filterToolsByPolicy(toolsByAuthorization, profilePolicyExpanded)
    : toolsByAuthorization;
  const providerProfileFiltered = providerProfileExpanded
    ? filterToolsByPolicy(toolsFiltered, providerProfileExpanded)
    : toolsFiltered;
  const globalFiltered = globalPolicyExpanded
    ? filterToolsByPolicy(providerProfileFiltered, globalPolicyExpanded)
    : providerProfileFiltered;
  const departmentFiltered = departmentPolicyExpanded
    ? filterToolsByPolicy(globalFiltered, departmentPolicyExpanded)
    : globalFiltered;
  const globalProviderFiltered = globalProviderExpanded
    ? filterToolsByPolicy(departmentFiltered, globalProviderExpanded)
    : departmentFiltered;
  const agentFiltered = agentPolicyExpanded
    ? filterToolsByPolicy(globalProviderFiltered, agentPolicyExpanded)
    : globalProviderFiltered;
  const agentProviderFiltered = agentProviderExpanded
    ? filterToolsByPolicy(agentFiltered, agentProviderExpanded)
    : agentFiltered;
  const sessionFiltered = sessionPolicyExpanded
    ? filterToolsByPolicy(agentProviderFiltered, sessionPolicyExpanded)
    : agentProviderFiltered;
  const groupFiltered = groupPolicyExpanded
    ? filterToolsByPolicy(sessionFiltered, groupPolicyExpanded)
    : sessionFiltered;
  const sandboxed = sandboxPolicyExpanded
    ? filterToolsByPolicy(groupFiltered, sandboxPolicyExpanded)
    : groupFiltered;
  const subagentFiltered = subagentPolicyExpanded
    ? filterToolsByPolicy(sandboxed, subagentPolicyExpanded)
    : sandboxed;
  // Always normalize tool JSON Schemas before handing them to pi-agent/pi-ai.
  // Without this, some providers (notably OpenAI) will reject root-level union schemas.
  const normalized = subagentFiltered.map((tool, index) =>
    normalizeToolParameters(tool, { strict: true, toolIndex: index }),
  );
  const withApproval = normalized.map((tool) =>
    wrapToolWithApprovalPolicy(tool, {
      approvalRequired:
        isToolMatchedByPolicyList(tool.name, departmentAsk) ||
        isToolMatchedByPolicyList(tool.name, agentAsk) ||
        isToolMatchedByPolicyList(tool.name, globalAsk),
      sessionKey: options?.sessionKey,
      agentId,
    }),
  );
  const withHooks = withApproval.map((tool) =>
    wrapToolWithBeforeToolCallHook(tool, {
      agentId,
      sessionKey: options?.sessionKey,
    }),
  );

  // Tool loop detection: wrap tools with a stateful detector that warns
  // then aborts when the agent calls the same tool with identical args.
  const loopConfig = options?.config?.agents?.defaults?.toolLoopDetection;
  const loopDetectionEnabled = loopConfig?.enabled !== false;
  let withLoopDetect: AnyAgentTool[];
  if (loopDetectionEnabled) {
    const detector = new ToolLoopDetector(loopConfig);
    const runId = options?.runId;
    withLoopDetect = withHooks.map((tool) =>
      wrapToolWithLoopDetection(tool, detector, {
        onLoopDetected: (event) => {
          if (event.action !== "allow") {
            emitAgentEvent({
              runId: runId ?? "unknown",
              stream: "error",
              data: {
                type: "tool_loop_detected",
                toolName: event.toolName,
                count: event.count,
                action: event.action,
              },
            });
          }
        },
      }),
    );
  } else {
    withLoopDetect = withHooks;
  }

  const withAbort = options?.abortSignal
    ? withLoopDetect.map((tool) => wrapToolWithAbortSignal(tool, options.abortSignal))
    : withLoopDetect;

  // Project Tony Stark: Deferred tool loading.
  // When enabled, only send core + previously-discovered tool schemas to the LLM.
  // The agent discovers deferred tools via tool_search; they persist in session state.
  const toolSearchConfig = options?.config?.agents?.defaults?.toolSearch;
  if (toolSearchConfig?.enabled) {
    // Detect background subsystem for minimal core sets
    const subsystem: BackgroundSubsystem | undefined = options?.isHeartbeat
      ? "heartbeat"
      : detectSubsystem(options?.sessionKey);
    const subsystemCoreSet = subsystem ? SUBSYSTEM_CORE_TOOLS[subsystem] : undefined;

    // Use subsystem-specific core set if detected, otherwise the generic one
    const coreOverrides = subsystemCoreSet ? new Set(subsystemCoreSet) : new Set(CORE_TOOL_NAMES);
    // Always include tool_search for discovery (unless subsystem explicitly excludes it)
    if (!subsystemCoreSet) {
      // Apply config overrides only for interactive sessions
      if (Array.isArray(toolSearchConfig.coreInclude)) {
        for (const name of toolSearchConfig.coreInclude)
          coreOverrides.add(name.trim().toLowerCase());
      }
      if (Array.isArray(toolSearchConfig.coreExclude)) {
        for (const name of toolSearchConfig.coreExclude)
          coreOverrides.delete(name.trim().toLowerCase());
      }
    }

    const discovered = options?.discoveredTools ?? new Set<string>();

    // Build registry for tool_search to query
    const registry = new ToolSearchRegistry();
    registry.registerAll(withAbort);

    // Resolve which tools to actually send: core + discovered
    const visibleTools = withAbort.filter((tool) => {
      const name = tool.name.trim().toLowerCase();
      return coreOverrides.has(name) || discovered.has(name);
    });

    // Wire the tool_search tool to use the registry for deferred discovery
    const toolSearchTool = visibleTools.find((t) => t.name === "tool_search");
    if (toolSearchTool) {
      const maxResults = toolSearchConfig.maxResults ?? 5;
      const maxDiscovered = toolSearchConfig.maxDiscovered ?? 20;
      const ref = options?.discoveredToolsRef;

      const originalExecute = toolSearchTool.execute;
      toolSearchTool.execute = async (toolCallId, args) => {
        // Use registry search for deferred tools
        const params = (args ?? {}) as Record<string, unknown>;
        const rawQuery = typeof params.query === "string" ? params.query.trim() : "";
        if (!rawQuery) {
          return originalExecute(toolCallId, args);
        }

        const matches = registry.search(rawQuery, maxResults);
        if (matches.length === 0) {
          return originalExecute(toolCallId, args);
        }

        // Record discovered tools
        for (const match of matches) {
          const name = match.tool.name.trim().toLowerCase();
          if (ref && ref.names.size < maxDiscovered) {
            ref.names.add(name);
          }
        }

        const lines = [
          `Found ${matches.length} tool(s) for "${rawQuery}":`,
          ...matches.map((m) => {
            const desc = m.tool.description?.trim();
            return `- ${m.tool.name}${desc ? ` — ${desc}` : ""}`;
          }),
          "",
          "These tools will be available on your next response turn in this session.",
        ];

        return {
          content: [{ type: "text", text: lines.join("\n") }],
          details: {
            ok: true,
            query: rawQuery,
            matches: matches.map((m) => ({
              name: m.tool.name,
              description: m.tool.description,
              score: m.score,
            })),
          },
        };
      };
    }

    return visibleTools;
  }

  // NOTE: Keep canonical (lowercase) tool names here.
  // pi-ai's Anthropic OAuth transport remaps tool names to Claude Code-style names
  // on the wire and maps them back for tool dispatch.
  return withAbort;
}
