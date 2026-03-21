/**
 * Argent Agent — Extension System Types
 *
 * Pi-compatible types for the extension, tool definition, and context event system.
 * Matches shapes from the legacy upstream coding-agent extension types.
 *
 * These are TYPE-ONLY exports — no runtime code. The actual extension runner
 * remains on Pi until the full extension system is ported.
 *
 * @module argent-agent/extension-types
 */

import type { TSchema, Static } from "@sinclair/typebox";
import type { Model, Api, AssistantMessage } from "../argent-ai/types.js";
import type { AgentToolResult, AgentToolUpdateCallback, AgentMessage } from "./pi-types.js";

// ============================================================================
// TOOL DEFINITION
// ============================================================================

/**
 * Tool definition for the extension system.
 * This is what extensions register and what the agent session manages.
 *
 * Used by: pi-tool-definition-adapter.ts (2 files)
 */
export interface ToolDefinition {
  /** Tool name (matches what the LLM calls) */
  name: string;
  /** Human-readable label for UI */
  label: string;
  /** Description shown to the model */
  description: string;
  /** JSON Schema for parameters (TypeBox TSchema) */
  parameters: TSchema;
  /** Execute the tool */
  execute: (
    toolCallId: string,
    params: unknown,
    onUpdate: AgentToolUpdateCallback<unknown> | undefined,
    ctx: unknown,
    signal: AbortSignal | undefined,
  ) => Promise<AgentToolResult<unknown>>;
}

/**
 * Tool info for listing available tools.
 */
export interface ToolInfo {
  name: string;
  label: string;
  description: string;
  parameters: TSchema;
}

// ============================================================================
// EXTENSION CONTEXT
// ============================================================================

/**
 * Core context passed to extension event handlers.
 *
 * Used by: compaction.ts (1 file) — primarily as a type parameter.
 */
export interface ExtensionContext {
  /** Current working directory */
  cwd: string;
  /** Current model */
  model: Model<Api>;
  /** Current thinking level */
  thinkingLevel: string;
  /** Session messages */
  messages: AgentMessage[];
  /** Current system prompt */
  systemPrompt: string;
  /** Tool definitions currently active */
  tools: ToolDefinition[];
}

/**
 * Extended context for user-initiated commands.
 * Adds session manipulation capabilities.
 */
export interface ExtensionCommandContext extends ExtensionContext {
  /** Append a message to the session */
  appendMessage: (message: AgentMessage) => void;
  /** Set the model */
  setModel: (model: Model<Api>) => Promise<void>;
  /** Set the thinking level */
  setThinkingLevel: (level: string) => void;
  /** Send a prompt to the agent */
  prompt: (text: string) => Promise<void>;
}

// ============================================================================
// EXTENSION API
// ============================================================================

/**
 * Main extension plugin interface.
 * Extensions register handlers, tools, commands, and providers through this API.
 *
 * Used by: 3 files
 */
export interface ExtensionAPI {
  /** Register an event handler */
  on: (event: string, handler: (...args: unknown[]) => unknown) => void;
  /** Register a tool */
  registerTool: (tool: ToolDefinition) => void;
  /** Register a slash command */
  registerCommand: (command: RegisteredCommand) => void;
  /** Register a keyboard shortcut */
  registerShortcut: (shortcut: ExtensionShortcut) => void;
  /** Register a feature flag */
  registerFlag: (flag: ExtensionFlag) => void;
  /** Register a custom API provider */
  registerProvider: (config: ProviderConfig) => void;
}

/** A registered slash command */
export interface RegisteredCommand {
  name: string;
  description: string;
  /** Execute the command */
  execute: (args: string, context: ExtensionCommandContext) => Promise<void>;
}

/** A registered keyboard shortcut */
export interface ExtensionShortcut {
  key: string;
  description: string;
  execute: () => Promise<void>;
}

/** A registered feature flag */
export interface ExtensionFlag {
  name: string;
  description: string;
  defaultValue: boolean;
}

/** Provider configuration for custom APIs */
export interface ProviderConfig {
  name: string;
  displayName: string;
  models: ProviderModelConfig[];
  /** API base URL */
  baseUrl?: string;
  /** Whether this provider uses OAuth */
  oauth?: boolean;
}

/** Model configuration within a provider */
export interface ProviderModelConfig {
  id: string;
  displayName?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
}

// ============================================================================
// CONTEXT EVENTS
// ============================================================================

/**
 * Context change event emitted when the agent's context is modified.
 *
 * Used by: 1 file
 */
export interface ContextEvent {
  type: "context_change";
  /** What changed */
  change: "message_added" | "compaction" | "model_change" | "thinking_level_change";
  /** Current message count */
  messageCount: number;
  /** Estimated token count */
  tokenCount: number;
}

/**
 * Result from a context event handler.
 */
export interface ContextEventResult {
  /** Whether to continue processing */
  continue: boolean;
  /** Optional modified messages */
  messages?: AgentMessage[];
}

// ============================================================================
// FILE OPERATIONS
// ============================================================================

/**
 * File operation abstraction for sandboxed environments.
 *
 * Used by: 1 file
 */
export interface FileOperations {
  /** Read a file */
  read: (path: string) => Promise<string>;
  /** Write a file */
  write: (path: string, content: string) => Promise<void>;
  /** Check if a file exists */
  exists: (path: string) => Promise<boolean>;
  /** List files in a directory */
  list: (dir: string) => Promise<string[]>;
  /** Get file stats */
  stat: (path: string) => Promise<{ size: number; mtime: Date; isDirectory: boolean }>;
}

// ============================================================================
// SESSION VERSION
// ============================================================================

/**
 * Current session format version.
 * Increment when the session entry format changes in a backward-incompatible way.
 *
 * Used by: 3 files
 */
export const CURRENT_SESSION_VERSION = 3;

// ============================================================================
// EXTENSION FACTORY / RUNTIME
// ============================================================================

/**
 * Extension factory function — creates an extension instance.
 */
export type ExtensionFactory = (api: ExtensionAPI) => void | Promise<void>;

/**
 * Loaded extension metadata.
 */
export interface LoadedExtension {
  name: string;
  version?: string;
  factory: ExtensionFactory;
  source: string;
}
