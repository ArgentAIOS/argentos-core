/**
 * Argent Agent — createAgentSession Factory
 *
 * Bootstraps a fully-configured AgentSession by wiring together the agent loop,
 * session manager, settings manager, tool registry, model, and event system.
 *
 * This is the Argent-native replacement for Pi's createAgentSession(). It creates
 * a live AgentSession object that can prompt(), stream, execute tools, handle
 * compaction, and emit events — everything attempt.ts and compact.ts need.
 *
 * @module argent-agent/create-agent-session
 */

import type { TextContent, ImageContent } from "../argent-ai/types.js";
import type { ArgentConfig } from "../config/config.js";
import type {
  AgentSession,
  AgentSessionAgent,
  AgentSessionEvent,
  AgentSessionEventListener,
  BashResult,
  ContextUsage,
  CreateAgentSessionOptions,
  CreateAgentSessionResult,
  ModelCycleResult,
  PromptOptions,
  PromptTemplate,
  SessionCompactionResult,
  SessionStats,
} from "./agent-session.js";
import type { AgentMessage, AgentTool } from "./pi-types.js";
import type { BranchSummaryEntry } from "./session-manager.js";
import { modelSupportsImages } from "../agents/pi-embedded-runner/run/images.js";
import { applyVisionFallbackToMessages } from "../agents/pi-embedded-runner/run/vision-fallback.js";
import { ArgentSessionManager } from "./session-manager.js";
import { ArgentSettingsManager, type ThinkingLevel } from "./settings-manager.js";

// ============================================================================
// Internal Agent Implementation
// ============================================================================

class AgentImpl implements AgentSessionAgent {
  streamFn: AgentSessionAgent["streamFn"];
  extraParams?: Record<string, unknown>;
  private _messages: AgentMessage[] = [];
  private _systemPrompt = "";

  constructor(streamFn: AgentSessionAgent["streamFn"]) {
    this.streamFn = streamFn;
  }

  setSystemPrompt(prompt: string): void {
    this._systemPrompt = prompt;
  }

  getSystemPrompt(): string {
    return this._systemPrompt;
  }

  replaceMessages(messages: AgentMessage[]): void {
    this._messages = [...messages];
  }

  getMessages(): AgentMessage[] {
    return this._messages;
  }
}

// ============================================================================
// Agent Session Implementation
// ============================================================================

class ArgentAgentSessionImpl implements AgentSession {
  readonly agent: AgentImpl;
  readonly sessionManager: ArgentSessionManager;
  readonly settingsManager: ArgentSettingsManager;

  private _tools: AgentTool[] = [];
  private _customTools: unknown[] = [];
  private _listeners: AgentSessionEventListener[] = [];
  private _isStreaming = false;
  private _isCompacting = false;
  private _isRetrying = false;
  private _isBashRunning = false;
  private _autoCompaction = true;
  private _autoRetry = true;
  private _thinkingLevel: ThinkingLevel;
  private _model: unknown;
  private _config: ArgentConfig | undefined;
  private _agentDir: string | undefined;
  private _steeringMode: "all" | "one-at-a-time" = "all";
  private _followUpMode: "all" | "one-at-a-time" = "all";
  private _steeringQueue: string[] = [];
  private _followUpQueue: string[] = [];
  private _sessionName?: string;
  private _abortController: AbortController | null = null;
  private _disposed = false;

  constructor(
    agent: AgentImpl,
    sm: ArgentSessionManager,
    settings: ArgentSettingsManager,
    model: unknown,
    thinkingLevel: ThinkingLevel,
    tools: AgentTool[],
    opts?: {
      config?: ArgentConfig;
      agentDir?: string;
    },
  ) {
    this.agent = agent;
    this.sessionManager = sm;
    this.settingsManager = settings;
    this._model = model;
    this._config = opts?.config;
    this._agentDir = opts?.agentDir;
    this._thinkingLevel = thinkingLevel;
    this._tools = tools;
    this._steeringMode = settings.getSteeringMode();
    this._followUpMode = settings.getFollowUpMode();

    // Load existing messages from session
    const ctx = sm.buildSessionContext();
    agent.replaceMessages(ctx.messages);
  }

