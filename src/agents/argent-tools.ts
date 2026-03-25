import type { ArgentConfig } from "../config/config.js";
import type { GatewayMessageChannel } from "../utils/message-channel.js";
import type { AnyAgentTool } from "./tools/common.js";
import { createConnectorTools } from "../connectors/tools.js";
import { getPluginToolMeta, resolvePluginTools } from "../plugins/tools.js";
import { INTERNAL_MESSAGE_CHANNEL } from "../utils/message-channel.js";
import { resolveMemoryAgentId, resolveSessionAgentId } from "./agent-scope.js";
import {
  filterPublicCorePluginTools,
  resolveBuiltinToolAllowlist,
  resolvePublicCorePluginRuntimeGate,
} from "./public-core-tools.js";
import { createAccountabilityTool } from "./tools/accountability-tool.js";
import { createAgentsListTool } from "./tools/agents-list-tool.js";
import { createAppsTool } from "./tools/apps-tool.js";
import { createArgentConfigTool } from "./tools/argent-config-tool.js";
import { createAudioAlertTool } from "./tools/audio-alert-tool.js";
import { createAudioGenerationTool } from "./tools/audio-generation-tool.js";
import { createBrowserTool } from "./tools/browser-tool.js";
import { createCanvasTool } from "./tools/canvas-tool.js";
import { createContemplationTool } from "./tools/contemplation-tool.js";
import { createCoolifyDeployTool } from "./tools/coolify-deploy-tool.js";
import { createCronTool } from "./tools/cron-tool.js";
import { createDiscordTool } from "./tools/discord-tool.js";
import { createDocPanelDeleteTool } from "./tools/doc-panel-delete-tool.js";
import { createDocPanelGetTool } from "./tools/doc-panel-get-tool.js";
import { createDocPanelListTool } from "./tools/doc-panel-list-tool.js";
import { createDocPanelSearchTool } from "./tools/doc-panel-search-tool.js";
import { createDocPanelTool } from "./tools/doc-panel-tool.js";
import { createDocPanelUpdateTool } from "./tools/doc-panel-update-tool.js";
import { createEasyDmarcTool } from "./tools/easydmarc-tool.js";
import { createEmailDeliveryTool } from "./tools/email-delivery-tool.js";
import { createFamilyTool } from "./tools/family-tool.js";
import { createEditLineRangeTool, createEditRegexTool } from "./tools/file-edit-tools.js";
import { createGatewayTool } from "./tools/gateway-tool.js";
import { createGithubIssueTool } from "./tools/github-issue-tool.js";
import { createHeygenVideoTool } from "./tools/heygen-video-tool.js";
import { createImageGenerationTool } from "./tools/image-generation-tool.js";
import { createImageTool } from "./tools/image-tool.js";
import {
  createKnowledgeCollectionsListTool,
  createKnowledgeSearchTool,
} from "./tools/knowledge-tools.js";
import { createMeetingRecorderTool } from "./tools/meeting-recorder-tool.js";
import { createMemoryGraphTool } from "./tools/memory-graph-tool.js";
import { createMemoryTimelineTool } from "./tools/memory-timeline-tool.js";
import {
  createMemoryRecallTool,
  createMemoryStoreTool,
  createMemoryCategoriesTool,
  createMemoryForgetTool,
  createMemoryEntityTool,
  createMemoryReflectTool,
} from "./tools/memu-tools.js";
import { createMessageTool } from "./tools/message-tool.js";
import { createMusicGenerationTool } from "./tools/music-generation-tool.js";
import { createNamecheapDnsTool } from "./tools/namecheap-dns-tool.js";
import { createNodesTool } from "./tools/nodes-tool.js";
import { createOsDocsTool } from "./tools/os-docs-tool.js";
import { createPluginBuilderTool } from "./tools/plugin-builder-tool.js";
import { createPodcastGenerateTool } from "./tools/podcast-generate-tool.js";
import { createPodcastPlanTool } from "./tools/podcast-plan-tool.js";
import { createPodcastPublishPipelineTool } from "./tools/podcast-publish-pipeline-tool.js";
import { createRailwayDeployTool } from "./tools/railway-deploy-tool.js";
import { createSearchTool } from "./tools/search-tool.js";
import { createSendPayloadTool } from "./tools/send-payload-tool.js";
import { createServiceKeysTool } from "./tools/service-keys-tool.js";
import { createSessionStatusTool } from "./tools/session-status-tool.js";
import { createSessionsHistoryTool } from "./tools/sessions-history-tool.js";
import { createSessionsListTool } from "./tools/sessions-list-tool.js";
import { createSessionsSearchTool } from "./tools/sessions-search-tool.js";
import { createSessionsSendTool } from "./tools/sessions-send-tool.js";
import { createSessionsSpawnTool } from "./tools/sessions-spawn-tool.js";
import { createSkillsTool } from "./tools/skills-tool.js";
import { createSlackSignalMonitorTool } from "./tools/slack-signal-monitor-tool.js";
import { createTasksTool } from "./tools/tasks-tools.js";
import { createTeamSpawnTool } from "./tools/team-spawn-tool.js";
import { createTeamStatusTool } from "./tools/team-status-tool.js";
import { createTerminalTool } from "./tools/terminal-tool.js";
import { createToolSearchTool } from "./tools/tool-search-tool.js";
import { createTtsGenerateTool } from "./tools/tts-generate-tool.js";
import { createTtsTool } from "./tools/tts-tool.js";
import { createTwilioCommTool } from "./tools/twilio-comm-tool.js";
import { createVercelDeployTool } from "./tools/vercel-deploy-tool.js";
import { createVideoGenerationTool } from "./tools/video-generation-tool.js";
import { createVipEmailTool } from "./tools/vip-email-tool.js";
import { createVisualPresenceTool } from "./tools/visual-presence-tool.js";
import { createWebFetchTool, createWebSearchTool } from "./tools/web-tools.js";
import { createWidgetBuilderTool } from "./tools/widget-builder-tool.js";
import { createYoutubeMetadataTool } from "./tools/youtube-metadata-tool.js";
import { createYoutubeNotebookLmTool } from "./tools/youtube-notebooklm-tool.js";
import { createYoutubeThumbnailTool } from "./tools/youtube-thumbnail-tool.js";

