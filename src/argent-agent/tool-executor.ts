/**
 * Argent Agent — Tool Execution Engine
 *
 * Production-grade tool execution with:
 *   - Steering: pre/post hooks, parameter validation, permission policies
 *   - Follow-up: continuation requests, incremental progress updates
 *   - Abort handling: AbortSignal propagation, timeouts, graceful cleanup
 *
 * This replaces the simple executeToolCall() for production use cases.
 * The basic ToolRegistry/executeToolCall in tools.ts remains for simple scenarios.
 *
 * Architecture:
 *   ToolCall → ToolExecutor.execute()
 *     → Policy check (allow/deny/confirm)
 *     → Pre-hooks (steering, validation, transforms)
 *     → Handler invocation (with AbortSignal + progress callback)
 *     → Post-hooks (audit, follow-up detection)
 *     → ToolResult (with optional continuation)
 *
 * Built for Argent Core — March 5, 2026
 */

import type { ToolCall } from "../argent-ai/types.js";
import type { ToolHandler, ToolRegistry } from "./tools.js";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Extended tool handler with abort support and progress updates.
 * Superset of the basic ToolHandler — handlers can be registered
 * with either interface.
 */
export interface ExtendedToolHandler extends ToolHandler {
  /**
   * Extended execution function with abort signal and progress callback.
   * Falls back to basic handler() if not provided.
   */
  executeExtended?: (
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ) => Promise<ToolResult>;

  /** Maximum execution time in ms (0 = no timeout) */
  timeoutMs?: number;

  /** Permission level required to run this tool */
  permission?: ToolPermission;

  /** Whether this tool can produce follow-up requests */
  supportsFollowUp?: boolean;

  /** Whether this tool supports incremental progress updates */
  supportsProgress?: boolean;

  /** Tool category for policy grouping */
  category?: ToolCategory;
}

/**
 * Context passed to extended tool handlers during execution.
 */
export interface ToolExecutionContext {
  /** Abort signal for cancellation */
  signal: AbortSignal;

  /** Report incremental progress */
  onProgress: (update: ToolProgressUpdate) => void;

  /** Tool call ID (from LLM) */
  toolCallId: string;

  /** Current loop iteration */
  iteration: number;

  /** Agent ID executing this tool */
  agentId?: string;

  /** Metadata from steering hooks */
  metadata: Record<string, unknown>;
}

/**
 * Result of a tool execution.
 */
export interface ToolResult {
  /** Text content returned to the LLM */
  content: string;

  /** Whether the execution produced an error */
  isError: boolean;

  /** Request the agent to continue with a follow-up turn */
  followUp?: ToolFollowUp;

  /** Metadata for audit/logging */
  metadata?: Record<string, unknown>;

  /** Duration of execution in ms */
  durationMs?: number;
}

/**
 * Follow-up request from a tool.
 * Tells the agent loop to inject a message or continue execution.
 */
export interface ToolFollowUp {
  /** Type of follow-up */
  type: "inject_message" | "continue" | "request_confirmation";

  /** Message to inject before next LLM turn (for inject_message) */
  message?: string;

  /** Role of injected message */
  role?: "user" | "system";

  /** Confirmation prompt (for request_confirmation) */
  confirmationPrompt?: string;

  /** Maximum additional iterations allowed for follow-up */
  maxIterations?: number;
}

/**
 * Incremental progress update from a running tool.
 */
export interface ToolProgressUpdate {
  /** Progress percentage (0-100), or -1 for indeterminate */
  percent: number;

  /** Human-readable status message */
  message: string;

  /** Partial result so far (optional) */
  partialResult?: string;
}

/**
 * Tool permission levels.
 */
export type ToolPermission =
  | "unrestricted" // Always allowed
  | "standard" // Allowed by default, can be restricted
  | "elevated" // Requires explicit grant
  | "destructive" // Requires confirmation
  | "external"; // Sends data outside the system

/**
 * Tool categories for policy grouping.
 */
export type ToolCategory =
  | "read" // Read-only operations
  | "write" // File/data modifications
  | "execute" // Command/code execution
  | "network" // External API calls
  | "messaging" // Sending messages to humans
  | "system" // System/config operations
  | "other";

// ============================================================================
// TOOL EXECUTION POLICY
// ============================================================================

/**
 * Policy decision for a tool call.
 */