  // -- State flags --
  get isStreaming(): boolean {
    return this._isStreaming;
  }
  get isCompacting(): boolean {
    return this._isCompacting;
  }
  get isRetrying(): boolean {
    return this._isRetrying;
  }
  get isBashRunning(): boolean {
    return this._isBashRunning;
  }
  get hasPendingBashMessages(): boolean {
    return false;
  }
  get autoCompactionEnabled(): boolean {
    return this._autoCompaction;
  }
  get autoRetryEnabled(): boolean {
    return this._autoRetry;
  }

  // -- Getters --
  get model(): unknown {
    return this._model;
  }
  get thinkingLevel(): ThinkingLevel {
    return this._thinkingLevel;
  }
  get systemPrompt(): string {
    return this.agent.getSystemPrompt();
  }
  get retryAttempt(): number {
    return 0;
  }
  get steeringMode(): "all" | "one-at-a-time" {
    return this._steeringMode;
  }
  get followUpMode(): "all" | "one-at-a-time" {
    return this._followUpMode;
  }
  get sessionFile(): string | undefined {
    return this.sessionManager.getSessionFile();
  }
  get sessionId(): string {
    return this.sessionManager.getSessionId();
  }
  get sessionName(): string | undefined {
    return this._sessionName ?? this.sessionManager.getSessionName();
  }
  get scopedModels(): ReadonlyArray<{ model: unknown; thinkingLevel: ThinkingLevel }> {
    return [];
  }
  get promptTemplates(): ReadonlyArray<PromptTemplate> {
    return [];
  }
  get state(): unknown {
    return { model: this._model, thinkingLevel: this._thinkingLevel };
  }
  get messages(): AgentMessage[] {
    return this.agent.getMessages();
  }
  get pendingMessageCount(): number {
    return this._steeringQueue.length + this._followUpQueue.length;
  }

