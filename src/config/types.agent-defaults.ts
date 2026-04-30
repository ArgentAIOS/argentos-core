import type { ChannelId } from "../channels/plugins/types.js";
import type { ModelRouterConfig } from "../models/types.js";
import type {
  BlockStreamingChunkConfig,
  BlockStreamingCoalesceConfig,
  HumanDelayConfig,
  TypingMode,
} from "./types.base.js";
import type {
  SandboxBrowserSettings,
  SandboxDockerSettings,
  SandboxPruneSettings,
} from "./types.sandbox.js";
import type { MemorySearchConfig } from "./types.tools.js";

export type AgentModelEntryConfig = {
  alias?: string;
  /** Provider-specific API parameters (e.g., GLM-4.7 thinking mode). */
  params?: Record<string, unknown>;
};

export type AgentModelListConfig = {
  primary?: string;
  fallbacks?: string[];
};

export type AgentExecutionWorkerConfig = {
  /** Enable/disable explicit task execution loop for this agent. */
  enabled?: boolean;
  /** Execution cycle interval (duration string, default unit: minutes). */
  every?: string;
  /** Optional explicit model override for worker runs (provider/model). */
  model?: string;
  /** Stable worker main session key suffix (default: "worker-execution"). */
  sessionMainKey?: string;
  /** Continue draining tasks for at most this many minutes per cycle (default: 12). */
  maxRunMinutes?: number;
  /** Safety cap on tasks attempted in one cycle (default: 24). */
  maxTasksPerCycle?: number;
  /** Candidate task scope for this agent. */
  scope?: "assigned" | "agent-visible" | "all";
  /** Require concrete evidence before considering a cycle step successful (default: true). */
  requireEvidence?: boolean;
  /** Consecutive no-progress attempts before auto-blocking a task (default: 2). */
  maxNoProgressAttempts?: number;
};

export type AgentConsciousnessKernelMode = "off" | "shadow" | "soft" | "full";

export type AgentConsciousnessKernelOperatorNotificationTarget = {
  /** Channel id (for example "telegram", "slack", or a plugin channel id). */
  channel: string;
  /** Destination id for the selected channel. */
  to: string;
  /** Optional account id for multi-account channels. */
  accountId?: string;
  /** Optional thread id for threaded channels. */
  threadId?: string | number;
};

export type AgentConsciousnessKernelOperatorNotificationsConfig = {
  /** Send operator-needed kernel requests to configured outbound targets. Default: false. */
  enabled?: boolean;
  /** Minimum time before re-sending the same request. Default: 15 minutes. */
  cooldownMs?: number;
  /** Explicit operator notification targets. */
  targets?: AgentConsciousnessKernelOperatorNotificationTarget[];
};

export type AgentConsciousnessKernelConfig = {
  /** Enable the consciousness kernel for the default main agent only. */
  enabled?: boolean;
  /** Desired rollout mode. Slice 1 only activates shadow mode. */
  mode?: AgentConsciousnessKernelMode;
  /** Optional local model override for low-cost shadow ticks. */
  localModel?: string;
  /** Shadow-kernel tick cadence in milliseconds. */
  tickMs?: number;
  /** Soft guardrail for escalations allowed per hour. */
  maxEscalationsPerHour?: number;
  /** Soft daily budget for kernel-triggered work. */
  dailyBudget?: number;
  /** Require an attached hardware host before future embodied modes can activate. */
  hardwareHostRequired?: boolean;
  /** Allow future listening-capable modes to use microphone context. */
  allowListening?: boolean;
  /** Allow future vision-capable modes to use camera context. */
  allowVision?: boolean;
  /** Configurable outbound surfaces for kernel requests that need operator input. */
  operatorNotifications?: AgentConsciousnessKernelOperatorNotificationsConfig;
};

export type RuntimeLoadProfileId = "desktop" | "balanced-laptop" | "cool-laptop";