export type PolicyDecision =
  | { action: "allow" }
  | { action: "deny"; reason: string }
  | { action: "confirm"; prompt: string }
  | { action: "transform"; args: Record<string, unknown> };

/**
 * Tool execution policy.
 * Evaluated before each tool call to enforce permissions and constraints.
 */
export interface ToolPolicy {
  /** Policy name for logging */
  name: string;

  /**
   * Evaluate a tool call against this policy.
   * Return null to pass through to the next policy.
   */
  evaluate(
    toolCall: ToolCall,
    handler: ExtendedToolHandler,
    context: ToolExecutionContext,
  ): PolicyDecision | null;
}

// ============================================================================
// TOOL EXECUTION HOOKS
// ============================================================================

/**
 * Pre-execution hook. Runs before the tool handler.
 * Can modify arguments, inject metadata, or short-circuit execution.
 */
export interface PreExecutionHook {
  name: string;
  priority: number; // Lower = runs first

  execute(
    toolCall: ToolCall,
    handler: ExtendedToolHandler,
    context: ToolExecutionContext,
  ): Promise<PreHookResult>;
}

export type PreHookResult =
  | { action: "continue"; args?: Record<string, unknown>; metadata?: Record<string, unknown> }
  | { action: "skip"; result: ToolResult }
  | { action: "abort"; reason: string };

/**
 * Post-execution hook. Runs after the tool handler.
 * Can modify results, trigger follow-ups, or record audit data.
 */
export interface PostExecutionHook {
  name: string;
  priority: number;

  execute(
    toolCall: ToolCall,
    result: ToolResult,
    handler: ExtendedToolHandler,
    context: ToolExecutionContext,
  ): Promise<PostHookResult>;
}

export type PostHookResult =
  | { action: "continue"; result?: ToolResult }
  | { action: "retry"; reason: string; maxRetries?: number }
  | { action: "inject_followup"; followUp: ToolFollowUp };

// ============================================================================
// TOOL EXECUTION EVENTS
// ============================================================================

/**
 * Events emitted during tool execution for observability.
 */
export type ToolExecutionEvent =
  | { type: "tool_exec_start"; toolCall: ToolCall; timestamp: number }
  | { type: "tool_exec_policy"; toolCall: ToolCall; decision: PolicyDecision; policyName: string }
  | { type: "tool_exec_pre_hook"; toolCall: ToolCall; hookName: string; result: PreHookResult }
  | { type: "tool_exec_progress"; toolCall: ToolCall; update: ToolProgressUpdate }
  | { type: "tool_exec_post_hook"; toolCall: ToolCall; hookName: string; result: PostHookResult }
  | { type: "tool_exec_complete"; toolCall: ToolCall; result: ToolResult; durationMs: number }
  | { type: "tool_exec_error"; toolCall: ToolCall; error: string; durationMs: number }
  | { type: "tool_exec_abort"; toolCall: ToolCall; reason: string; durationMs: number }
  | { type: "tool_exec_timeout"; toolCall: ToolCall; timeoutMs: number; durationMs: number };

// ============================================================================
// TOOL EXECUTOR
// ============================================================================

/**
 * Configuration for the ToolExecutor.
 */
export interface ToolExecutorConfig {
  /** Tool registry to look up handlers */
  registry: ToolRegistry;

  /** Execution policies (evaluated in order) */
  policies?: ToolPolicy[];

  /** Pre-execution hooks (sorted by priority) */
  preHooks?: PreExecutionHook[];

  /** Post-execution hooks (sorted by priority) */
  postHooks?: PostExecutionHook[];

  /** Default timeout for tools without explicit timeoutMs (ms, 0 = none) */
  defaultTimeoutMs?: number;

  /** Maximum retries on transient errors */
  maxRetries?: number;

  /** Event listener for observability */
  onEvent?: (event: ToolExecutionEvent) => void;

  /** Global abort signal (e.g., from session shutdown) */
  signal?: AbortSignal;
}

/**
 * Production-grade tool executor with steering, follow-up, and abort handling.
 */
export class ToolExecutor {
  private config: ToolExecutorConfig;
  private policies: ToolPolicy[];
  private preHooks: PreExecutionHook[];
  private postHooks: PostExecutionHook[];