  // -- Events --
  subscribe(listener: AgentSessionEventListener): () => void {
    this._listeners.push(listener);
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx >= 0) this._listeners.splice(idx, 1);
    };
  }

  private _emit(event: AgentSessionEvent): void {
    for (const listener of this._listeners) {
      try {
        listener(event);
      } catch {
        /* listener errors are silenced */
      }
    }
  }

  // -- Core execution --
  /**
   * Full multi-turn agent loop with Pi-compatible event emission.
   *
   * Flow: stream → detect tool calls → execute tools → re-stream → repeat
   * Events match Pi's AgentEvent shapes so subscribeEmbeddedPiSession works unchanged.
   */
  async prompt(text: string, options?: PromptOptions): Promise<void> {
    if (this._disposed) throw new Error("Session disposed");
    this._isStreaming = true;
    this._abortController = new AbortController();
    const signal = this._abortController.signal;
    const newMessages: AgentMessage[] = [];

    try {
      // Append user message to session
      const userMsg: AgentMessage = {
        role: "user",
        content: buildUserContent(text, options?.images),
      } as unknown as AgentMessage;
      this.sessionManager.appendMessage(userMsg);
      let currentMessages = [...this.agent.getMessages(), userMsg];
      this.agent.replaceMessages(currentMessages);
      newMessages.push(userMsg);

      this._emit({ type: "agent_start" } as unknown as AgentSessionEvent);

      let firstTurn = true;
      let pendingMessages: AgentMessage[] = [];
      const MAX_ITERATIONS = 25;
      let totalIterations = 0;

      // Drain initial steering queue
      if (this._steeringQueue.length > 0) {
        pendingMessages = this._steeringQueue
          .splice(0)
          .map(
            (t) =>
              ({ role: "user", content: [{ type: "text", text: t }] }) as unknown as AgentMessage,
          );
      }

      // Outer loop: continues when follow-up messages arrive after agent would stop
      outer: while (totalIterations < MAX_ITERATIONS) {
        let hasMoreToolCalls = true;

        // Inner loop: tool calls + steering messages
        while (
          (hasMoreToolCalls || pendingMessages.length > 0) &&
          totalIterations < MAX_ITERATIONS
        ) {
          totalIterations++;

          if (!firstTurn) {
            this._emit({ type: "turn_start" } as unknown as AgentSessionEvent);
          } else {
            firstTurn = false;
            this._emit({ type: "turn_start" } as unknown as AgentSessionEvent);
          }

          // Inject pending messages
          for (const msg of pendingMessages) {
            this._emit({ type: "message_start", message: msg } as unknown as AgentSessionEvent);
            this._emit({ type: "message_end", message: msg } as unknown as AgentSessionEvent);
            currentMessages.push(msg);
            this.sessionManager.appendMessage(msg);
            newMessages.push(msg);
          }
          pendingMessages = [];

          currentMessages = await this._prepareMessagesForStream(currentMessages);

          // Stream assistant response
          const assistantMsg = await this._streamAssistantResponse(currentMessages, signal);

          if (assistantMsg) {
            currentMessages.push(assistantMsg);
            this.sessionManager.appendMessage(assistantMsg);
            this.agent.replaceMessages([...currentMessages]);
            newMessages.push(assistantMsg);
          }

          // Check for abort/error stop reasons
          const stopReason =
            assistantMsg &&
            typeof assistantMsg === "object" &&
            "stopReason" in assistantMsg &&
            typeof assistantMsg.stopReason === "string"
              ? assistantMsg.stopReason
              : undefined;
          if (stopReason === "error" || stopReason === "aborted") {
            this._emit({
              type: "turn_end",
              message: assistantMsg,
              toolResults: [],
            } as unknown as AgentSessionEvent);
            this._emit({
              type: "agent_end",
              messages: newMessages,
            } as unknown as AgentSessionEvent);
            return;
          }

          // Check for tool calls in assistant response
          const content =
            assistantMsg &&
            typeof assistantMsg === "object" &&
            "content" in assistantMsg &&
            Array.isArray(assistantMsg.content)
              ? assistantMsg.content
              : [];
          const toolCalls = content.filter(
            (
              c,
            ): c is {
              type: "toolCall";
              id: string;
              name: string;
              arguments: Record<string, unknown>;
            } =>
              c != null &&
              typeof c === "object" &&
              "type" in c &&
              c.type === "toolCall" &&
              "id" in c &&
              typeof c.id === "string" &&
              "name" in c &&
              typeof c.name === "string" &&
              "arguments" in c &&
              typeof c.arguments === "object" &&
              c.arguments !== null &&
              !Array.isArray(c.arguments),
          );
          hasMoreToolCalls = toolCalls.length > 0;

          const toolResults: AgentMessage[] = [];

          if (hasMoreToolCalls) {
            for (let i = 0; i < toolCalls.length; i++) {
              const toolCall = toolCalls[i]!;
              const tool = this._tools.find((t) => t.name === toolCall.name);

              this._emit({
                type: "tool_execution_start",
                toolCallId: toolCall.id,
                toolName: toolCall.name,
                args: toolCall.arguments,
              } as unknown as AgentSessionEvent);

              let result: { content: unknown[]; details: unknown };
              let isError = false;

              try {
                if (!tool) throw new Error(`Tool ${toolCall.name as string} not found`);
                result = await tool.execute(
                  toolCall.id as string,
                  toolCall.arguments,
                  signal,
                  (partialResult) => {
                    this._emit({
                      type: "tool_execution_update",
                      toolCallId: toolCall.id,
                      toolName: toolCall.name,
                      args: toolCall.arguments,
                      partialResult,
                    } as unknown as AgentSessionEvent);
                  },
                );
              } catch (e) {
                result = {
                  content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }],
                  details: {},
                };
                isError = true;
              }

              this._emit({
                type: "tool_execution_end",
                toolCallId: toolCall.id,
                toolName: toolCall.name,
                result,
                isError,
              } as unknown as AgentSessionEvent);

              const normalizedContent = Array.isArray(result?.content) ? result.content : [];

              const toolResultMessage = {
                role: "toolResult",
                toolCallId: toolCall.id,
                toolName: toolCall.name,
                content: normalizedContent,
                details: result.details,
                isError,
                timestamp: Date.now(),
              } as unknown as AgentMessage;

              toolResults.push(toolResultMessage);
              currentMessages.push(toolResultMessage);
              this.sessionManager.appendMessage(toolResultMessage);
              newMessages.push(toolResultMessage);

              this._emit({
                type: "message_start",
                message: toolResultMessage,
              } as unknown as AgentSessionEvent);
              this._emit({
                type: "message_end",
                message: toolResultMessage,
              } as unknown as AgentSessionEvent);

              // Check for steering interrupts between tool executions
              if (this._steeringQueue.length > 0) {
                // Skip remaining tools
                for (let j = i + 1; j < toolCalls.length; j++) {
                  const skipped = toolCalls[j]!;
                  const skipResult = {
                    content: [{ type: "text", text: "Skipped due to queued user message." }],
                    details: {},
                  };
                  this._emit({
                    type: "tool_execution_start",
                    toolCallId: skipped.id,
                    toolName: skipped.name,
                    args: skipped.arguments,
                  } as unknown as AgentSessionEvent);
                  this._emit({
                    type: "tool_execution_end",
                    toolCallId: skipped.id,
                    toolName: skipped.name,
                    result: skipResult,
                    isError: true,
                  } as unknown as AgentSessionEvent);
                  const skipMsg = {
                    role: "toolResult",
                    toolCallId: skipped.id,
                    toolName: skipped.name,
                    content: skipResult.content,
                    details: skipResult.details,
                    isError: true,
                    timestamp: Date.now(),
                  } as unknown as AgentMessage;
                  toolResults.push(skipMsg);
                  currentMessages.push(skipMsg);
                  newMessages.push(skipMsg);
                  this._emit({
                    type: "message_start",
                    message: skipMsg,
                  } as unknown as AgentSessionEvent);
                  this._emit({
                    type: "message_end",
                    message: skipMsg,
                  } as unknown as AgentSessionEvent);
                }
                pendingMessages = this._steeringQueue.splice(0).map(
                  (t) =>
                    ({
                      role: "user",
                      content: [{ type: "text", text: t }],
                    }) as unknown as AgentMessage,
                );
                break;
              }
            }
          }

          this._emit({
            type: "turn_end",
            message: assistantMsg,
            toolResults,
          } as unknown as AgentSessionEvent);

          // Drain steering queue after turn
          if (pendingMessages.length === 0 && this._steeringQueue.length > 0) {
            pendingMessages = this._steeringQueue.splice(0).map(
              (t) =>
                ({
                  role: "user",
                  content: [{ type: "text", text: t }],
                }) as unknown as AgentMessage,
            );
          }
        }

        // Check follow-up queue
        if (this._followUpQueue.length > 0) {
          pendingMessages = this._followUpQueue
            .splice(0)
            .map(
              (t) =>
                ({ role: "user", content: [{ type: "text", text: t }] }) as unknown as AgentMessage,
            );
          continue outer;
        }
        break;
      }

      this._emit({ type: "agent_end", messages: newMessages } as unknown as AgentSessionEvent);
    } finally {
      this._isStreaming = false;
      this._abortController = null;
    }
  }

  private async _prepareMessagesForStream(
    currentMessages: AgentMessage[],
  ): Promise<AgentMessage[]> {
    const modelMeta = resolveVisionModelMeta(this._model);
    if (modelSupportsImages(modelMeta)) {
      return currentMessages;
    }
    const prepared = await applyVisionFallbackToMessages(currentMessages, {
      modelHasVision: false,
      minimaxBaseUrl: modelMeta.provider === "minimax" ? modelMeta.baseUrl : undefined,
      cfg: this._config,
      agentDir: this._agentDir,
    });
    if (prepared !== currentMessages) {
      this.agent.replaceMessages(prepared);
      return [...prepared];
    }
    return currentMessages;
  }

  /**
   * Stream a single assistant response from the provider.
   * Emits Pi-compatible message_start/message_update/message_end events.
   */
  private async _streamAssistantResponse(
    currentMessages: AgentMessage[],
    signal: AbortSignal,
  ): Promise<AgentMessage | null> {
    const context = {
      messages: currentMessages,
      systemPrompt: this.systemPrompt,
      tools: this._tools,
    };

    const stream = this.agent.streamFn(this._model, context, {
      thinkingLevel: this._thinkingLevel,
      signal,
    }) as AsyncIterable<Record<string, unknown>>;

    let partialMessage: AgentMessage | null = null;
    let finalMessage: AgentMessage | null = null;
    let addedPartial = false;

    for await (const event of stream) {
      if (signal.aborted) break;

      const eventType = event.type as string;
      switch (eventType) {
        case "start":
          partialMessage = event.partial as AgentMessage;
          addedPartial = true;
          this._emit({
            type: "message_start",
            message: { ...partialMessage },
          } as unknown as AgentSessionEvent);
          break;

        case "text_start":
        case "text_delta":
        case "text_end":
        case "thinking_start":
        case "thinking_delta":
        case "thinking_end":
        case "toolcall_start":
        case "toolcall_delta":
        case "toolcall_end":
          if (partialMessage) {
            partialMessage = (event.partial as AgentMessage) ?? partialMessage;
            this._emit({
              type: "message_update",
              assistantMessageEvent: event,
              message: { ...partialMessage },
            } as unknown as AgentSessionEvent);
          }
          break;

        case "done":
        case "error": {
          finalMessage = ((event.message ?? event.error ?? partialMessage) as AgentMessage) ?? null;
          if (!addedPartial && finalMessage) {
            this._emit({
              type: "message_start",
              message: { ...finalMessage },
            } as unknown as AgentSessionEvent);
          }
          if (finalMessage) {
            this._emit({
              type: "message_end",
              message: finalMessage,
            } as unknown as AgentSessionEvent);
          }
          break;
        }
      }
    }

    // If stream yielded a result() method (Pi's EventStream), use it
    const streamObj = stream as { result?: () => Promise<AgentMessage> };
    if (!finalMessage && streamObj.result) {
      try {
        finalMessage = await streamObj.result();
        if (finalMessage && !addedPartial) {
          this._emit({
            type: "message_start",
            message: { ...finalMessage },
          } as unknown as AgentSessionEvent);
        }
        if (finalMessage) {
          this._emit({
            type: "message_end",
            message: finalMessage,
          } as unknown as AgentSessionEvent);
        }
      } catch {
        /* result() may reject if stream errored */
      }
    }

    return finalMessage ?? partialMessage;
  }

  async abort(): Promise<void> {
    this._abortController?.abort();
  }

  dispose(): void {
    this._disposed = true;
    this._listeners = [];
    this._abortController?.abort();
  }

  // -- Session management --
  async newSession(options?: {
    parentSession?: string;
    setup?: (sm: ArgentSessionManager) => Promise<void>;
  }): Promise<boolean> {
    this.sessionManager.newSession({ parentSession: options?.parentSession });
    if (options?.setup) await options.setup(this.sessionManager);
    this.agent.replaceMessages([]);
    return true;
  }

  async switchSession(sessionPath: string): Promise<boolean> {
    this.sessionManager.setSessionFile(sessionPath);
    const ctx = this.sessionManager.buildSessionContext();
    this.agent.replaceMessages(ctx.messages);
    return true;
  }

  async reload(): Promise<void> {
    this.settingsManager.reload();
  }

  // -- Model / thinking --
  async setModel(model: unknown): Promise<void> {
    this._model = model;
    if (model && typeof model === "object" && "provider" in model && "id" in model) {
      const m = model as { provider: string; id: string };
      this.sessionManager.appendModelChange(m.provider, m.id);
    }
  }

  async cycleModel(_direction?: "forward" | "backward"): Promise<ModelCycleResult | undefined> {
    return undefined; // Requires scoped models
  }

  setThinkingLevel(level: ThinkingLevel): void {
    this._thinkingLevel = level;
    this.sessionManager.appendThinkingLevelChange(level);
  }

  cycleThinkingLevel(): ThinkingLevel | undefined {
    const levels: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];
    const idx = levels.indexOf(this._thinkingLevel);
    const next = levels[(idx + 1) % levels.length]!;
    this.setThinkingLevel(next);
    return next;
  }

  getAvailableThinkingLevels(): ThinkingLevel[] {
    return ["off", "minimal", "low", "medium", "high", "xhigh"];
  }

  supportsThinking(): boolean {
    return true;
  }
  supportsXhighThinking(): boolean {
    return true;
  }

  // -- Message queuing --
  async steer(text: string): Promise<void> {
    this._steeringQueue.push(text);
  }
  async followUp(text: string): Promise<void> {
    this._followUpQueue.push(text);
  }
  getSteeringMessages(): readonly string[] {
    return this._steeringQueue;
  }
  getFollowUpMessages(): readonly string[] {
    return this._followUpQueue;
  }
  clearQueue(): { steering: string[]; followUp: string[] } {
    const steering = [...this._steeringQueue];
    const followUp = [...this._followUpQueue];
    this._steeringQueue = [];
    this._followUpQueue = [];
    return { steering, followUp };
  }

  // -- Custom messages --
  async sendCustomMessage<T = unknown>(
    message: {
      customType: string;
      content: string | (TextContent | ImageContent)[];
      display: boolean;
      details?: T;
    },
    _options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
  ): Promise<void> {
    this.sessionManager.appendCustomMessageEntry(
      message.customType,
      message.content,
      message.display,
      message.details,
    );
  }

  async sendUserMessage(
    content: string | (TextContent | ImageContent)[],
    options?: { deliverAs?: "steer" | "followUp" },
  ): Promise<void> {
    const text =
      typeof content === "string"
        ? content
        : content.map((b) => (b.type === "text" ? (b as TextContent).text : "")).join("");
    if (options?.deliverAs === "steer") {
      await this.steer(text);
    } else if (options?.deliverAs === "followUp") {
      await this.followUp(text);
    }
  }

  // -- Tool management --
  getActiveToolNames(): string[] {
    return this._tools.map((t) => t.name);
  }
  getAllTools(): Array<{ name: string; description: string }> {
    return this._tools.map((t) => ({ name: t.name, description: t.description ?? "" }));
  }
  setActiveToolsByName(_toolNames: string[]): void {
    // Tool filtering — for now, keep all tools active
  }

  // -- Compaction & retry --
  async compact(_customInstructions?: string): Promise<SessionCompactionResult> {
    this._isCompacting = true;
    this._emit({ type: "compaction_start" });
    try {
      // Delegate to session manager's compaction
      const messages = this.messages;
      const tokensBefore = messages.reduce((sum, m) => sum + estimateTokens(m), 0);
      const summary = `Summary of ${messages.length} messages.`;
      const firstKeptId = this.sessionManager.getLeafId() ?? "";
      this.sessionManager.appendCompaction(summary, firstKeptId, tokensBefore);
      return { summary, tokensBefore, tokensAfter: 0, messagesRemoved: messages.length };
    } finally {
      this._isCompacting = false;
      this._emit({ type: "compaction_end" });
    }
  }

  abortCompaction(): void {
    /* no-op for now */
  }
  abortBranchSummary(): void {
    /* no-op for now */
  }
  setAutoCompactionEnabled(enabled: boolean): void {
    this._autoCompaction = enabled;
  }
  abortRetry(): void {
    this._isRetrying = false;
  }
  setAutoRetryEnabled(enabled: boolean): void {
    this._autoRetry = enabled;
  }

  // -- Bash --
  async executeBash(
    command: string,
    onChunk?: (chunk: string) => void,
    _options?: { excludeFromContext?: boolean; operations?: unknown },
  ): Promise<BashResult> {
    this._isBashRunning = true;
    try {
      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const execAsync = promisify(exec);
      const result = await execAsync(command, { timeout: 120_000 });
      if (onChunk) onChunk(result.stdout);
      return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; code?: number };
      return { stdout: e.stdout ?? "", stderr: e.stderr ?? String(err), exitCode: e.code ?? 1 };
    } finally {
      this._isBashRunning = false;
    }
  }

  recordBashResult(
    _command: string,
    _result: BashResult,
    _options?: { excludeFromContext?: boolean },
  ): void {
    // Record in session if needed
  }

  abortBash(): void {
    /* no-op for now */
  }

  // -- Modes --
  setSteeringMode(mode: "all" | "one-at-a-time"): void {
    this._steeringMode = mode;
  }
  setFollowUpMode(mode: "all" | "one-at-a-time"): void {
    this._followUpMode = mode;
  }
  setSessionName(name: string): void {
    this._sessionName = name;
    this.sessionManager.appendSessionInfo(name);
  }

  // -- Tree navigation --
  async fork(_entryId: string): Promise<{ selectedText: string; cancelled: boolean }> {
    return { selectedText: "", cancelled: true }; // Requires TUI
  }

  async navigateTree(
    targetId: string,
    _options?: {
      summarize?: boolean;
      customInstructions?: string;
      replaceInstructions?: boolean;
      label?: string;
    },
  ): Promise<{
    editorText?: string;
    cancelled: boolean;
    aborted?: boolean;
    summaryEntry?: BranchSummaryEntry;
  }> {
    this.sessionManager.branch(targetId);
    const ctx = this.sessionManager.buildSessionContext();
    this.agent.replaceMessages(ctx.messages);
    return { cancelled: false };
  }

  // -- Utilities --
  async waitForIdle(): Promise<void> {
    while (this._isStreaming) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  getSessionStats(): SessionStats {
    const msgs = this.messages;
    return {
      sessionFile: this.sessionFile,
      sessionId: this.sessionId,
      userMessages: msgs.filter((m) => m.role === "user").length,
      assistantMessages: msgs.filter((m) => m.role === "assistant").length,
      toolCalls: 0,
      toolResults: 0,
      totalMessages: msgs.length,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      cost: 0,
    };
  }

  getContextUsage(): ContextUsage | undefined {
    return undefined;
  }

  getUserMessagesForForking(): Array<{ entryId: string; text: string }> {
    const entries = this.sessionManager.getEntries();
    return entries
      .filter(
        (e) => e.type === "message" && (e as { message: AgentMessage }).message.role === "user",
      )
      .map((e) => {
        const msg = (e as { message: AgentMessage }).message;
        const text =
          typeof msg.content === "string"
            ? msg.content
            : Array.isArray(msg.content)
              ? msg.content
                  .map((b: unknown) => {
                    if (b && typeof b === "object" && "text" in b)
                      return (b as { text: string }).text;
                    return "";
                  })
                  .join("")
              : "";
        return { entryId: e.id, text };
      });
  }

  getLastAssistantText(): string | undefined {
    const msgs = this.messages;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m && m.role === "assistant") {
        if (typeof m.content === "string") return m.content;
        if (Array.isArray(m.content)) {
          return m.content
            .map((b: unknown) => {
              if (b && typeof b === "object" && "text" in b) return (b as { text: string }).text;
              return "";
            })
            .join("");
        }
      }
    }
    return undefined;
  }

  async exportToHtml(_outputPath?: string): Promise<string> {
    return "<html><body>Session export not implemented</body></html>";
  }

  hasExtensionHandlers(_eventType: string): boolean {
    return false;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Creates a fully-configured AgentSession.
 *
 * This is the Argent-native equivalent of Pi's createAgentSession(). It wires
 * together the agent loop, session manager, settings manager, model, tools,
 * and event system into a single orchestration surface.
 */
export async function createArgentAgentSession(
  options?: CreateAgentSessionOptions,
): Promise<CreateAgentSessionResult> {
  const cwd = options?.cwd ?? process.cwd();
  const agentDir = (options as { agentDir?: string } | undefined)?.agentDir;

  // Resolve or create session manager
  const sm =
    options?.sessionManager instanceof ArgentSessionManager
      ? options.sessionManager
      : ArgentSessionManager.create(cwd);

  // Resolve or create settings manager
  const settings =
    options?.settingsManager instanceof ArgentSettingsManager
      ? options.settingsManager
      : ArgentSettingsManager.create(cwd, agentDir);

  // Create the agent with a default no-op streamFn
  // The consuming code (attempt.ts) will replace this with the real provider
  const defaultStreamFn: AgentSessionAgent["streamFn"] = async function* () {
    // No-op — will be replaced by attempt.ts with real provider
  };

  const agent = new AgentImpl(defaultStreamFn);

  // Resolve thinking level
  const thinkingLevel: ThinkingLevel =
    (options?.thinkingLevel as ThinkingLevel) ?? settings.getDefaultThinkingLevel() ?? "medium";

  // Collect tools
  const tools = (options?.tools ?? []) as AgentTool[];

  // Create the session
  const session = new ArgentAgentSessionImpl(
    agent,
    sm,
    settings,
    options?.model,
    thinkingLevel,
    tools,
    {
      config: options?.config,
      agentDir:
        typeof options?.agentDir === "string" && options.agentDir.trim()
          ? options.agentDir
          : undefined,
    },
  );

  return {
    session,
    extensionsResult: { loaded: [], failed: [] },
    modelFallbackMessage: undefined,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function buildUserContent(text: string, images?: ImageContent[]): (TextContent | ImageContent)[] {
  const blocks: (TextContent | ImageContent)[] = [{ type: "text", text }];
  if (images && images.length > 0) {
    blocks.push(...images);
  }
  return blocks;
}

function resolveVisionModelMeta(model: unknown): {
  input?: string[];
  id?: string;
  provider?: string;
  baseUrl?: string;
} {
  if (!model || typeof model !== "object") {
    return {};
  }
  const record = model as Record<string, unknown>;
  return {
    input: Array.isArray(record.input)
      ? record.input.filter((value): value is string => typeof value === "string")
      : undefined,
    id:
      typeof record.id === "string"
        ? record.id
        : typeof record.modelId === "string"
          ? record.modelId
          : undefined,
    provider: typeof record.provider === "string" ? record.provider : undefined,
    baseUrl: typeof record.baseUrl === "string" ? record.baseUrl : undefined,
  };
}

function estimateTokens(msg: AgentMessage): number {
  if (typeof msg.content === "string") return Math.ceil(msg.content.length / 4);
  if (Array.isArray(msg.content)) {
    return msg.content.reduce((sum: number, block: unknown) => {
      if (block && typeof block === "object" && "text" in block) {
        return sum + Math.ceil((block as { text: string }).text.length / 4);
      }
      return sum + 100; // Image blocks estimate
    }, 0);
  }
  return 50;
}