// Public core intentionally omits Business-only tools whose implementations are
// excluded by the export denylist. Keep this file aligned with argent-tools.ts
// except for those explicit boundary removals.

export function createArgentTools(options?: {
  sandboxBrowserBridgeUrl?: string;
  allowHostBrowserControl?: boolean;
  agentSessionKey?: string;
  agentChannel?: GatewayMessageChannel;
  agentAccountId?: string;
  /** Delivery target (e.g. telegram:group:123:topic:456) for topic/thread routing. */
  agentTo?: string;
  /** Thread/topic identifier for routing replies to the originating thread. */
  agentThreadId?: string | number;
  /** Group id for channel-level tool policy inheritance. */
  agentGroupId?: string | null;
  /** Group channel label for channel-level tool policy inheritance. */
  agentGroupChannel?: string | null;
  /** Group space label for channel-level tool policy inheritance. */
  agentGroupSpace?: string | null;
  agentDir?: string;
  sandboxRoot?: string;
  workspaceDir?: string;
  extraAllowedPaths?: string[];
  sandboxed?: boolean;
  config?: ArgentConfig;
  builtinToolAllowlist?: string[];
  pluginToolAllowlist?: string[];
  /** Current channel ID for auto-threading (Slack). */
  currentChannelId?: string;
  /** Current thread timestamp for auto-threading (Slack). */
  currentThreadTs?: string;
  /** Reply-to mode for Slack auto-threading. */
  replyToMode?: "off" | "first" | "all";
  /** Mutable ref to track if a reply was sent (for "first" mode). */
  hasRepliedRef?: { value: boolean };
  /** If true, the model has native vision capability */
  modelHasVision?: boolean;
  /** Explicit agent ID override for cron/hook sessions. */
  requesterAgentIdOverride?: string;
  /** Require explicit message targets (no implicit last-route sends). */
  requireExplicitMessageTarget?: boolean;
  /** If true, omit the message tool from the tool list. */
  disableMessageTool?: boolean;
}): AnyAgentTool[] {
  const imageTool = options?.agentDir?.trim()
    ? createImageTool({
        config: options?.config,
        agentDir: options.agentDir,
        sandboxRoot: options?.sandboxRoot,
        modelHasVision: options?.modelHasVision,
      })
    : null;
  const webSearchTool = createWebSearchTool({
    config: options?.config,
    sandboxed: options?.sandboxed,
    agentSessionKey: options?.agentSessionKey,
  });
  const webFetchTool = createWebFetchTool({
    config: options?.config,
    sandboxed: options?.sandboxed,
  });
  const messageTool = options?.disableMessageTool
    ? null
    : createMessageTool({
        agentAccountId: options?.agentAccountId,
        agentSessionKey: options?.agentSessionKey,
        config: options?.config,
        currentChannelId: options?.currentChannelId,
        currentChannelProvider: options?.agentChannel,
        currentThreadTs: options?.currentThreadTs,
        replyToMode: options?.replyToMode,
        hasRepliedRef: options?.hasRepliedRef,
        sandboxRoot: options?.sandboxRoot,
        requireExplicitTarget: options?.requireExplicitMessageTarget,
      });
  const tools: AnyAgentTool[] = [
    createBrowserTool({
      sandboxBridgeUrl: options?.sandboxBrowserBridgeUrl,
      allowHostControl: options?.allowHostBrowserControl,
    }),
    createCanvasTool(),
    createNodesTool({
      agentSessionKey: options?.agentSessionKey,
      config: options?.config,
    }),
    createCronTool({
      agentSessionKey: options?.agentSessionKey,
    }),
    ...(messageTool ? [messageTool] : []),
    createSendPayloadTool({
      agentSessionKey: options?.agentSessionKey,
      config: options?.config,
    }),
    // Skip server-side TTS for webchat/dashboard — the dashboard has its own
    // client-side ElevenLabs TTS with user-selectable voices.
    ...(options?.agentChannel === INTERNAL_MESSAGE_CHANNEL
      ? []
      : [
          createTtsTool({
            agentChannel: options?.agentChannel,
            config: options?.config,
          }),
        ]),
    createGatewayTool({
      agentSessionKey: options?.agentSessionKey,
      config: options?.config,
    }),
    createVisualPresenceTool({
      agentSessionKey: options?.agentSessionKey,
    }),
    createToolSearchTool({
      agentId: resolveSessionAgentId({
        sessionKey: options?.agentSessionKey,
        config: options?.config,
      }),
    }),
    createAgentsListTool({
      agentSessionKey: options?.agentSessionKey,
      requesterAgentIdOverride: options?.requesterAgentIdOverride,
    }),
    createSessionsListTool({
      agentSessionKey: options?.agentSessionKey,
      sandboxed: options?.sandboxed,
    }),
    createSessionsHistoryTool({
      agentSessionKey: options?.agentSessionKey,
      sandboxed: options?.sandboxed,
    }),
    createSessionsSendTool({
      agentSessionKey: options?.agentSessionKey,
      agentChannel: options?.agentChannel,
      sandboxed: options?.sandboxed,
    }),
    createSessionsSpawnTool({
      agentSessionKey: options?.agentSessionKey,
      agentChannel: options?.agentChannel,
      agentAccountId: options?.agentAccountId,
      agentTo: options?.agentTo,
      agentThreadId: options?.agentThreadId,
      agentGroupId: options?.agentGroupId,
      agentGroupChannel: options?.agentGroupChannel,
      agentGroupSpace: options?.agentGroupSpace,
      sandboxed: options?.sandboxed,
      requesterAgentIdOverride: options?.requesterAgentIdOverride,
    }),
    createTeamSpawnTool({
      agentSessionKey: options?.agentSessionKey,
      agentChannel: options?.agentChannel,
      agentAccountId: options?.agentAccountId,
      agentTo: options?.agentTo,
      agentThreadId: options?.agentThreadId,
      agentGroupId: options?.agentGroupId,
      agentGroupChannel: options?.agentGroupChannel,
      agentGroupSpace: options?.agentGroupSpace,
      sandboxed: options?.sandboxed,
      requesterAgentIdOverride: options?.requesterAgentIdOverride,
    }),
    createTeamStatusTool({
      agentSessionKey: options?.agentSessionKey,
    }),
    createSessionStatusTool({
      agentSessionKey: options?.agentSessionKey,
      config: options?.config,
    }),
    ...(webSearchTool ? [webSearchTool] : []),
    ...(webFetchTool ? [webFetchTool] : []),
    ...(imageTool ? [imageTool] : []),
    // ArgentOS tools
    createTasksTool({
      agentSessionKey: options?.agentSessionKey,
      agentId: resolveSessionAgentId({
        sessionKey: options?.agentSessionKey,
        config: options?.config,
      }),
    }),
    createAccountabilityTool({
      config: options?.config,
      agentId: resolveSessionAgentId({
        sessionKey: options?.agentSessionKey,
        config: options?.config,
      }),
    }),
    createSearchTool({
      agentId: resolveSessionAgentId({
        sessionKey: options?.agentSessionKey,
        config: options?.config,
      }),
    }),
    createKnowledgeSearchTool({
      agentSessionKey: options?.agentSessionKey,
    }),
    createKnowledgeCollectionsListTool({
      agentSessionKey: options?.agentSessionKey,
    }),
    createSessionsSearchTool(),
    createDiscordTool({ config: options?.config }),
    createAppsTool(),
    createDocPanelTool({ agentSessionKey: options?.agentSessionKey }),
    createDocPanelUpdateTool({ agentSessionKey: options?.agentSessionKey }),
    createDocPanelDeleteTool({ agentSessionKey: options?.agentSessionKey }),
    createDocPanelListTool({ agentSessionKey: options?.agentSessionKey }),
    createDocPanelSearchTool({ agentSessionKey: options?.agentSessionKey }),
    createDocPanelGetTool({ agentSessionKey: options?.agentSessionKey }),
    createPluginBuilderTool({ config: options?.config }),
    createWidgetBuilderTool(),
    // Media generation tools
    createImageGenerationTool(),
    createVideoGenerationTool(),
    createAudioGenerationTool({
      agentSessionKey: options?.agentSessionKey,
      config: options?.config,
    }),
    createMusicGenerationTool({
      agentSessionKey: options?.agentSessionKey,
      config: options?.config,
    }),
    createAudioAlertTool({
      agentSessionKey: options?.agentSessionKey,
      config: options?.config,
    }),
    createVipEmailTool({
      agentSessionKey: options?.agentSessionKey,
      config: options?.config,
    }),
    createSlackSignalMonitorTool({
      agentSessionKey: options?.agentSessionKey,
      config: options?.config,
    }),
    createTtsGenerateTool({
      agentSessionKey: options?.agentSessionKey,
      config: options?.config,
    }),
    createPodcastPlanTool(),
    createPodcastGenerateTool({
      agentSessionKey: options?.agentSessionKey,
      config: options?.config,
    }),
    createPodcastPublishPipelineTool({
      agentSessionKey: options?.agentSessionKey,
      config: options?.config,
    }),
    createCoolifyDeployTool({
      agentSessionKey: options?.agentSessionKey,
      config: options?.config,
    }),
    createRailwayDeployTool({
      agentSessionKey: options?.agentSessionKey,
      config: options?.config,
    }),
    createVercelDeployTool({
      agentSessionKey: options?.agentSessionKey,
      config: options?.config,
    }),
    createNamecheapDnsTool({
      agentSessionKey: options?.agentSessionKey,
      config: options?.config,
    }),
    createEasyDmarcTool({
      agentSessionKey: options?.agentSessionKey,
      config: options?.config,
    }),
    createEmailDeliveryTool({
      agentSessionKey: options?.agentSessionKey,
      config: options?.config,
    }),
    createTwilioCommTool({
      agentSessionKey: options?.agentSessionKey,
      config: options?.config,
    }),
    createHeygenVideoTool({
      agentSessionKey: options?.agentSessionKey,
      config: options?.config,
    }),
    createYoutubeMetadataTool(),
    createYoutubeNotebookLmTool(),
    createYoutubeThumbnailTool({
      agentSessionKey: options?.agentSessionKey,
      config: options?.config,
    }),
    // Utility tools
    createArgentConfigTool({ config: options?.config }),
    createServiceKeysTool(),
    createSkillsTool({ config: options?.config }),
    createTerminalTool(),
    createGithubIssueTool(),
    createMeetingRecorderTool({ agentSessionKey: options?.agentSessionKey }),
    createOsDocsTool(),
    // Agent Family — multi-agent registration, messaging, shared knowledge, spawn
    createFamilyTool({
      agentId: resolveSessionAgentId({
        sessionKey: options?.agentSessionKey,
        config: options?.config,
      }),
      agentSessionKey: options?.agentSessionKey,
      agentChannel: options?.agentChannel,
      agentAccountId: options?.agentAccountId,
      agentTo: options?.agentTo,
      agentThreadId: options?.agentThreadId,
      agentGroupId: options?.agentGroupId,
      agentGroupChannel: options?.agentGroupChannel,
      agentGroupSpace: options?.agentGroupSpace,
      requesterAgentIdOverride: options?.requesterAgentIdOverride,
    }),
    createEditLineRangeTool({
      workspaceDir: options?.workspaceDir,
      sandboxRoot: options?.sandboxRoot,
      extraAllowedPaths: options?.extraAllowedPaths,
    }),
    createEditRegexTool({
      workspaceDir: options?.workspaceDir,
      sandboxRoot: options?.sandboxRoot,
      extraAllowedPaths: options?.extraAllowedPaths,
    }),
  ];

  // MemU — three-layer long-term memory tools
  const memoryAgentId = resolveMemoryAgentId({
    sessionKey: options?.agentSessionKey,
    config: options?.config,
  });
  const memuTools = [
    createMemoryRecallTool({ config: options?.config, agentId: memoryAgentId }),
    createMemoryStoreTool({ config: options?.config, agentId: memoryAgentId }),
    createMemoryCategoriesTool({ config: options?.config, agentId: memoryAgentId }),
    createMemoryForgetTool({ config: options?.config, agentId: memoryAgentId }),
    createMemoryEntityTool({ config: options?.config, agentId: memoryAgentId }),
    createMemoryReflectTool({ config: options?.config, agentId: memoryAgentId }),
    createMemoryTimelineTool({ config: options?.config, agentId: memoryAgentId }),
    createMemoryGraphTool({ config: options?.config, agentId: memoryAgentId }),
  ].filter((t): t is AnyAgentTool => t !== null);
  tools.push(...memuTools);

  // Contemplation — introspection into the agent's own thinking history
  const contemplationTool = createContemplationTool({ config: options?.config });
  if (contemplationTool) {
    tools.push(contemplationTool);
  }

  tools.push(
    ...createConnectorTools({
      config: options?.config,
      agentSessionKey: options?.agentSessionKey,
    }),
  );

  const builtinToolAllowlist = resolveBuiltinToolAllowlist({
    config: options?.config,
    explicitAllowlist: options?.builtinToolAllowlist,
  });
  const builtinTools =
    builtinToolAllowlist === null
      ? tools
      : tools.filter((tool) => builtinToolAllowlist.has(tool.name.trim().toLowerCase()));

  const publicCorePluginGate = resolvePublicCorePluginRuntimeGate(options?.config);
  const pluginTools = filterPublicCorePluginTools({
    tools: resolvePluginTools({
      context: {
        config: options?.config,
        workspaceDir: options?.workspaceDir,
        agentDir: options?.agentDir,
        agentId: resolveSessionAgentId({
          sessionKey: options?.agentSessionKey,
          config: options?.config,
        }),
        sessionKey: options?.agentSessionKey,
        messageChannel: options?.agentChannel,
        agentAccountId: options?.agentAccountId,
        sandboxed: options?.sandboxed,
      },
      existingToolNames: new Set(builtinTools.map((tool) => tool.name)),
      toolAllowlist: options?.pluginToolAllowlist,
    }),
    gate: publicCorePluginGate,
    getPluginId: (tool) => getPluginToolMeta(tool)?.pluginId,
    getToolName: (tool) => tool.name,
  });

  return [...builtinTools, ...pluginTools];
}