  constructor(config: ToolExecutorConfig) {
    this.config = config;
    this.policies = [...(config.policies || [])];
    this.preHooks = [...(config.preHooks || [])].sort((a, b) => a.priority - b.priority);
    this.postHooks = [...(config.postHooks || [])].sort((a, b) => a.priority - b.priority);
  }

  // ── Public API ──

  /**
   * Get the underlying tool registry.
   */
  get registry(): ToolRegistry {
    return this.config.registry;
  }

  /**
   * Get tool definitions for the LLM.
   */
  getToolDefs(): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
    return this.config.registry.toToolDefs();
  }

  /**
   * Execute a single tool call with full lifecycle management.
   */
  async execute(
    toolCall: ToolCall,
    opts: { iteration?: number; agentId?: string; signal?: AbortSignal } = {},
  ): Promise<ToolResult> {
    const startTime = Date.now();
    const handler = this.config.registry.get(toolCall.name) as ExtendedToolHandler | undefined;

    // ── 1. Resolve handler ──
    if (!handler) {
      const result: ToolResult = {
        content: `Error: Tool "${toolCall.name}" not found. Available tools: ${this.config.registry
          .list()
          .map((t) => t.name)
          .join(", ")}`,
        isError: true,
        durationMs: Date.now() - startTime,
      };
      this.emit({
        type: "tool_exec_error",
        toolCall,
        error: result.content,
        durationMs: result.durationMs!,
      });
      return result;
    }

    // ── 2. Build execution context ──
    const abortController = new AbortController();
    const combinedSignal = this.combineSignals(
      abortController.signal,
      opts.signal,
      this.config.signal,
    );

    const context: ToolExecutionContext = {
      signal: combinedSignal,
      onProgress: (update) => this.emit({ type: "tool_exec_progress", toolCall, update }),
      toolCallId: toolCall.id,
      iteration: opts.iteration ?? 0,
      agentId: opts.agentId,
      metadata: {},
    };

    this.emit({ type: "tool_exec_start", toolCall, timestamp: startTime });

    // ── 3. Check abort before starting ──
    if (combinedSignal.aborted) {
      const result: ToolResult = {
        content: "Error: Execution aborted before start",
        isError: true,
        durationMs: Date.now() - startTime,
      };
      this.emit({
        type: "tool_exec_abort",
        toolCall,
        reason: "pre-start abort",
        durationMs: result.durationMs!,
      });
      return result;
    }

    try {
      // ── 4. Evaluate policies ──
      const policyResult = this.evaluatePolicies(toolCall, handler, context);
      if (policyResult) {
        if (policyResult.action === "deny") {
          const result: ToolResult = {
            content: `Error: Tool "${toolCall.name}" denied by policy: ${policyResult.reason}`,
            isError: true,
            durationMs: Date.now() - startTime,
          };
          this.emit({
            type: "tool_exec_error",
            toolCall,
            error: result.content,
            durationMs: result.durationMs!,
          });
          return result;
        }
        if (policyResult.action === "transform") {
          toolCall = { ...toolCall, arguments: policyResult.args };
        }
        if (policyResult.action === "confirm") {
          // For now, confirmation requests become follow-ups
          const result: ToolResult = {
            content: `Tool "${toolCall.name}" requires confirmation: ${policyResult.prompt}`,
            isError: false,
            followUp: {
              type: "request_confirmation",
              confirmationPrompt: policyResult.prompt,
            },
            durationMs: Date.now() - startTime,
          };
          return result;
        }
      }

      // ── 5. Run pre-execution hooks ──
      let currentArgs = { ...toolCall.arguments };
      for (const hook of this.preHooks) {
        if (combinedSignal.aborted) break;

        const hookResult = await hook.execute(
          { ...toolCall, arguments: currentArgs },
          handler,
          context,
        );
        this.emit({
          type: "tool_exec_pre_hook",
          toolCall,
          hookName: hook.name,
          result: hookResult,
        });

        if (hookResult.action === "skip") {
          return { ...hookResult.result, durationMs: Date.now() - startTime };
        }
        if (hookResult.action === "abort") {
          const result: ToolResult = {
            content: `Error: Pre-hook "${hook.name}" aborted: ${hookResult.reason}`,
            isError: true,
            durationMs: Date.now() - startTime,
          };
          this.emit({
            type: "tool_exec_abort",
            toolCall,
            reason: hookResult.reason,
            durationMs: result.durationMs!,
          });
          return result;
        }
        if (hookResult.args) {
          currentArgs = hookResult.args;
        }
        if (hookResult.metadata) {
          Object.assign(context.metadata, hookResult.metadata);
        }
      }

      // ── 6. Execute the tool handler (with timeout + abort) ──
      const timeoutMs =
        (handler as ExtendedToolHandler).timeoutMs ?? this.config.defaultTimeoutMs ?? 0;
      let result: ToolResult;

      const modifiedToolCall = { ...toolCall, arguments: currentArgs };

      result = await this.executeWithTimeout(
        modifiedToolCall,
        handler,
        context,
        timeoutMs,
        abortController,
      );

      result.durationMs = Date.now() - startTime;

      // ── 7. Run post-execution hooks ──
      for (const hook of this.postHooks) {
        if (combinedSignal.aborted) break;

        const hookResult = await hook.execute(modifiedToolCall, result, handler, context);
        this.emit({
          type: "tool_exec_post_hook",
          toolCall,
          hookName: hook.name,
          result: hookResult,
        });

        if (hookResult.action === "retry") {
          // Retry with backoff (limited retries)
          const maxRetries = hookResult.maxRetries ?? this.config.maxRetries ?? 1;
          result = await this.retryExecution(
            modifiedToolCall,
            handler,
            context,
            timeoutMs,
            maxRetries,
            hookResult.reason,
          );
          result.durationMs = Date.now() - startTime;
        }
        if (hookResult.action === "inject_followup") {
          result.followUp = hookResult.followUp;
        }
        if (hookResult.action === "continue" && hookResult.result) {
          result = hookResult.result;
          result.durationMs = Date.now() - startTime;
        }
      }

      // ── 8. Emit completion ──
      this.emit({
        type: "tool_exec_complete",
        toolCall,
        result,
        durationMs: result.durationMs!,
      });

      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const message = error instanceof Error ? error.message : String(error);

      if (combinedSignal.aborted) {
        const result: ToolResult = {
          content: `Error: Tool "${toolCall.name}" was aborted: ${message}`,
          isError: true,
          durationMs,
        };
        this.emit({ type: "tool_exec_abort", toolCall, reason: message, durationMs });
        return result;
      }

      const result: ToolResult = {
        content: `Error: ${message}`,
        isError: true,
        durationMs,
      };
      this.emit({ type: "tool_exec_error", toolCall, error: message, durationMs });
      return result;
    }
  }

  /**
   * Execute multiple tool calls (parallel when independent, sequential when chained).
   *
   * Returns results in the same order as the input tool calls.
   */
  async executeBatch(
    toolCalls: ToolCall[],
    opts: { iteration?: number; agentId?: string; signal?: AbortSignal; parallel?: boolean } = {},
  ): Promise<ToolResult[]> {
    if (opts.parallel !== false && toolCalls.length > 1) {
      // Parallel execution (default for multiple tool calls)
      return Promise.all(toolCalls.map((tc) => this.execute(tc, opts)));
    }

    // Sequential execution
    const results: ToolResult[] = [];
    for (const tc of toolCalls) {
      if (opts.signal?.aborted) {
        results.push({
          content: "Error: Batch execution aborted",
          isError: true,
          durationMs: 0,
        });
        continue;
      }
      results.push(await this.execute(tc, opts));
    }
    return results;
  }

  // ── Policy Management ──

  addPolicy(policy: ToolPolicy): void {
    this.policies.push(policy);
  }

  removePolicy(name: string): void {
    this.policies = this.policies.filter((p) => p.name !== name);
  }

  // ── Hook Management ──

  addPreHook(hook: PreExecutionHook): void {
    this.preHooks.push(hook);
    this.preHooks.sort((a, b) => a.priority - b.priority);
  }

  addPostHook(hook: PostExecutionHook): void {
    this.postHooks.push(hook);
    this.postHooks.sort((a, b) => a.priority - b.priority);
  }

  removePreHook(name: string): void {
    this.preHooks = this.preHooks.filter((h) => h.name !== name);
  }

  removePostHook(name: string): void {
    this.postHooks = this.postHooks.filter((h) => h.name !== name);
  }

  // ── Private Helpers ──

  /**
   * Evaluate all policies in order. First non-null result wins.
   */
  private evaluatePolicies(
    toolCall: ToolCall,
    handler: ExtendedToolHandler,
    context: ToolExecutionContext,
  ): PolicyDecision | null {
    for (const policy of this.policies) {
      const decision = policy.evaluate(toolCall, handler, context);
      if (decision) {
        this.emit({
          type: "tool_exec_policy",
          toolCall,
          decision,
          policyName: policy.name,
        });
        return decision;
      }
    }
    return null;
  }

  /**
   * Execute a tool handler with timeout enforcement.
   */
  private async executeWithTimeout(
    toolCall: ToolCall,
    handler: ExtendedToolHandler,
    context: ToolExecutionContext,
    timeoutMs: number,
    abortController: AbortController,
  ): Promise<ToolResult> {
    // Use extended handler if available, otherwise wrap basic handler
    const executeFn = handler.executeExtended
      ? () => handler.executeExtended!(toolCall.arguments, context)
      : async () => {
          const content = await handler.handler(toolCall.arguments);
          return { content, isError: false } as ToolResult;
        };

    if (timeoutMs <= 0) {
      // No timeout — just execute
      return executeFn();
    }

    // Race between execution and timeout
    return new Promise<ToolResult>((resolve) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          abortController.abort(new Error(`Timeout after ${timeoutMs}ms`));
          this.emit({
            type: "tool_exec_timeout",
            toolCall,
            timeoutMs,
            durationMs: timeoutMs,
          });
          resolve({
            content: `Error: Tool "${toolCall.name}" timed out after ${timeoutMs}ms`,
            isError: true,
            durationMs: timeoutMs,
          });
        }
      }, timeoutMs);

      executeFn()
        .then((result) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(result);
          }
        })
        .catch((error) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            const message = error instanceof Error ? error.message : String(error);
            resolve({
              content: `Error: ${message}`,
              isError: true,
            });
          }
        });
    });
  }

  /**
   * Retry a tool execution with exponential backoff.
   */
  private async retryExecution(
    toolCall: ToolCall,
    handler: ExtendedToolHandler,
    context: ToolExecutionContext,
    timeoutMs: number,
    maxRetries: number,
    reason: string,
  ): Promise<ToolResult> {
    let lastResult: ToolResult = {
      content: `Error: Retry requested (${reason}) but no attempts made`,
      isError: true,
    };

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (context.signal.aborted) {
        return {
          content: "Error: Aborted during retry",
          isError: true,
        };
      }

      // Exponential backoff: 100ms, 200ms, 400ms, ...
      const backoffMs = Math.min(100 * Math.pow(2, attempt), 5000);
      await this.sleep(backoffMs, context.signal);

      if (context.signal.aborted) {
        return {
          content: "Error: Aborted during retry backoff",
          isError: true,
        };
      }

      const abortController = new AbortController();
      const retryContext: ToolExecutionContext = {
        ...context,
        signal: this.combineSignals(abortController.signal, context.signal),
        metadata: { ...context.metadata, retryAttempt: attempt + 1, retryReason: reason },
      };

      lastResult = await this.executeWithTimeout(
        toolCall,
        handler,
        retryContext,
        timeoutMs,
        abortController,
      );

      if (!lastResult.isError) {
        return lastResult;
      }
    }

    return {
      content: `${lastResult.content} (after ${maxRetries} retries for: ${reason})`,
      isError: true,
    };
  }

  /**
   * Combine multiple abort signals into one.
   */
  private combineSignals(...signals: (AbortSignal | undefined)[]): AbortSignal {
    const validSignals = signals.filter((s): s is AbortSignal => s !== undefined);
    if (validSignals.length === 0) return new AbortController().signal;
    if (validSignals.length === 1) return validSignals[0];

    const controller = new AbortController();

    for (const signal of validSignals) {
      if (signal.aborted) {
        controller.abort(signal.reason);
        return controller.signal;
      }
      signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
    }

    return controller.signal;
  }

  /**
   * Emit an execution event.
   */
  private emit(event: ToolExecutionEvent): void {
    try {
      this.config.onEvent?.(event);
    } catch {
      // Swallow event handler errors
    }
  }

  /**
   * Abort-aware sleep.
   */
  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal?.aborted) {
        resolve();
        return;
      }
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a ToolExecutor with minimal configuration.
 */
