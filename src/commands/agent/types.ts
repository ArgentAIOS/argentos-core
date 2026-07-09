import type { ClientToolDefinition } from "../../agents/pi-embedded-runner/run/params.js";
import type { ChannelOutboundTargetMode } from "../../channels/plugins/types.js";

/** Image content block for Claude API multimodal messages. */
export type ImageContent = {
  type: "image";
  data: string;
  mimeType: string;
};

export type AgentStreamParams = {
  /** Provider stream params override (best-effort). */
  temperature?: number;
  maxTokens?: number;
};

export type AgentRunContext = {
  messageChannel?: string;
  accountId?: string;
  groupId?: string | null;
  groupChannel?: string | null;
  groupSpace?: string | null;
  currentChannelId?: string;
  currentThreadTs?: string;
  replyToMode?: "off" | "first" | "all";
  hasRepliedRef?: { value: boolean };
};

export type AgentCommandOpts = {
  message: string;
  /** Optional image attachments for multimodal messages. */
  images?: ImageContent[];
  /** Optional client-provided tools (OpenResponses hosted tools). */
  clientTools?: ClientToolDefinition[];
  /** Agent id override (must exist in config). */
  agentId?: string;
  to?: string;
  sessionId?: string;
  sessionKey?: string;
  thinking?: string;
  thinkingOnce?: string;
  verbose?: string;
  json?: boolean;
  timeout?: string;
  deliver?: boolean;
  /** Override delivery target (separate from session routing). */
  replyTo?: string;
  /** Override delivery channel (separate from session routing). */
  replyChannel?: string;
  /** Override delivery account id (separate from session routing). */
  replyAccountId?: string;
  /** Override delivery thread/topic id (separate from session routing). */
  threadId?: string | number;
  /** Message channel context (webchat|voicewake|whatsapp|...). */
  messageChannel?: string;
  channel?: string; // delivery channel (whatsapp|telegram|...)
  /** Account ID for multi-account channel routing (e.g., WhatsApp account). */
  accountId?: string;
  /** Context for embedded run routing (channel/account/thread). */
  runContext?: AgentRunContext;
  /** Group id for channel-level tool policy resolution. */
  groupId?: string | null;
  /** Group channel label for channel-level tool policy resolution. */
  groupChannel?: string | null;
  /** Group space label for channel-level tool policy resolution. */
  groupSpace?: string | null;
  /** Parent session key for subagent policy inheritance. */
  spawnedBy?: string | null;
  deliveryTargetMode?: ChannelOutboundTargetMode;
  bestEffortDeliver?: boolean;
  abortSignal?: AbortSignal;
  lane?: string;
  priority?: boolean;
  runId?: string;
  extraSystemPrompt?: string;
  /**
   * System prompt assembly mode for the embedded run. The execution worker
   * passes "minimal" so worker turns ship the blank-slate scaffold
   * (#407/#442). Omitted → normal resolution (subagent key or full).
   */
  promptMode?: "full" | "subagent" | "minimal" | "none";
  /**
   * Full replacement for the assembled system prompt (Worker Runtime v2 role
   * profiles, design D1+D2). When set, the embedded run ships exactly this
   * text as the system prompt — no operator scaffold, no bootstrap hint, no
   * appended sections. Pass promptMode "minimal" alongside so per-run context
   * loading (skills, cross-channel, context files) is skipped too.
   */
  systemPromptOverride?: string;
  /** Explicit provider override for this run, bypassing session-stored model routing state. */
  providerOverride?: string;
  /** Explicit model override for this run, bypassing session-stored model routing state. */
  modelOverride?: string;
  /** Per-call stream param overrides (best-effort). */
  streamParams?: AgentStreamParams;
  /** Disable model fallback — fail instead of falling back to a weaker model.
   *  Use for sessions where tool calling is critical (e.g., contemplation). */
  noFallback?: boolean;
  /**
   * Optional explicit fallback chain for this run.
   * When provided (even empty), overrides agent/global model fallbacks.
   */
  modelFallbacksOverride?: string[];
  /**
   * WR2 P4 "D9" — SIMULATE mode. When true, write-capable tool calls do NOT
   * execute; each is recorded as a `proposed_action` on the run record and the
   * worker gets a benign "recorded (simulated)" result. The operator reviews the
   * proposals; nothing external is touched.
   */
  simulateWrites?: boolean;
};