export type AgentRuntimeLoadProfileConfig = {
  /** Active runtime load profile. */
  active?: RuntimeLoadProfileId;
  /** Allow explicit operator overrides on top of the profile. Default: true. */
  allowManualOverrides?: boolean;
  /** Persisted manual overrides layered on top of the selected profile. */
  overrides?: {
    heartbeat?: AgentDefaultsConfig["heartbeat"];
    contemplation?: AgentDefaultsConfig["contemplation"];
    sis?: AgentDefaultsConfig["sis"];
    executionWorker?: AgentExecutionWorkerConfig;
    maxConcurrent?: number;
    backgroundConcurrency?: number;
    subagents?: {
      maxConcurrent?: number;
    };
    dashboard?: {
      pollingMultiplier?: number;
    };
  };
};

export type AgentContextPruningConfig = {
  mode?: "off" | "cache-ttl";
  /** TTL to consider cache expired (duration string, default unit: minutes). */
  ttl?: string;
  keepLastAssistants?: number;
  softTrimRatio?: number;
  hardClearRatio?: number;
  minPrunableToolChars?: number;
  tools?: {
    allow?: string[];
    deny?: string[];
  };
  softTrim?: {
    maxChars?: number;
    headChars?: number;
    tailChars?: number;
  };
  hardClear?: {
    enabled?: boolean;
    placeholder?: string;
  };
};

export type CliBackendConfig = {
  /** CLI command to execute (absolute path or on PATH). */
  command: string;
  /** Base args applied to every invocation. */
  args?: string[];
  /** Output parsing mode (default: json). */
  output?: "json" | "text" | "jsonl";
  /** Output parsing mode when resuming a CLI session. */
  resumeOutput?: "json" | "text" | "jsonl";
  /** Prompt input mode (default: arg). */
  input?: "arg" | "stdin";
  /** Max prompt length for arg mode (if exceeded, stdin is used). */
  maxPromptArgChars?: number;
  /** Extra env vars injected for this CLI. */
  env?: Record<string, string>;
  /** Env vars to remove before launching this CLI. */
  clearEnv?: string[];
  /** Flag used to pass model id (e.g. --model). */
  modelArg?: string;
  /** Model aliases mapping (config model id → CLI model id). */
  modelAliases?: Record<string, string>;
  /** Flag used to pass session id (e.g. --session-id). */
  sessionArg?: string;
  /** Extra args used when resuming a session (use {sessionId} placeholder). */
  sessionArgs?: string[];
  /** Alternate args to use when resuming a session (use {sessionId} placeholder). */
  resumeArgs?: string[];
  /** When to pass session ids. */
  sessionMode?: "always" | "existing" | "none";
  /** JSON fields to read session id from (in order). */
  sessionIdFields?: string[];
  /** Flag used to pass system prompt. */
  systemPromptArg?: string;
  /** System prompt behavior (append vs replace). */
  systemPromptMode?: "append" | "replace";
  /** When to send system prompt. */
  systemPromptWhen?: "first" | "always" | "never";
  /** Flag used to pass image paths. */
  imageArg?: string;
  /** How to pass multiple images. */
  imageMode?: "repeat" | "list";
  /** Optional MCP server map to expose as tool servers for CLI backends that support MCP config flags. */
  mcpServers?: Record<string, Record<string, unknown>>;
  /** Optional path to an MCP config JSON file. If set, this takes precedence over inline mcpServers. */
  mcpConfigPath?: string;
  /** CLI flag used to pass MCP config path (for example: --mcp-config). */
  mcpConfigArg?: string;
  /** CLI flag used to enforce strict MCP config parsing (for example: --strict-mcp-config). */
  strictMcpConfigArg?: string;
  /** Whether to append strictMcpConfigArg when supported (default: true). */
  strictMcpConfig?: boolean;
  /** Serialize runs for this CLI. */
  serialize?: boolean;
};