export function createToolExecutor(config: ToolExecutorConfig): ToolExecutor {
  return new ToolExecutor(config);
}

// ============================================================================
// BUILT-IN POLICIES
// ============================================================================

/**
 * Allowlist policy — only named tools can execute.
 */
export function createAllowlistPolicy(allowedTools: string[]): ToolPolicy {
  const allowed = new Set(allowedTools);
  return {
    name: "allowlist",
    evaluate(toolCall) {
      if (!allowed.has(toolCall.name)) {
        return { action: "deny", reason: `Tool "${toolCall.name}" not in allowlist` };
      }
      return null;
    },
  };
}

/**
 * Denylist policy — named tools are blocked.
 */
export function createDenylistPolicy(deniedTools: string[]): ToolPolicy {
  const denied = new Set(deniedTools);
  return {
    name: "denylist",
    evaluate(toolCall) {
      if (denied.has(toolCall.name)) {
        return { action: "deny", reason: `Tool "${toolCall.name}" is blocked` };
      }
      return null;
    },
  };
}

/**
 * Permission-level policy — enforces tool permission requirements.
 */
export function createPermissionPolicy(grantedPermissions: Set<ToolPermission>): ToolPolicy {
  return {
    name: "permission",
    evaluate(_toolCall, handler) {
      const required = handler.permission ?? "standard";
      if (required === "unrestricted") return null;

      if (!grantedPermissions.has(required)) {
        if (required === "destructive") {
          return {
            action: "confirm",
            prompt: `Tool "${_toolCall.name}" is destructive. Confirm execution?`,
          };
        }
        return {
          action: "deny",
          reason: `Permission "${required}" not granted. Granted: ${Array.from(grantedPermissions).join(", ")}`,
        };
      }
      return null;
    },
  };
}

/**
 * Rate-limit policy — limits calls per tool per time window.
 */
export function createRateLimitPolicy(
  maxCallsPerWindow: number,
  windowMs: number = 60_000,
): ToolPolicy {
  const callHistory = new Map<string, number[]>();

  return {
    name: "rate-limit",
    evaluate(toolCall) {
      const now = Date.now();
      const history = callHistory.get(toolCall.name) ?? [];

      // Prune calls outside the window
      const recent = history.filter((ts) => now - ts < windowMs);
      callHistory.set(toolCall.name, recent);

      if (recent.length >= maxCallsPerWindow) {
        return {
          action: "deny",
          reason: `Rate limit exceeded for "${toolCall.name}": ${maxCallsPerWindow} calls per ${windowMs}ms`,
        };
      }

      recent.push(now);
      return null;
    },
  };
}

// ============================================================================
// BUILT-IN HOOKS
// ============================================================================

/**
 * Audit logging post-hook — records every tool execution.
 */
export function createAuditHook(
  logger: (entry: {
    toolName: string;
    toolCallId: string;
    args: Record<string, unknown>;
    result: ToolResult;
    durationMs: number;
    timestamp: number;
  }) => void | Promise<void>,
): PostExecutionHook {
  return {
    name: "audit",
    priority: 1000, // Run last

    async execute(toolCall, result, _handler, context) {
      await logger({
        toolName: toolCall.name,
        toolCallId: context.toolCallId,
        args: toolCall.arguments,
        result,
        durationMs: result.durationMs ?? 0,
        timestamp: Date.now(),
      });
      return { action: "continue" };
    },
  };
}

/**
 * Error-retry post-hook — retries transient errors.
 */
export function createErrorRetryHook(
  isTransient: (error: string) => boolean,
  maxRetries = 2,
): PostExecutionHook {
  return {
    name: "error-retry",
    priority: 100, // Run early

    async execute(_toolCall, result) {
      if (result.isError && isTransient(result.content)) {
        return { action: "retry", reason: "transient error", maxRetries };
      }
      return { action: "continue" };
    },
  };
}

/**
 * Parameter validation pre-hook — validates args against JSON schema.
 */
export function createValidationHook(): PreExecutionHook {
  return {
    name: "validation",
    priority: 0, // Run first

    async execute(toolCall, handler, _context) {
      // Basic required-field check (lightweight — no full JSON Schema validator)
      const schema = handler.parameters;
      if (schema && typeof schema === "object" && "required" in schema) {
        const required = (schema as { required?: string[] }).required ?? [];
        for (const field of required) {
          if (!(field in toolCall.arguments)) {
            return {
              action: "abort",
              reason: `Missing required parameter "${field}" for tool "${toolCall.name}"`,
            };
          }
        }
      }
      return { action: "continue" };
    },
  };
}