export type AgentDefaultsConfig = {
  /** Primary model and fallbacks (provider/model). */
  model?: AgentModelListConfig;
  /** Optional image-capable model and fallbacks (provider/model). */
  imageModel?: AgentModelListConfig;
  /** Model catalog with optional aliases (full provider/model keys). */
  models?: Record<string, AgentModelEntryConfig>;
  /** Agent working directory (preferred). Used as the default cwd for agent runs. */
  workspace?: string;
  /** Optional repository root for system prompt runtime line (overrides auto-detect). */
  repoRoot?: string;
  /** Skip bootstrap (BOOTSTRAP.md creation, etc.) for pre-configured deployments. */
  skipBootstrap?: boolean;
  /** Max chars for injected bootstrap files before truncation (default: 20000). */
  bootstrapMaxChars?: number;
  /** Optional IANA timezone for the user (used in system prompt; defaults to host timezone). */
  userTimezone?: string;
  /** Time format in system prompt: auto (OS preference), 12-hour, or 24-hour. */
  timeFormat?: "auto" | "12" | "24";
  /**
   * Envelope timestamp timezone: "utc" (default), "local", "user", or an IANA timezone string.
   */
  envelopeTimezone?: string;
  /**
   * Include absolute timestamps in message envelopes ("on" | "off", default: "on").
   */
  envelopeTimestamp?: "on" | "off";
  /**
   * Include elapsed time in message envelopes ("on" | "off", default: "on").
   */
  envelopeElapsed?: "on" | "off";
  /** Optional context window cap (used for runtime estimates + status %). */
  contextTokens?: number;
  /** Optional CLI backends for text-only fallback (claude-cli, etc.). */
  cliBackends?: Record<string, CliBackendConfig>;
  /** Opt-in: prune old tool results from the LLM context to reduce token usage. */
  contextPruning?: AgentContextPruningConfig;
  /** Tool loop detection: abort or warn when agent calls the same tool repeatedly. */
  toolLoopDetection?: {
    enabled?: boolean;
    /** Consecutive identical calls before warning (default: 3). */
    threshold?: number;
    /** Consecutive identical calls before abort (default: 7). */
    abortThreshold?: number;
    /** Initial backoff delay in ms (default: 1000). */
    initialBackoffMs?: number;
    /** Backoff multiplier (default: 2.0). */
    backoffMultiplier?: number;
    /** Max backoff delay in ms (default: 30000). */
    maxBackoffMs?: number;
    /** Tools excluded from detection (default: ["read"]). */
    excludeTools?: string[];
    /** Sliding window size (default: 20). */
    windowSize?: number;
    /** Tools that should only run once per turn/run. */
    singleAttemptTools?: string[];
    /** Per-tool total call budget per turn/run, regardless of arguments. */
    perToolBudget?: Record<string, number>;
  };
  /** Compaction tuning and pre-compaction memory flush behavior. */
  compaction?: AgentCompactionConfig;
  /** Vector memory search configuration (per-agent overrides supported). */
  memorySearch?: MemorySearchConfig;
  /** Model router configuration (complexity-based tier routing). */
  modelRouter?: ModelRouterConfig;
  /** Background Models configuration namespace. */
  backgroundModels?: {
    embeddings?: { provider?: string; model?: string; fallback?: string };
    executionWorker?: { provider?: string; model?: string; fallback?: string };
    heartbeat?: { provider?: string; model?: string; fallback?: string };
    contemplation?: { provider?: string; model?: string; fallback?: string };
    sis?: { provider?: string; model?: string; fallback?: string };
    intentSimulationAgent?: { provider?: string; model?: string; fallback?: string };
    intentSimulationJudge?: { provider?: string; model?: string; fallback?: string };
  };
  /** Default thinking level when no /think directive is present. */
  thinkingDefault?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  /** Default verbose level when no /verbose directive is present. */
  verboseDefault?: "off" | "on" | "full";
  /** Default elevated level when no /elevated directive is present. */
  elevatedDefault?: "off" | "on" | "ask" | "full";
  /** Default block streaming level when no override is present. */
  blockStreamingDefault?: "off" | "on";
  /**
   * Block streaming boundary:
   * - "text_end": end of each assistant text content block (before tool calls)
   * - "message_end": end of the whole assistant message (may include tool blocks)
   */
  blockStreamingBreak?: "text_end" | "message_end";
  /** Soft block chunking for streamed replies (min/max chars, prefer paragraph/newline). */
  blockStreamingChunk?: BlockStreamingChunkConfig;
  /**
   * Block reply coalescing (merge streamed chunks before send).
   * idleMs: wait time before flushing when idle.
   */
  blockStreamingCoalesce?: BlockStreamingCoalesceConfig;
  /** Human-like delay between block replies. */
  humanDelay?: HumanDelayConfig;
  /** Tool search / deferred loading configuration (Project Tony Stark). */
  toolSearch?: {
    /** Enable deferred tool loading. Only core tools sent by default; rest discoverable via tool_search. */
    enabled?: boolean;
    /** Max results returned per tool_search call (default: 5). */
    maxResults?: number;
    /** Max deferred tools discoverable per session (default: 20). */
    maxDiscovered?: number;
    /** Force specific tools into core set. */
    coreInclude?: string[];
    /** Force specific tools out of core set into deferred. */
    coreExclude?: string[];
  };
  timeoutSeconds?: number;
  /** Max inbound media size in MB for agent-visible attachments (text note or future image attach). */
  mediaMaxMb?: number;
  typingIntervalSeconds?: number;
  /** Typing indicator start mode (never|instant|thinking|message). */
  typingMode?: TypingMode;
  /** Periodic background heartbeat runs. */
  heartbeat?: {
    /** Heartbeat interval (duration string, default unit: minutes; default: 30m). */
    every?: string;
    /** Optional active-hours window (local time); heartbeats run only inside this window. */
    activeHours?: {
      /** Start time (24h, HH:MM). Inclusive. */
      start?: string;
      /** End time (24h, HH:MM). Exclusive. Use "24:00" for end-of-day. */
      end?: string;
      /** Timezone for the window ("user", "local", or IANA TZ id). Default: "user". */
      timezone?: string;
    };
    /** Heartbeat model override (provider/model). */
    model?: string;
    /** Session key for heartbeat runs ("main" or explicit session key). */
    session?: string;
    /** Delivery target ("last", "none", or a channel id). */
    target?: "last" | "none" | ChannelId;
    /** Optional delivery override (E.164 for WhatsApp, chat id for Telegram). */
    to?: string;
    /** Optional account id for multi-account channels. */
    accountId?: string;
    /** Override the heartbeat prompt body (default: "Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK."). */
    prompt?: string;
    /** Max chars allowed after HEARTBEAT_OK before delivery (default: 30). */
    ackMaxChars?: number;
    /**
     * When enabled, deliver the model's reasoning payload for heartbeat runs (when available)
     * as a separate message prefixed with `Reasoning:` (same as `/reasoning on`).
     *
     * Default: false (only the final heartbeat payload is delivered).
     */
    includeReasoning?: boolean;
    /** Verification sidecar configuration for structured heartbeat contracts. */
    verifier?: {
      /** Ollama model for local verification (default: "qwen3:1.7b"). */
      model?: string;
      /** Enable/disable the verification sidecar (default: true when contract tasks exist). */
      enabled?: boolean;
    };
  };
  /** Autonomous contemplation cycles + optional model override/fallbacks. */
  contemplation?: {
    /** Enable/disable contemplation cycles for default agent. */
    enabled?: boolean;
    /** Contemplation interval (duration string, default unit: minutes). */
    every?: string;
    /** Family-agent contemplation interval (duration string, default unit: minutes). */
    familyEvery?: string;
    /** Max contemplation cycles allowed per hour. */
    maxCyclesPerHour?: number;
    /** Override model for contemplation/SIS sessions (provider/model). */
    model?: string;
    /** Optional fallback chain for contemplation/SIS model override. */
    fallbacks?: string[];
    /** Optional post-contemplation discovery phase configuration (V3 memory integration). */
    discoveryPhase?: {
      /** Enable/disable discovery phase. */
      enabled?: boolean;
      /** Run discovery every N episodes (default runtime-controlled). */
      everyEpisodes?: number;
      /** Hard time budget for discovery work in ms. */
      maxDurationMs?: number;
    };
  };
  /** Explicit queue-draining task execution loop (separate from contemplation). */
  executionWorker?: AgentExecutionWorkerConfig;
  /** Live inbox: deterministic turn-time capture of high-salience conversation moments. */
  liveInbox?: {
    /** Enable/disable live inbox capture. Default: true. */
    enabled?: boolean;
    /** Enable immediate promotion of hard triggers. Default: true. */
    hardTriggers?: boolean;
    /** TTL in hours for pending candidates. Default: 24. */
    ttlHours?: number;
    /** Minimum confidence for hard trigger promotion. Default: 0.8. */
    promotionThreshold?: number;
    /** Max promotions per contemplation cycle. Default: 5. */
    maxPromotionsPerCycle?: number;
  };
  /** Max concurrent agent runs across all conversations. Default: 1 (sequential). */
  maxConcurrent?: number;
  /** Max concurrent background lane runs (MemU extraction, SIS, heartbeat, contemplation). Default: 1. */
  backgroundConcurrency?: number;
  /** Sub-agent defaults (spawned via sessions_spawn). */
  subagents?: {
    /** Max concurrent sub-agent runs (global lane: "subagent"). Default: 1. */
    maxConcurrent?: number;
    /** Auto-archive sub-agent sessions after N minutes (default: 60). */
    archiveAfterMinutes?: number;
    /** Default model selection for spawned sub-agents (string or {primary,fallbacks}). */
    model?: string | { primary?: string; fallbacks?: string[] };
    /** Default thinking level for spawned sub-agents (e.g. "off", "low", "medium", "high"). */
    thinking?: string;
  };
  /** Self-Improving System (SIS) configuration. */
  sis?: {
    /** Enable SIS consolidation cycles. Default: same as contemplation.enabled. */
    enabled?: boolean;
    /** Consolidation check interval (duration string, default: "10m"). */
    every?: string;
    /** Optional explicit model override for SIS consolidation runs (provider/model). */
    model?: string;
    /** Number of new episodes before triggering consolidation (default: 5). */
    episodesPerConsolidation?: number;
    /** Max lessons injected into agent prompts (default: 5). */
    maxLessonsInPrompt?: number;
    /** Days before lessons decay (default: 30). */
    lessonDecayDays?: number;
    /** Minimum confidence to inject a lesson (default: 0.4). */
    lessonMinConfidence?: number;
  };
  /** Main-agent-only consciousness kernel configuration. */
  kernel?: AgentConsciousnessKernelConfig;
  /** Extra directories the agent's file-edit tools may write to (absolute paths). */
  extraAllowedPaths?: string[];
  /** Optional sandbox settings for non-main sessions. */
  sandbox?: {
    /** Enable sandboxing for sessions. */
    mode?: "off" | "non-main" | "all";
    /**
     * Agent workspace access inside the sandbox.
     * - "none": do not mount the agent workspace into the container; use a sandbox workspace under workspaceRoot
     * - "ro": mount the agent workspace read-only; disables write/edit tools
     * - "rw": mount the agent workspace read/write; enables write/edit tools
     */
    workspaceAccess?: "none" | "ro" | "rw";
    /**
     * Session tools visibility for sandboxed sessions.
     * - "spawned": only allow session tools to target sessions spawned from this session (default)
     * - "all": allow session tools to target any session
     */
    sessionToolsVisibility?: "spawned" | "all";
    /** Container/workspace scope for sandbox isolation. */
    scope?: "session" | "agent" | "shared";
    /** Legacy alias for scope ("session" when true, "shared" when false). */
    perSession?: boolean;
    /** Root directory for sandbox workspaces. */
    workspaceRoot?: string;
    /** Docker-specific sandbox settings. */
    docker?: SandboxDockerSettings;
    /** Optional sandboxed browser settings. */
    browser?: SandboxBrowserSettings;
    /** Auto-prune sandbox containers. */
    prune?: SandboxPruneSettings;
  };
  /** Runtime load management profile (desktop/laptop thermal tuning). */
  loadProfile?: AgentRuntimeLoadProfileConfig;
};

export type AgentCompactionMode = "default" | "safeguard";

export type AgentCompactionConfig = {
  /** Compaction summarization mode. */
  mode?: AgentCompactionMode;
  /** Minimum reserve tokens enforced for Pi compaction (0 disables the floor). */
  reserveTokensFloor?: number;
  /** Max share of context window for history during safeguard pruning (0.1–0.9, default 0.5). */
  maxHistoryShare?: number;
  /** Pre-compaction memory flush (agentic turn). Default: enabled. */
  memoryFlush?: AgentCompactionMemoryFlushConfig;
};

export type AgentCompactionMemoryFlushConfig = {
  /** Enable the pre-compaction memory flush (default: true). */
  enabled?: boolean;
  /** Run the memory flush when context is within this many tokens of the compaction threshold. */
  softThresholdTokens?: number;
  /** User prompt used for the memory flush turn (NO_REPLY is enforced if missing). */
  prompt?: string;
  /** System prompt appended for the memory flush turn. */
  systemPrompt?: string;
};
